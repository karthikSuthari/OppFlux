// ===========================================
// Gemini Opportunity Extraction Service
// ===========================================

import Groq from 'groq-sdk';
import { config } from '../config/env.js';
import { createServiceLogger } from '../utils/logger.js';
import { withRetry } from '../utils/retry.js';
import type { GeminiExtraction, VideoEntry } from '../types/index.js';

const log = createServiceLogger('gemini-extract');

const groq = new Groq({
  apiKey: config.groqApiKey,
});

/**
 * System prompt for opportunity extraction.
 * Designed to extract structured data from YouTube video titles and descriptions.
 */
const EXTRACTION_PROMPT = `You are an AI assistant that analyzes YouTube video content about student opportunities.

Given a video title and description, determine if the video is about a student opportunity (internship, hackathon, scholarship, certification, learning challenge, ambassador program, competition, free course, fellowship, or similar).

If it IS a student opportunity, extract the following fields. If a field is not found, use "Not specified".

Return ONLY valid JSON in this exact format, with no additional text, markdown, or code fences:
{
  "is_opportunity": true,
  "opportunity_name": "Name of the opportunity",
  "organizer": "Organization or company offering it",
  "registration_link": "URL to register or apply (look in the description for links)",
  "deadline": "Application deadline if mentioned",
  "eligibility": "Who can apply (students, graduates, etc.)",
  "benefits": "What participants get (learning, experience, etc.)",
  "rewards": "Prizes, stipends, certificates, swag, or monetary rewards"
}

If the video is NOT about a student opportunity (e.g., it's a tutorial, vlog, product review, news), return:
{
  "is_opportunity": false,
  "opportunity_name": "",
  "organizer": "",
  "registration_link": "",
  "deadline": "",
  "eligibility": "",
  "benefits": "",
  "rewards": ""
}

IMPORTANT RULES:
1. Return ONLY the JSON object — no markdown formatting, no code blocks, no extra text.
2. For registration_link, search the description for URLs that look like registration/apply/signup pages.
3. Be conservative — only mark as opportunity if there is clear evidence.
4. Extract the MOST relevant registration link, not all links.
5. CRITICAL DEADLINE CHECK: Pay close attention to "TODAY'S DATE" provided in the user prompt. If the video explicitly states a registration deadline or event date that has ALREADY PASSED relative to today's date, you MUST set "is_opportunity": false.`;

/**
 * Extract structured opportunity data from a YouTube video using Gemini.
 *
 * @param video - The video entry with title and description
 * @returns Extracted opportunity data, or null if not an opportunity or on failure
 */
export async function extractOpportunity(
  video: VideoEntry
): Promise<GeminiExtraction | null> {
  log.info(`Extracting opportunity from: "${video.title}"`);

  const userPrompt = `TODAY'S DATE: ${new Date().toDateString()}\n\nVIDEO TITLE: ${video.title}

VIDEO DESCRIPTION:
${video.description || 'No description available'}

VIDEO URL: ${video.link}

Analyze this video and extract opportunity information.`;

  try {
    const response = await withRetry(
      async () => {
        const result = await groq.chat.completions.create({
  model: 'llama-3.3-70b-versatile',
  temperature: 0.1,
  messages: [
    {
      role: 'user',
      content: EXTRACTION_PROMPT + '\n\n' + userPrompt,
    },
  ],
});

return result;
      },
      { operationName: 'gemini.extractOpportunity', maxRetries: 2 }
    );

    const text = response.choices?.[0]?.message?.content?.trim();
    if (!text) {
      log.warn('Empty response from Gemini for extraction', { videoId: video.videoId });
      return null;
    }

    // Parse JSON response — handle potential markdown wrapping
    const extraction = parseGeminiJson<GeminiExtraction>(text);

    if (!extraction) {
      log.warn('Failed to parse Gemini extraction response', {
        videoId: video.videoId,
        rawResponse: text.substring(0, 500),
      });
      return null;
    }

    if (!extraction.is_opportunity) {
      log.info(`Video "${video.title}" is not an opportunity`);
      return null;
    }

    // Validate required fields
    if (!extraction.opportunity_name || extraction.opportunity_name === 'Not specified') {
      log.warn('Extraction missing opportunity_name, skipping', { videoId: video.videoId });
      return null;
    }

    log.info(`Extracted opportunity: "${extraction.opportunity_name}" by ${extraction.organizer}`);
    return extraction;
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    log.error('Gemini extraction failed', { videoId: video.videoId, error: errMsg });
    return null;
  }
}

/**
 * Parse JSON from Gemini response, handling markdown code fences and extra text
 */
function parseGeminiJson<T>(text: string): T | null {
  // Try direct parse first
  try {
    return JSON.parse(text) as T;
  } catch {
    // Continue to fallback
  }

  // Try extracting from markdown code fence
  const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (codeBlockMatch) {
    try {
      return JSON.parse(codeBlockMatch[1].trim()) as T;
    } catch {
      // Continue to next fallback
    }
  }

  // Try finding JSON object in the text
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0]) as T;
    } catch {
      // Final fallback failed
    }
  }

  return null;
}
