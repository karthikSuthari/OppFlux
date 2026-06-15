// ===========================================
// Gemini Content Generation Service
// ===========================================

import { GoogleGenAI } from '@google/genai';
import { config } from '../config/env.js';
import { createServiceLogger } from '../utils/logger.js';
import { withRetry } from '../utils/retry.js';
import type { GeminiExtraction, GeminiContentResult } from '../types/index.js';

const log = createServiceLogger('gemini-content');

const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });

/**
 * System prompt for Instagram content generation.
 * Generates caption, hashtags, carousel text, and image prompt.
 */
const CONTENT_PROMPT = `You are a social media content creator specializing in student opportunities. You create engaging, professional Instagram content that drives student engagement.

Given opportunity details, generate Instagram-ready content.

Return ONLY valid JSON in this exact format, with no additional text, markdown, or code fences:
{
  "caption": "An engaging Instagram caption (150-250 words). Include: hook line, opportunity details, eligibility, deadline, CTA. Use emojis strategically. Include line breaks for readability. End with a clear call-to-action.",
  "hashtags": ["hashtag1", "hashtag2", "...up to 20 relevant hashtags without # symbol"],
  "carousel_text": "Short punchy text for carousel slides (50-80 words). Key points only. Use bullet points with emojis.",
  "image_prompt": "A detailed prompt for AI image generation. Describe a clean, modern, professional Instagram post visual. Include: style (flat design/3D/gradient), color scheme, key visual elements (icons, illustrations), text overlay suggestions. The image should be student-oriented and tech-focused."
}

CONTENT GUIDELINES:
1. Be concise and student-focused
2. Avoid spam language (no "AMAZING!!!" or "DON'T MISS THIS!!!")
3. Use a professional but approachable tone
4. Include relevant emojis (📚🎓💻🏆🚀) but don't overdo it
5. Make the caption scannable with line breaks
6. Hashtags should mix popular (#students #opportunities) with niche (#techscholarship)
7. The image prompt should describe a visually striking, modern design
8. Caption must include the registration link if available`;

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
        const result = await ai.models.generateContent({
          model: 'gemini-2.0-flash',
          contents: [
            {
              role: 'user',
              parts: [{ text: CONTENT_PROMPT + '\n\n' + userPrompt }],
            },
          ],
          config: {
            temperature: 0.7, // Higher creativity for content
            maxOutputTokens: 2048,
          },
        });
        return result;
      },
      { operationName: 'gemini.generateContent', maxRetries: 2 }
    );

    const text = response.text?.trim();
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
