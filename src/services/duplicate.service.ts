// ===========================================
// Duplicate Detection Service
// ===========================================

import { createServiceLogger } from '../utils/logger.js';
import * as sheetsService from './sheets.service.js';
import type { VideoEntry, GeminiExtraction, DuplicateCheckResult } from '../types/index.js';

const log = createServiceLogger('duplicate');

/**
 * Levenshtein distance between two strings.
 * Used for fuzzy name matching to catch near-duplicate opportunities.
 */
function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Calculate similarity ratio between two strings (0 to 1).
 * 1 = identical, 0 = completely different.
 */
function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshteinDistance(a.toLowerCase(), b.toLowerCase()) / maxLen;
}

/**
 * Check if a video/opportunity is a duplicate using three detection layers:
 *
 * 1. Video ID — exact match (same video already processed)
 * 2. Registration Link — exact match (same opportunity from different source)
 * 3. Opportunity Name — fuzzy match (similar name, possibly same opportunity)
 *
 * @param video - The video entry being processed
 * @param extraction - The extracted opportunity data (may be null if not yet extracted)
 * @returns DuplicateCheckResult with reason
 */
export async function checkDuplicate(
  video: VideoEntry,
  extraction: GeminiExtraction | null
): Promise<DuplicateCheckResult> {
  const NOT_DUPLICATE: DuplicateCheckResult = {
    isDuplicate: false,
    reason: 'No duplicate found',
  };

  try {
    const existingOpportunities = await sheetsService.getExistingOpportunities();

    if (existingOpportunities.length === 0) {
      log.debug('No existing opportunities — cannot be a duplicate');
      return NOT_DUPLICATE;
    }

    // Layer 1: Video ID check
    const videoIdMatch = existingOpportunities.find(
      (opp) => opp.source_video.includes(video.videoId)
    );
    if (videoIdMatch) {
      log.info(`Duplicate: Video ID "${video.videoId}" already processed as "${videoIdMatch.opportunity_name}"`);
      return {
        isDuplicate: true,
        reason: `Video already processed (opportunity: "${videoIdMatch.opportunity_name}")`,
        matchedField: 'video_id',
      };
    }

    // Layer 2 & 3 require extraction data
    if (!extraction) {
      return NOT_DUPLICATE;
    }

    // Layer 2: Registration link check
    if (extraction.registration_link && extraction.registration_link !== 'Not specified') {
      const linkMatch = existingOpportunities.find(
        (opp) => opp.registration_link === extraction.registration_link
      );
      if (linkMatch) {
        log.info(`Duplicate: Registration link matches existing opportunity "${linkMatch.opportunity_name}"`);
        return {
          isDuplicate: true,
          reason: `Registration link already exists (opportunity: "${linkMatch.opportunity_name}")`,
          matchedField: 'registration_link',
        };
      }
    }

    // Layer 3: Fuzzy name matching
    if (extraction.opportunity_name) {
      const SIMILARITY_THRESHOLD = 0.85; // 85% similarity = likely duplicate
      for (const opp of existingOpportunities) {
        const sim = similarity(extraction.opportunity_name, opp.opportunity_name);
        if (sim >= SIMILARITY_THRESHOLD) {
          log.info(
            `Duplicate: Name "${extraction.opportunity_name}" similar to "${opp.opportunity_name}" (${(sim * 100).toFixed(1)}% match)`
          );
          return {
            isDuplicate: true,
            reason: `Name similar to existing: "${opp.opportunity_name}" (${(sim * 100).toFixed(1)}% match)`,
            matchedField: 'opportunity_name',
          };
        }
      }
    }

    return NOT_DUPLICATE;
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    log.error('Duplicate check failed', { error: errMsg });
    // On failure, default to NOT duplicate to avoid blocking pipeline
    return NOT_DUPLICATE;
  }
}
