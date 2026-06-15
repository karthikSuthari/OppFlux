// ===========================================
// Gemini Image Generation Service
// ===========================================

import { GoogleGenAI } from '@google/genai';
import { config } from '../config/env.js';
import { createServiceLogger } from '../utils/logger.js';
import { withRetry } from '../utils/retry.js';
import fs from 'fs';
import path from 'path';

const log = createServiceLogger('gemini-image');

const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });

/**
 * Ensure the image output directory exists
 */
function ensureImageDir(): string {
  const imageDir = path.resolve(config.imageOutputDir);
  if (!fs.existsSync(imageDir)) {
    fs.mkdirSync(imageDir, { recursive: true });
    log.info(`Created image output directory: ${imageDir}`);
  }
  return imageDir;
}

/**
 * Generate an Instagram-ready image using Gemini's image generation model.
 *
 * @param imagePrompt - Detailed prompt describing the desired image
 * @param opportunityId - Unique ID for file naming
 * @returns Local file path of the saved image, or empty string on failure
 */
export async function generateImage(
  imagePrompt: string,
  opportunityId: string
): Promise<string> {
  log.info(`Generating image for opportunity: ${opportunityId}`);

  const enhancedPrompt = `Create a professional Instagram post image (1080x1080 square format) with these requirements:
- Clean modern design with gradient background
- Professional typography with high readability
- Student and technology oriented visual style
- No text on the image itself (text will be added as overlay later)
- Vibrant but professional color scheme
- Visual elements like icons, abstract shapes, or illustrations

SPECIFIC DESIGN: ${imagePrompt}

Style: Modern flat design with subtle 3D elements, gradient backgrounds, clean composition suitable for Instagram feed.`;

  try {
    const imageDir = ensureImageDir();
    const fileName = `opp_${opportunityId}_${Date.now()}.png`;
    const filePath = path.join(imageDir, fileName);

    const response = await withRetry(
      async () => {
        const result = await ai.models.generateContent({
          model: 'gemini-2.0-flash-preview-image-generation',
          contents: [
            {
              role: 'user',
              parts: [{ text: enhancedPrompt }],
            },
          ],
          config: {
            responseModalities: ['IMAGE', 'TEXT'],
          },
        });
        return result;
      },
      { operationName: 'gemini.generateImage', maxRetries: 2, baseDelayMs: 2000 }
    );

    // Extract image data from response
    const candidates = response.candidates;
    if (!candidates || candidates.length === 0) {
      log.warn('No candidates in Gemini image response');
      return '';
    }

    const parts = candidates[0].content?.parts;
    if (!parts) {
      log.warn('No parts in Gemini image response');
      return '';
    }

    for (const part of parts) {
      if (part.inlineData?.data) {
        // Decode base64 image data and save to file
        const imageBuffer = Buffer.from(part.inlineData.data, 'base64');
        fs.writeFileSync(filePath, imageBuffer);
        log.info(`Image saved: ${filePath} (${(imageBuffer.length / 1024).toFixed(1)} KB)`);
        return filePath;
      }
    }

    log.warn('No image data found in Gemini response parts');
    return '';
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    log.error('Gemini image generation failed', {
      opportunityId,
      error: errMsg,
    });

    // Don't throw — image generation failure shouldn't stop the pipeline
    return '';
  }
}
