import { config } from '../config/env.js';
import { discordClient } from './discord-bot.js';
import { TextChannel } from 'discord.js';

export async function sendDiscordMessage(message: string): Promise<void> {
  if (!config.discordWebhookUrl) {
    throw new Error('DISCORD_WEBHOOK_URL not configured');
  }

  const response = await fetch(config.discordWebhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      content: message,
    }),
  });

  if (!response.ok) {
    throw new Error(`Discord webhook failed: ${response.status}`);
  }
}

export async function sendDiscordReviewMessage(message: string): Promise<string | null> {
  if (!config.discordChannelId) {
    throw new Error('DISCORD_CHANNEL_ID not configured');
  }

  try {
    const channel = await discordClient.channels.fetch(config.discordChannelId);
    if (!channel || !(channel instanceof TextChannel)) {
      throw new Error('Invalid Discord channel');
    }

    const sentMessage = await channel.send(message);
    
    // Add reactions
    await sentMessage.react('✅');
    await sentMessage.react('❌');
    await sentMessage.react('🔄');
    
    return sentMessage.id;
  } catch (error) {
    console.error('Failed to send discord review message:', error);
    return null;
  }
}
