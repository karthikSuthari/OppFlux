// ===========================================
// YouTube RSS Feed Service
// ===========================================

import Parser from 'rss-parser';
import { createServiceLogger } from '../utils/logger.js';
import { withRetry } from '../utils/retry.js';
import type { VideoEntry } from '../types/index.js';

const log = createServiceLogger('rss');

/**
 * Custom RSS parser configured for YouTube feed XML namespaces.
 * YouTube feeds include media:group with description and thumbnail.
 */
const parser = new Parser({
  customFields: {
    item: [
      ['yt:videoId', 'ytVideoId'],
      ['media:group', 'mediaGroup'],
    ],
  },
  timeout: 15000,
});

/**
 * Build YouTube RSS feed URL from a channel ID
 */
function buildFeedUrl(channelId: string): string {
  return `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
}

/**
 * Extracts the video description from the media:group XML node.
 * YouTube RSS feeds store the description in media:group > media:description.
 */
function extractDescription(mediaGroup: any): string {
  if (!mediaGroup) return '';

  // media:group is parsed as nested object
  try {
    if (typeof mediaGroup === 'object') {
      // Direct access pattern
      const desc = mediaGroup['media:description'];
      if (Array.isArray(desc)) return desc[0] || '';
      if (typeof desc === 'string') return desc;

      // Sometimes nested differently
      if (mediaGroup['media:description']?.[0]) {
        return String(mediaGroup['media:description'][0]);
      }
    }
  } catch {
    // Fallback
  }

  return '';
}

/**
 * Extract all URLs from a text string (description)
 */
export function extractUrls(text: string): string[] {
  if (!text) return [];
  const urlRegex = /https?:\/\/[^\s<>"')\]]+/gi;
  const matches = text.match(urlRegex);
  return matches ? [...new Set(matches)] : [];
}

/**
 * Fetch and parse a YouTube channel's RSS feed.
 * Returns the most recent videos as VideoEntry objects.
 *
 * @param channelId - YouTube channel ID
 * @param channelName - Channel name for logging
 * @returns Array of VideoEntry objects
 */
export async function fetchChannelFeed(
  channelId: string,
  channelName: string
): Promise<VideoEntry[]> {
  const feedUrl = buildFeedUrl(channelId);

  log.info(`Fetching RSS feed for "${channelName}"`, { channelId, feedUrl });

  try {
    const feed = await withRetry(
      () => parser.parseURL(feedUrl),
      { operationName: `rss.fetch(${channelName})`, maxRetries: 2 }
    );

    if (!feed.items || feed.items.length === 0) {
      log.warn(`No items in feed for "${channelName}"`);
      return [];
    }

    const videos: VideoEntry[] = feed.items.map((item: any) => {
      // Extract video ID — try yt:videoId field, fallback to URL parsing
      let videoId = item.ytVideoId || '';
      if (!videoId && item.id) {
        // id format: yt:video:VIDEO_ID
        const idMatch = String(item.id).match(/yt:video:(.+)/);
        if (idMatch) videoId = idMatch[1];
      }
      if (!videoId && item.link) {
        const urlMatch = String(item.link).match(/[?&]v=([a-zA-Z0-9_-]+)/);
        if (urlMatch) videoId = urlMatch[1];
      }

      // Extract description from media:group
      const description = extractDescription(item.mediaGroup) || item.contentSnippet || item.content || '';

      return {
        videoId,
        title: item.title || 'Untitled',
        description,
        link: item.link || `https://www.youtube.com/watch?v=${videoId}`,
        publishedAt: item.pubDate || item.isoDate || new Date().toISOString(),
        channelName,
        channelId,
      };
    });

    log.info(`Found ${videos.length} videos for "${channelName}"`);
    return videos;
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    log.error(`Failed to fetch RSS feed for "${channelName}"`, {
      channelId,
      error: errMsg,
    });
    return [];
  }
}
