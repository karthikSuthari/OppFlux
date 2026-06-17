import { config } from '../config/env.js';

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
