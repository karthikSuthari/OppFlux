import {
    Client,
    GatewayIntentBits,
    Partials
} from 'discord.js';
import { config } from '../config/env.js';
import { getPendingOpportunity, deletePendingOpportunity } from './pending-store.service.js';
import * as sheetsService from './sheets.service.js';
import { generateContent } from './gemini-content.service.js';

export const discordClient = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.MessageContent
    ],
    partials: [Partials.Message, Partials.Reaction, Partials.User]
});

discordClient.once('ready', () => {
    console.log('══════════════════════');
    console.log('Discord Bot Ready');
    console.log(discordClient.user?.tag);
    console.log('══════════════════════');
});

discordClient.on('error', (err) => {
    console.log(err);
});

discordClient.on('messageReactionAdd', async (reaction, user) => {
    if (user.bot) return;
    if (reaction.partial) {
        try {
            await reaction.fetch();
        } catch (error) {
            console.error('Something went wrong when fetching the message:', error);
            return;
        }
    }

    const messageId = reaction.message.id;
    let pendingData = getPendingOpportunity(messageId);
    
    // If not found in local JSON (because it was scraped on GitHub Actions), fetch from Google Sheets
    if (!pendingData) {
        try {
            const contentInfo = await sheetsService.getContentByTelegramMessageId(messageId);
            if (contentInfo) {
                const oppInfo = await sheetsService.getOpportunityById(contentInfo.opportunity_id);
                if (oppInfo) {
                    pendingData = { opportunity: oppInfo, content: contentInfo };
                }
            }
        } catch (err) {
            console.error('Error fetching from Sheets:', err);
        }
    }
    
    if (!pendingData) return;

    const { opportunity, content } = pendingData;
    const emoji = reaction.emoji.name;

    try {
        if (emoji === '✅') {
            console.log(`Approving opportunity: ${opportunity.opportunity_name}`);
            
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
            console.log(`Rejecting opportunity: ${opportunity.opportunity_name}`);
            deletePendingOpportunity(messageId);
            
            await reaction.message.edit(`❌ **REJECTED**\n\n${reaction.message.content}`);
            await reaction.message.reactions.removeAll();
        } else if (emoji === '🔄') {
            console.log(`Regenerating opportunity: ${opportunity.opportunity_name}`);
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
                benefits: ''
            }, opportunity.source_video);

            if (newContent) {
                content.caption = newContent.caption;
                content.hashtags = newContent.hashtags.map((h: string) => `#${h}`).join(' ');
                content.image_prompt = newContent.image_prompt;
                
                // Update pending store with new content
                const { savePendingOpportunity } = await import('./pending-store.service.js');
                savePendingOpportunity(messageId, opportunity, content);

                const newText = `📋 **${opportunity.opportunity_name}**\n🏢 Organizer: ${opportunity.organizer}\n📅 Deadline: ${opportunity.deadline}\n🎓 Eligibility: ${opportunity.eligibility}\n🏆 Rewards: ${opportunity.rewards}\n\n🔗 Registration: ${opportunity.registration_link}\n📺 Source: ${opportunity.source_video}\n\n━━━━━━━━━━━━━━\n\n${content.caption}`;
                await reaction.message.edit(newText);
                
                // Remove the user's reaction so they can click it again
                await reaction.users.remove(user.id);
            }
        }
    } catch (error) {
        console.error('Error handling reaction:', error);
        if (reaction.message.channel.isSendable()) {
            await reaction.message.channel.send(`⚠️ Error processing reaction for ${opportunity.opportunity_name}`);
        }
    }
});

discordClient.login(config.discordBotToken);
