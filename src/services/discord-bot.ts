import {
    Client,
    GatewayIntentBits,
    Partials
} from 'discord.js';
import { config } from '../config/env.js';
import { createServiceLogger } from '../utils/logger.js';
import { getPendingOpportunity, deletePendingOpportunity } from './pending-store.service.js';
import * as sheetsService from './sheets.service.js';
import { generateContent } from './gemini-content.service.js';

const log = createServiceLogger('discord-bot');

export const discordClient = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ],
    partials: [Partials.Message, Partials.Reaction, Partials.User, Partials.Channel]
});

discordClient.once('ready', () => {
    log.info('Discord Bot Ready: ' + (discordClient.user?.tag || 'unknown'));
});

discordClient.on('error', (err) => {
    log.error('Discord client error', { error: err.message });
});

discordClient.on('messageReactionAdd', async (reaction, user) => {
    log.info(`🔔 Reaction detected: ${reaction.emoji.name} by ${user.tag || user.id} on message ${reaction.message.id}`);
    
    if (user.bot) {
        log.info('  Ignoring bot reaction');
        return;
    }
    
    // Fetch partial reaction/message if needed (messages not in cache)
    if (reaction.partial) {
        try {
            await reaction.fetch();
        } catch (error) {
            log.error('Failed to fetch partial reaction', { error: String(error) });
            return;
        }
    }
    if (reaction.message.partial) {
        try {
            await reaction.message.fetch();
        } catch (error) {
            log.error('Failed to fetch partial message', { error: String(error) });
            return;
        }
    }

    const messageId = reaction.message.id;
    let pendingData = getPendingOpportunity(messageId);
    
    // If not found in local JSON (because it was scraped on GitHub Actions), fetch from Google Sheets
    if (!pendingData) {
        try {
            const contentInfo = await sheetsService.getContentByDiscordMessageId(messageId);
            if (contentInfo) {
                const oppInfo = await sheetsService.getOpportunityById(contentInfo.opportunity_id);
                if (oppInfo) {
                    pendingData = { opportunity: oppInfo, content: contentInfo };
                }
            }
        } catch (err) {
            log.error('Error fetching pending data from Sheets', { error: String(err) });
        }
    }
    
    if (!pendingData) return;

    const { opportunity, content } = pendingData;
    const emoji = reaction.emoji.name;

    try {
        if (emoji === '✅') {
            log.info(`Approving opportunity: ${opportunity.opportunity_name}`);
            
            // Check if it's already in Sheets (it will be if scraped from web)
            const existingOpp = await sheetsService.getOpportunityById(opportunity.id);
            if (!existingOpp) {
                await sheetsService.addOpportunity(opportunity);
                await sheetsService.addContent(content);
            }
            
            await sheetsService.updateOpportunityStatus(opportunity.id, 'approved');
            
            deletePendingOpportunity(messageId);
            
            await reaction.message.edit(`✅ **APPROVED & SAVED**\n\n${reaction.message.content}`);
         } else if (emoji === '❌') {
            log.info(`Rejecting opportunity: ${opportunity.opportunity_name}`);
            deletePendingOpportunity(messageId);
            
            // If it exists in Google Sheets, change status to 'rejected' so the scraper never adds it again
            const existingOpp = await sheetsService.getOpportunityById(opportunity.id);
            if (existingOpp) {
                await sheetsService.updateOpportunityStatus(opportunity.id, 'rejected');
            }
            
            // Clean up the message text to remove any previous APPROVED prefixes
            let originalContent = reaction.message.content || '';
            originalContent = originalContent.replace(/^✅ \*\*APPROVED & SAVED\*\*\n\n/, '');
            
            await reaction.message.edit(`❌ **REJECTED / UNAPPROVED**\n\n${originalContent}`);
            await reaction.message.reactions.removeAll();
        } else if (emoji === '🔄') {
            log.info(`Regenerating content for: ${opportunity.opportunity_name}`);
            // Note: In a full implementation, you'd probably want to regenerate the image too.
            // But for now we just regenerate caption and update the message.
            const newContent = await generateContent({
                is_opportunity: true,
                opportunity_name: opportunity.opportunity_name,
                organizer: opportunity.organizer,
                registration_link: opportunity.registration_link,
                deadline: opportunity.deadline,
                eligibility: opportunity.eligibility,
                rewards: opportunity.rewards,
                mode: opportunity.mode,
                location: opportunity.location,
                fees: opportunity.fees,
                benefits: ''
            }, opportunity.source_video);

            if (newContent) {
                content.caption = newContent.caption;
                content.hashtags = newContent.hashtags.map((h: string) => `#${h}`).join(' ');
                content.image_prompt = newContent.image_prompt;
                
                // Update pending store with new content
                const { savePendingOpportunity } = await import('./pending-store.service.js');
                savePendingOpportunity(messageId, opportunity, content);

                const newText = `📋 **${opportunity.opportunity_name}**\n🏢 Organizer: ${opportunity.organizer}\n📍 Location: ${opportunity.location}\n🖥️ Mode: ${opportunity.mode}\n💰 Fees: ${opportunity.fees}\n📅 Deadline: ${opportunity.deadline}\n🎓 Eligibility: ${opportunity.eligibility}\n🏆 Rewards: ${opportunity.rewards}\n\n🔗 Registration: ${opportunity.registration_link}\n📺 Source: ${opportunity.source_video}\n\n━━━━━━━━━━━━━━\n\n${content.caption}`;
                await reaction.message.edit(newText);
                
                // Remove the user's reaction so they can click it again
                await reaction.users.remove(user.id);
            }
        }
    } catch (error) {
        log.error('Error handling Discord reaction', { error: String(error) });
        if (reaction.message.channel.isSendable()) {
            await reaction.message.channel.send(`⚠️ Error processing reaction for ${opportunity.opportunity_name}`);
        }
    }
});

discordClient.login(config.discordBotToken);
