import {
    Client,
    GatewayIntentBits,
    Partials
} from 'discord.js';
import { config } from '../config/env.js';
import { createServiceLogger } from '../utils/logger.js';
import { getPendingOpportunity, deletePendingOpportunity, savePendingOpportunity } from './pending-store.service.js';
import * as sheetsService from './sheets.service.js';
import { generateContent } from './gemini-content.service.js';
import { v4 as uuidv4 } from 'uuid';
import type { Opportunity, Content, OpportunityStatus, ContentStatus } from '../types/index.js';

const log = createServiceLogger('discord-bot');

function parseOpportunityFromMessage(messageContent: string, messageId: string): { opportunity: Opportunity; content: Content } | null {
    try {
        let cleanContent = messageContent;
        cleanContent = cleanContent.replace(/^✅ \*\*APPROVED & SAVED\*\*\n\n/, '');
        cleanContent = cleanContent.replace(/^❌ \*\*REJECTED \/ UNAPPROVED\*\*\n\n/, '');

        const lines = cleanContent.split('\n');
        let name = '';
        
        const firstLine = lines[0] || '';
        const nameMatch = firstLine.match(/^(?:🌐 \*\*\[WEB\] |📋 \*\*)(.*?)\*\*/);
        if (nameMatch) {
            name = nameMatch[1].trim();
        } else {
            const fallbackNameMatch = firstLine.match(/\*\*(.*?)\*\*/);
            if (fallbackNameMatch) {
                name = fallbackNameMatch[1].trim();
            } else {
                return null;
            }
        }

        const getField = (label: string): string => {
            const line = lines.find(l => l.includes(label));
            if (!line) return '';
            const parts = line.split(label);
            if (parts.length < 2) return '';
            return parts[1].trim();
        };

        const organizer = getField('Organizer:');
        const location = getField('Location:');
        const mode = getField('Mode:');
        const fees = getField('Fees:');
        const deadline = getField('Deadline:');
        const eligibility = getField('Eligibility:');
        const rewards = getField('Rewards:');
        const registrationLink = getField('Registration:');
        const sourceVideo = getField('Source:');

        let caption = '';
        const dividerIndex = cleanContent.indexOf('━━━━━━━━━━━━━━');
        if (dividerIndex !== -1) {
            caption = cleanContent.substring(dividerIndex + '━━━━━━━━━━━━━━'.length).trim();
        }

        const hashtagRegex = /#\w+/g;
        const foundHashtags = caption.match(hashtagRegex) || [];
        const hashtags = foundHashtags.join(' ');

        let sourceChannel = 'scraped';
        if (sourceVideo) {
            try {
                const url = new URL(sourceVideo);
                sourceChannel = url.hostname.replace('www.', '');
            } catch {
                sourceChannel = 'scraped';
            }
        }

        const opportunityId = uuidv4().replace(/-/g, '').substring(0, 16);

        const opportunity: Opportunity = {
            id: opportunityId,
            opportunity_name: name,
            organizer,
            registration_link: registrationLink,
            deadline,
            eligibility,
            rewards,
            mode,
            location,
            fees,
            source_video: sourceVideo,
            source_channel: sourceChannel,
            status: 'new' as OpportunityStatus,
            created_at: new Date().toISOString(),
        };

        const content: Content = {
            opportunity_id: opportunityId,
            caption,
            hashtags,
            image_prompt: '',
            image_url: '',
            content_status: 'pending_review' as ContentStatus,
            discord_message_id: messageId,
            review_status: 'pending',
            reviewed_at: '',
            reviewed_by: '',
        };

        return { opportunity, content };
    } catch (err) {
        log.error('Failed parsing opportunity from message content', { error: String(err) });
        return null;
    }
}

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

    // Ignore reactions on messages that are already approved or rejected
    if (reaction.message.content?.startsWith('✅ **APPROVED & SAVED**') || 
        reaction.message.content?.startsWith('❌ **REJECTED / UNAPPROVED**')) {
        log.info('  Message already processed — ignoring reaction');
        return;
    }

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

    // Fallback: parse opportunity details directly from the Discord message content
    if (!pendingData && reaction.message.content) {
        log.info(`Attempting message-parsing fallback for message ${messageId}...`);
        const parsed = parseOpportunityFromMessage(reaction.message.content, messageId);
        if (parsed) {
            log.info(`Successfully parsed opportunity: "${parsed.opportunity.opportunity_name}"`);
            pendingData = parsed;
        }
    }
    
    if (!pendingData) return;

    const { opportunity, content } = pendingData;
    const emoji = reaction.emoji.name;

    try {
        if (emoji === '✅') {
            log.info(`Approving opportunity: ${opportunity.opportunity_name}`);

            // Write to Sheets if it's not already there (covers both YouTube and web-scraped).
            // YouTube/web opportunities live only in the pending store until approved.
            const existingOpp = await sheetsService.getOpportunityById(opportunity.id);
            if (!existingOpp) {
                await sheetsService.addOpportunity(opportunity);
                await sheetsService.addContent(content);
            } else {
                // Already in Sheets (e.g. re-approved) — make sure content row exists too
                const existingContent = await sheetsService.getContentByOpportunityId(opportunity.id);
                if (!existingContent) {
                    await sheetsService.addContent(content);
                }
            }

            await sheetsService.updateOpportunityStatus(opportunity.id, 'approved');

            deletePendingOpportunity(messageId);

            await reaction.message.edit(`✅ **APPROVED & SAVED**\n\n${reaction.message.content}`);
         } else if (emoji === '❌') {
            log.info(`Rejecting opportunity: ${opportunity.opportunity_name}`);
            deletePendingOpportunity(messageId);

            // Only touch Sheets if the opportunity was actually written there.
            // YouTube/web opps are NOT in Sheets until approved, so rejecting them
            // must not try to look up / update a row that doesn't exist.
            try {
                const existingOpp = await sheetsService.getOpportunityById(opportunity.id);
                if (existingOpp) {
                    await sheetsService.updateOpportunityStatus(opportunity.id, 'rejected');
                    log.info(`Marked "${opportunity.opportunity_name}" as rejected in Sheets`);
                } else {
                    log.info(`"${opportunity.opportunity_name}" not in Sheets — nothing to update (pending store cleared)`);
                }
            } catch (sheetsErr) {
                // A Sheets failure here must NOT surface as an error to the user —
                // the rejection itself has already succeeded locally.
                log.warn('Sheets lookup/update failed during rejection', { error: String(sheetsErr) });
            }

            // Clean up the message text to remove any previous APPROVED prefixes
            let originalContent = reaction.message.content || '';
            originalContent = originalContent.replace(/^✅ \*\*APPROVED & SAVED\*\*\n\n/, '');

            await reaction.message.edit(`❌ **REJECTED / UNAPPROVED**\n\n${originalContent}`);
            await reaction.message.reactions.removeAll();
        } else if (emoji === '🔄') {
            log.info(`Regenerating content for: ${opportunity.opportunity_name}`);
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
                savePendingOpportunity(messageId, opportunity, content);

                // Persist to Sheets too, if the opportunity is already committed there
                try {
                    const existingOpp = await sheetsService.getOpportunityById(opportunity.id);
                    if (existingOpp) {
                        await sheetsService.updateContentCaption(opportunity.id, content.caption, content.hashtags);
                        log.info(`Persisted regenerated caption to Sheets for ${opportunity.id}`);
                    }
                } catch (sheetsErr) {
                    log.warn('Failed to persist regenerated caption to Sheets', { error: String(sheetsErr) });
                }

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
