// ===========================================
// Gemini Content Generation Service
// ===========================================

import Groq from 'groq-sdk';
import { config } from '../config/env.js';
import { createServiceLogger } from '../utils/logger.js';
import { withRetry } from '../utils/retry.js';
import type { GeminiExtraction, GeminiContentResult } from '../types/index.js';

const log = createServiceLogger('gemini-content');

const groq = new Groq({
  apiKey: config.groqApiKey,
});

/**
 * System prompt for Instagram content generation.
 * Generates caption, hashtags, carousel text, and image prompt.
 */

const CONTENT_PROMPT = `You are a social media content creator specializing in student opportunities.

Given opportunity details, generate Instagram-ready content.

Return ONLY valid JSON.

Do not use markdown.
Do not use code fences.
Do not explain anything.

Escape newlines using \\n.

Output MUST be parseable by JSON.parse().

Expected format:

{
  "caption":"...",
  "hashtags":["a","b"],
  "carousel_text":"...",
  "image_prompt":"..."
}

Guidelines:

- Caption: 150-250 words
- Professional but student-friendly tone
- Use emojis sparingly
- Include CTA
- Include registration link if available
- Hashtags should NOT contain #
- carousel_text should be short
- image_prompt should describe a modern Instagram visual
`;

/**
 * Generate Instagram-ready content from opportunity data.
 *
 * @param extraction - The extracted opportunity data from Gemini
 * @param videoTitle - Original video title for context
 * @returns Generated content, or null on failure
 */
export async function generateContent(
  extraction: GeminiExtraction,
  videoTitle: string
): Promise<GeminiContentResult | null> {
  log.info(`Generating content for: "${extraction.opportunity_name}"`);

  const userPrompt = `Generate Instagram content for this student opportunity:

OPPORTUNITY NAME: ${extraction.opportunity_name}
ORGANIZER: ${extraction.organizer}
REGISTRATION LINK: ${extraction.registration_link}
DEADLINE: ${extraction.deadline}
ELIGIBILITY: ${extraction.eligibility}
BENEFITS: ${extraction.benefits}
REWARDS: ${extraction.rewards}
SOURCE: ${videoTitle}

Create engaging, professional Instagram content for this opportunity.`;

  try {
    const response = await withRetry(
      async () => {
      const result = await groq.chat.completions.create({
  model: 'llama-3.3-70b-versatile',
  temperature: 0.7,
 response_format: {
    type: 'json_object'
  },
  messages: [
    {
      role: 'user',
      content: CONTENT_PROMPT + '\n\n' + userPrompt,
    },
  ],
});

return result;  
      },
      { operationName: 'gemini.generateContent', maxRetries: 2 }
    );

       const text = response.choices?.[0]?.message?.content?.trim(); 
      if (!text) {
      log.warn('Empty response from Gemini for content generation');
      return null;
    }

    const content = parseGeminiJson<GeminiContentResult>(text);

    if (!content) {
      log.warn('Failed to parse Gemini content response', {
        rawResponse: text.substring(0, 500),
      });
      return null;
    }

    // Validate and normalize
    if (!content.caption) {
      log.warn('Content generation returned empty caption');
      return null;
    }

    // Ensure hashtags is an array
    if (!Array.isArray(content.hashtags)) {
      content.hashtags = typeof content.hashtags === 'string'
        ? (content.hashtags as string).split(/[,\s]+/).filter(Boolean)
        : [];
    }

    // Remove # prefix if present
    content.hashtags = content.hashtags.map((tag: string) =>
      tag.replace(/^#/, '').trim()
    ).filter(Boolean);

    log.info(`Generated content with ${content.caption.length} char caption, ${content.hashtags.length} hashtags`);
    return content;
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    log.error('Gemini content generation failed', { error: errMsg });
    return null;
  }
}

/**
 * Parse JSON from Gemini response, handling markdown code fences
 */
function parseGeminiJson<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch { /* continue */ }

  const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (codeBlockMatch) {
    try {
      return JSON.parse(codeBlockMatch[1].trim()) as T;
    } catch { /* continue */ }
  }

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0]) as T;
    } catch { /* continue */ }
  }

  return null;
}
