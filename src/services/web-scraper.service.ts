// ===========================================
// Web Scraper Service — Scrape opportunities from websites
// Sources are loaded from the "ScrapingSources" Google Sheet tab
// ===========================================

import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import Groq from 'groq-sdk';
import { config } from '../config/env.js';
import { createServiceLogger } from '../utils/logger.js';
import * as sheetsService from '../services/sheets.service.js';
import type { GeminiExtraction, ScrapingSource } from '../types/index.js';

const log = createServiceLogger('web-scraper');

const groq = new Groq({ apiKey: config.groqApiKey });

const DATA_DIR = path.resolve(process.cwd(), 'data');
const VISITED_FILE = path.join(DATA_DIR, 'visited_links.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

/**
 * Result from the web scraper — matches the shape the pipeline needs
 */
export interface ScrapedOpportunity {
  extraction: GeminiExtraction;
  sourceUrl: string;
  sourceName: string;
}

const EXTRACTION_PROMPT = `You are an AI assistant that analyzes webpage content about student opportunities.

Given the text from a webpage, determine if it is about a student opportunity (internship, hackathon, scholarship, certification, learning challenge, ambassador program, competition, free course, fellowship, or similar).

If it IS a student opportunity, extract the following fields. If a field is not found, use "Not specified".

Return ONLY valid JSON in this exact format, with no additional text, markdown, or code fences:
{
  "is_opportunity": true,
  "opportunity_name": "Name of the opportunity",
  "organizer": "Organization or company offering it",
  "registration_link": "URL to register or apply",
  "deadline": "Application deadline if mentioned",
  "eligibility": "Who can apply (students, graduates, etc.)",
  "benefits": "What participants get (learning, experience, etc.)",
  "rewards": "Prizes, stipends, certificates, swag, or monetary rewards"
}

If the text is NOT about a student opportunity (e.g., it's a Terms of Service, Privacy Policy, blog post, product review, news), return:
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
2. Be conservative — only mark as opportunity if there is clear evidence.
3. Extract the MOST relevant registration link.
4. CRITICAL DEADLINE CHECK: Pay close attention to "TODAY'S DATE" provided in the user prompt. If the webpage explicitly states a registration deadline or event date that has ALREADY PASSED relative to today's date, you MUST set "is_opportunity": false.`;

// ── Visited links tracking ──

function loadVisitedLinks(): Set<string> {
  if (fs.existsSync(VISITED_FILE)) {
    try {
      return new Set(JSON.parse(fs.readFileSync(VISITED_FILE, 'utf-8')));
    } catch {
      return new Set();
    }
  }
  return new Set();
}

function saveVisitedLinks(visited: Set<string>): void {
  fs.writeFileSync(VISITED_FILE, JSON.stringify([...visited], null, 2), 'utf-8');
}

// ── Groq extraction ──

async function extractFromWebpage(text: string, sourceUrl: string): Promise<GeminiExtraction | null> {
  try {
    const userPrompt = `TODAY'S DATE: ${new Date().toDateString()}\n\nWEBPAGE URL: ${sourceUrl}\n\nWEBPAGE TEXT:\n${text.substring(0, 15000)}\n\nAnalyze this webpage and extract opportunity information.`;

    const response = await groq.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      temperature: 0.1,
      messages: [{ role: 'user', content: EXTRACTION_PROMPT + '\n\n' + userPrompt }],
    });

    let content = response.choices?.[0]?.message?.content?.trim();
    if (!content) return null;

    // Clean up markdown code blocks if Groq adds them
    content = content.replace(/```json/g, '').replace(/```/g, '').trim();

    const parsed = JSON.parse(content) as GeminiExtraction;
    return parsed;
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    log.error('Groq extraction error', { error: errMsg });
    return null;
  }
}

// ── Filter logic ──

/**
 * Check if a link or its surrounding text matches the filter keyword.
 * If filter is empty, all links pass.
 */
function matchesFilter(url: string, linkText: string, filter: string): boolean {
  if (!filter || filter.trim() === '') return true;
  const keyword = filter.toLowerCase().trim();
  return url.toLowerCase().includes(keyword) || linkText.toLowerCase().includes(keyword);
}

// ── Scrape a single source ──

async function scrapeSource(
  source: ScrapingSource,
  visitedLinks: Set<string>
): Promise<ScrapedOpportunity[]> {
  const results: ScrapedOpportunity[] = [];

  log.info(`\n═══ Web Scraping: ${source.source_name} ═══`);
  log.info(`URL: ${source.source_url}`);
  if (source.filter) {
    log.info(`Filter: "${source.filter}"`);
  }

  const browser = await puppeteer.launch({
    headless: 'new' as any,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });

  try {
    const page = await browser.newPage();
    await page.setRequestInterception(true);

    page.on('request', req => {
      const type = req.resourceType();

      if (
        type === 'image' ||
        type === 'media' ||
        type === 'font'
      ) {
        req.abort();
      } else {
        req.continue();
      }
    });
    await page.setUserAgent(
      'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'
    );

    // 1. Find event links on the listing page
    log.info('  Searching for event links...');
    await page.goto(source.source_url, {
      waitUntil: 'networkidle2', // Wait for React/APIs to load
      timeout: 30000
    });

    // Scroll down multiple times to trigger lazy-loaded cards
    for (let s = 0; s < 3; s++) {
      await page.evaluate('window.scrollBy(0, 1000)');
      await new Promise(resolve => setTimeout(resolve, 1500));
    }

    // Get links WITH their text (for filter matching)
    const rawLinkData: { href: string; text: string }[] = await page.evaluate(`
      (() => {
        const results = [];
        document.querySelectorAll('a[href]').forEach((a) => {
          // Grab text, or if it's an image link, try to grab alt text or just use a generic title
          let title = a.innerText.trim();
          if (!title) {
             const img = a.querySelector('img');
             title = img ? (img.alt || 'Image Link') : 'Card Link';
          }
          const href = a.href;
          // Accept any link that has a valid http url, removing the strict text length requirement
          if (href && href.startsWith('http') && !href.includes('login') && !href.includes('signup')) {
            results.push({ href, text: title });
          }
        });
        return results;
      })()
    `) as { href: string; text: string }[];

    // Deduplicate by href
    const seenHrefs = new Set<string>();
    const uniqueLinks = rawLinkData.filter((l) => {
      if (seenHrefs.has(l.href)) return false;
      seenHrefs.add(l.href);
      return true;
    });

    // Apply filter
    const filteredLinks = uniqueLinks.filter((l) => matchesFilter(l.href, l.text, source.filter));

    // Remove already-visited
    const newLinks = filteredLinks.filter((l) => !visitedLinks.has(l.href));

    log.info(`  Found ${newLinks.length} NEW links after filter (${uniqueLinks.length} total unique, ${filteredLinks.length} matched filter, ${uniqueLinks.length - filteredLinks.length} filtered out)`);

    // 2. Deep-visit each new link (process up to 20 per source)
    const limit = Math.min(newLinks.length, 20);
    for (let i = 0; i < limit; i++) {
      const eventUrl = newLinks[i].href;
      log.info(`  [${i + 1}/${limit}] Visiting: ${eventUrl}`);

      try {
        await page.goto(eventUrl, {
          waitUntil: 'networkidle2',
          timeout: 80000
        });
        const pageText = await page.evaluate(
          'document.body.innerText.slice(0,15000)'
        ) as string;
        if (pageText.length < 100) {
          log.info('    ⚠️ Too little text, skipping.');
          visitedLinks.add(eventUrl);
          continue;
        }

        // If source has a filter, double-check the page content contains the keyword
        if (source.filter && source.filter.trim() !== '') {
          const keyword = source.filter.toLowerCase().trim();
          if (!pageText.toLowerCase().includes(keyword)) {
            log.info(`    🔍 Page doesn't contain filter keyword "${source.filter}", skipping.`);
            visitedLinks.add(eventUrl);
            continue;
          }
        }

        log.info('    🧠 Analyzing with AI...');
        const extraction = await extractFromWebpage(pageText, eventUrl);

        if (extraction && extraction.is_opportunity) {
          log.info(`    🎉 VALID: ${extraction.opportunity_name}`);

          // Fix registration link if Groq returned "Not specified"
          if (!extraction.registration_link || extraction.registration_link === 'Not specified') {
            extraction.registration_link = eventUrl;
          }

          results.push({
            extraction,
            sourceUrl: eventUrl,
            sourceName: source.source_name,
          });
        } else {
          log.info('    🗑️ Rejected (not an opportunity)');
        }

        visitedLinks.add(eventUrl);
        saveVisitedLinks(visitedLinks);
      } catch (linkErr) {
        const errMsg = linkErr instanceof Error ? linkErr.message : String(linkErr);
        log.warn(`    ❌ Failed: ${errMsg}`);
        visitedLinks.add(eventUrl); // Don't retry failed links
      }
    }
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    log.error(`  ❌ Source failed: ${source.source_name}`, { error: errMsg });
  } finally {
    log.info('  🧹 Closing browser...');
    await browser.close();
  }

  return results;
}

// ── Main scraper function ──

/**
 * Run the web scraper across all active sources from the ScrapingSources sheet.
 * Sources are processed ONE AT A TIME (sequential) to stay within 1GB RAM.
 * Returns an array of scraped opportunities ready for the pipeline.
 */
export async function runWebScraper(): Promise<ScrapedOpportunity[]> {
  const allResults: ScrapedOpportunity[] = [];
  const visitedLinks = loadVisitedLinks();

  // Load sources from Google Sheets
  const sources = await sheetsService.getActiveScrapingSources();

  if (sources.length === 0) {
    log.warn('No active scraping sources found. Add sources to the "ScrapingSources" tab in Google Sheets.');
    return [];
  }

  log.info(`Loaded ${sources.length} active scraping sources from Sheets`);

  // Process ONE source at a time (sequential for 1GB RAM)
  for (const source of sources) {
    try {
      const results = await scrapeSource(source, visitedLinks);
      allResults.push(...results);
      log.info(`  ✅ ${source.source_name}: ${results.length} opportunities found`);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      log.error(`  ❌ Failed to scrape ${source.source_name}: ${errMsg}`);
    }

    // Small pause between sources to let memory settle
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  log.info(`\n═══ Web Scraping Complete: ${allResults.length} opportunities found from ${sources.length} sources ═══`);
  return allResults;
}
