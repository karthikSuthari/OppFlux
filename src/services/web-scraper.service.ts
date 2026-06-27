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
import { withRetry } from '../utils/retry.js';
import * as sheetsService from '../services/sheets.service.js';
import type { GeminiExtraction, ScrapingSource } from '../types/index.js';

const log = createServiceLogger('web-scraper');

const groq = new Groq({ apiKey: config.groqApiKey });

const DATA_DIR = path.resolve(process.cwd(), 'data');
const VISITED_FILE = path.join(DATA_DIR, 'visited_links.json');
const FAILED_FILE = path.join(DATA_DIR, 'failed_links.json');

// Limits
const MAX_LINKS_PER_SOURCE = 40;
const MAX_VISITED_LINKS = 5000; // Prune beyond this
const VISITED_TTL_DAYS = 30; // Drop entries older than 30 days
const MAX_FAIL_RETRIES = 3;
const GLOBAL_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes for entire scrape
const PAGE_TIMEOUT_MS = 30000; // 30 seconds per page navigation

// Realistic browser User-Agent
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

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

// ── Visited link entry with timestamp for TTL ──

interface VisitedEntry {
  url: string;
  timestamp: number; // epoch ms
}

interface FailedEntry {
  url: string;
  retries: number;
  lastAttempt: number; // epoch ms
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
  "rewards": "Prizes, stipends, certificates, swag, or monetary rewards",
  "mode": "Online, Offline, or Hybrid",
  "location": "City/State/Venue or Virtual Platform",
  "fees": "Entry fee, Paid, or Free"
}

If the webpage is NOT about a student opportunity (e.g., it's a tutorial, vlog, product review, news, OR the deadline has already passed), return:
{
  "is_opportunity": false,
  "rejection_reason": "Briefly explain why this was rejected (e.g., 'Deadline passed', 'Not an opportunity', 'No registration link found')",
  "opportunity_name": "",
  "organizer": "",
  "registration_link": "",
  "deadline": "",
  "eligibility": "",
  "benefits": "",
  "rewards": "",
  "mode": "",
  "location": "",
  "fees": ""
}

IMPORTANT RULES:
1. Return ONLY the JSON object — no markdown formatting, no code blocks, no extra text.
2. Be conservative — only mark as opportunity if there is clear evidence.
3. Extract the MOST relevant registration link.
4. CRITICAL DEADLINE CHECK: Pay close attention to "TODAY'S DATE" provided in the user prompt. If the webpage explicitly states a registration deadline or event date that has ALREADY PASSED relative to today's date, you MUST set "is_opportunity": false.`;

// ── Visited links tracking with TTL ──

function loadVisitedLinks(): Map<string, number> {
  const map = new Map<string, number>();
  if (!fs.existsSync(VISITED_FILE)) return map;

  try {
    const raw = JSON.parse(fs.readFileSync(VISITED_FILE, 'utf-8'));
    const now = Date.now();
    const ttlMs = VISITED_TTL_DAYS * 24 * 60 * 60 * 1000;

    // Support both old format (string[]) and new format (VisitedEntry[])
    if (Array.isArray(raw)) {
      for (const item of raw) {
        if (typeof item === 'string') {
          // Old format: treat as recently visited
          map.set(item, now);
        } else if (item && typeof item === 'object' && item.url) {
          const entry = item as VisitedEntry;
          // Prune expired entries
          if (now - entry.timestamp < ttlMs) {
            map.set(entry.url, entry.timestamp);
          }
        }
      }
    }

    // Prune if too many entries (keep most recent)
    if (map.size > MAX_VISITED_LINKS) {
      const sorted = [...map.entries()].sort((a, b) => b[1] - a[1]);
      map.clear();
      for (const [url, ts] of sorted.slice(0, MAX_VISITED_LINKS)) {
        map.set(url, ts);
      }
      log.info(`Pruned visited links from ${sorted.length} to ${map.size}`);
    }
  } catch {
    log.warn('Failed to parse visited links file, starting fresh');
  }

  return map;
}

/**
 * Atomic file write: write to temp file then rename to prevent corruption
 */
function atomicWriteJson(filePath: string, data: unknown): void {
  const tmpPath = filePath + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmpPath, filePath);
}

function saveVisitedLinks(visited: Map<string, number>): void {
  const entries: VisitedEntry[] = [...visited.entries()].map(([url, timestamp]) => ({
    url,
    timestamp,
  }));
  atomicWriteJson(VISITED_FILE, entries);
}

// ── Failed links tracking ──

function loadFailedLinks(): Map<string, FailedEntry> {
  const map = new Map<string, FailedEntry>();
  if (!fs.existsSync(FAILED_FILE)) return map;

  try {
    const raw = JSON.parse(fs.readFileSync(FAILED_FILE, 'utf-8')) as FailedEntry[];
    for (const entry of raw) {
      if (entry.retries < MAX_FAIL_RETRIES) {
        map.set(entry.url, entry);
      }
      // Entries that have exhausted retries are silently dropped
    }
  } catch {
    log.warn('Failed to parse failed links file, starting fresh');
  }

  return map;
}

function saveFailedLinks(failed: Map<string, FailedEntry>): void {
  atomicWriteJson(FAILED_FILE, [...failed.values()]);
}

function recordFailedLink(
  failed: Map<string, FailedEntry>,
  url: string
): void {
  const existing = failed.get(url);
  if (existing) {
    existing.retries++;
    existing.lastAttempt = Date.now();
    if (existing.retries >= MAX_FAIL_RETRIES) {
      log.info(`    🗑️ Permanently marking as failed after ${MAX_FAIL_RETRIES} retries: ${url}`);
      failed.delete(url);
    }
  } else {
    failed.set(url, { url, retries: 1, lastAttempt: Date.now() });
  }
}

// ── Groq extraction ──

/**
 * Parse JSON from a Groq response, tolerating markdown code fences and extra text.
 * Mirrors the robust parser used by the YouTube pipeline.
 */
function parseExtractionJson<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    // continue to fallback
  }
  const codeBlock = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (codeBlock) {
    try {
      return JSON.parse(codeBlock[1].trim()) as T;
    } catch {
      // continue
    }
  }
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0]) as T;
    } catch {
      // final fallback
    }
  }
  return null;
}

async function extractFromWebpage(text: string, sourceUrl: string): Promise<GeminiExtraction | null> {
  const userPrompt = `TODAY'S DATE: ${new Date().toDateString()}\n\nWEBPAGE URL: ${sourceUrl}\n\nWEBPAGE TEXT:\n${text.substring(0, 15000)}\n\nAnalyze this webpage and extract opportunity information.`;

  try {
    const response = await withRetry(
      () => groq.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        temperature: 0.1,
        messages: [{ role: 'user', content: EXTRACTION_PROMPT + '\n\n' + userPrompt }],
      }),
      { operationName: 'web-scraper.extract', maxRetries: 2 }
    );

    const content = response.choices?.[0]?.message?.content?.trim();
    if (!content) return null;

    const parsed = parseExtractionJson<GeminiExtraction>(content);
    if (!parsed) {
      log.warn('Failed to parse Groq extraction response', { sourceUrl, raw: content.substring(0, 300) });
    }
    return parsed;
  } catch (e) {
    // Re-throw so the caller can record this as a RETRYABLE failure (not "permanently visited")
    const errMsg = e instanceof Error ? e.message : String(e);
    log.error('Groq extraction error', { sourceUrl, error: errMsg });
    throw e;
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

// ── Page interaction helpers ──

/**
 * Dismiss cookie consent popups, overlays, and banners that block page interaction.
 * Tries common button selectors — fails silently if none found.
 */
async function dismissPopups(page: import('puppeteer').Page): Promise<void> {
  const dismissSelectors = [
    // Cookie consent buttons
    'button[id*="accept"]',
    'button[id*="cookie"]',
    'button[class*="accept"]',
    'button[class*="consent"]',
    'a[id*="accept"]',
    // Generic dismiss patterns
    '[aria-label="Close"]',
    '[aria-label="Dismiss"]',
    'button[class*="close"]',
    '.cookie-banner button',
    '.consent-banner button',
    '#onetrust-accept-btn-handler',
    '.cc-btn.cc-dismiss',
  ];

  for (const selector of dismissSelectors) {
    try {
      const btn = await page.$(selector);
      if (btn) {
        await btn.click();
        await new Promise(resolve => setTimeout(resolve, 500));
        log.info('  🍪 Dismissed popup/cookie banner');
        break;
      }
    } catch {
      // Ignore — button might not be interactable
    }
  }
}

/**
 * Aggressively expand ALL content on a listing page:
 * 1. Scrolls to absolute bottom of the page (tracks scroll height)
 * 2. Clicks "Load More" / "Show More" / "View All" / pagination buttons
 * 3. Repeats until no new content loads or max rounds reached
 *
 * This handles: infinite scroll, "load more" buttons, lazy-loaded cards,
 * and paginated event listings.
 */
async function expandAllContent(page: import('puppeteer').Page): Promise<void> {
  const MAX_EXPAND_ROUNDS = 20;
  const SCROLL_PAUSE_MS = 2000;

  // Selectors for "Load More" / "Show More" type buttons (case-insensitive via XPath)
  const loadMoreXPaths = [
    '//button[contains(translate(., "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz"), "load more")]',
    '//button[contains(translate(., "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz"), "show more")]',
    '//button[contains(translate(., "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz"), "view more")]',
    '//button[contains(translate(., "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz"), "view all")]',
    '//button[contains(translate(., "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz"), "see more")]',
    '//button[contains(translate(., "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz"), "see all")]',
    '//a[contains(translate(., "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz"), "load more")]',
    '//a[contains(translate(., "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz"), "show more")]',
    '//a[contains(translate(., "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz"), "view more")]',
    '//a[contains(translate(., "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz"), "view all")]',
    '//a[contains(translate(., "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz"), "see all")]',
    // CSS selectors for common class patterns
  ];

  const loadMoreCSSSelectors = [
    'button[class*="load-more"]',
    'button[class*="loadmore"]',
    'button[class*="show-more"]',
    'button[class*="showmore"]',
    'a[class*="load-more"]',
    'a[class*="show-more"]',
    '.load-more',
    '.show-more',
    '.pagination a[class*="next"]',
    'a[aria-label="Next"]',
    'button[aria-label="Next"]',
    'a[rel="next"]',
  ];

  let previousHeight = 0;
  let staleRounds = 0;

  for (let round = 0; round < MAX_EXPAND_ROUNDS; round++) {
    // Step 1: Scroll to the absolute bottom
    const currentHeight = await page.evaluate('document.body.scrollHeight') as number;
    await page.evaluate('window.scrollTo(0, document.body.scrollHeight)');
    await new Promise(resolve => setTimeout(resolve, SCROLL_PAUSE_MS));

    // Step 2: Try clicking a "Load More" button
    let clicked = false;

    // Shared visibility check — the element is passed as the first argument
    // (Puppeteer does NOT bind it to `this`, so the old string IIFE using `this` was broken)
    const isVisible = async (el: import('puppeteer').ElementHandle): Promise<boolean> => {
      return el.evaluate((node: any) => {
        const rect = node.getBoundingClientRect();
        const style = node.ownerDocument.defaultView.getComputedStyle(node);
        return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
      });
    };

    // Try XPath selectors (case-insensitive text match)
    for (const xpath of loadMoreXPaths) {
      try {
        const btn = await page.waitForSelector(`::-p-xpath(${xpath})`, { timeout: 500 });
        if (btn) {
          if (await isVisible(btn)) {
            await btn.click();
            clicked = true;
            log.info(`  📄 Clicked "Load More" button (round ${round + 1})`);
            await new Promise(resolve => setTimeout(resolve, SCROLL_PAUSE_MS));
            break;
          }
        }
      } catch {
        // Button not found or not clickable — try next
      }
    }

    // Try CSS selectors if XPath didn't find anything
    if (!clicked) {
      for (const selector of loadMoreCSSSelectors) {
        try {
          const btn = await page.$(selector);
          if (btn) {
            if (await isVisible(btn)) {
              await btn.click();
              clicked = true;
              log.info(`  📄 Clicked load-more element (round ${round + 1})`);
              await new Promise(resolve => setTimeout(resolve, SCROLL_PAUSE_MS));
              break;
            }
          }
        } catch {
          // Not clickable — try next
        }
      }
    }

    // Step 3: Check if new content was loaded
    const newHeight = await page.evaluate('document.body.scrollHeight') as number;

    if (newHeight === previousHeight && !clicked) {
      staleRounds++;
      if (staleRounds >= 3) {
        log.info(`  ✅ Page fully expanded after ${round + 1} rounds (no new content in ${staleRounds} rounds)`);
        break;
      }
    } else {
      staleRounds = 0;
    }

    previousHeight = newHeight;
  }

  // Final scroll back to top and then to bottom to ensure everything rendered
  await page.evaluate('window.scrollTo(0, 0)');
  await new Promise(resolve => setTimeout(resolve, 500));
  await page.evaluate('window.scrollTo(0, document.body.scrollHeight)');
  await new Promise(resolve => setTimeout(resolve, 1000));
}

// ── Scrape a single source ──

async function scrapeSource(
  source: ScrapingSource,
  visitedLinks: Map<string, number>,
  failedLinks: Map<string, FailedEntry>,
  globalDeadline: number
): Promise<ScrapedOpportunity[]> {
  const results: ScrapedOpportunity[] = [];

  // Check global timeout before starting
  if (Date.now() >= globalDeadline) {
    log.warn(`⏰ Global timeout reached, skipping source: ${source.source_name}`);
    return results;
  }

  log.info(`\n═══ Web Scraping: ${source.source_name} ═══`);
  log.info(`URL: ${source.source_url}`);
  if (source.filter) {
    log.info(`Filter: "${source.filter}"`);
  }

  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-extensions',
      '--single-process',
    ],
  });

  try {
    const page = await browser.newPage();
    await page.setDefaultNavigationTimeout(PAGE_TIMEOUT_MS);
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
    await page.setUserAgent(USER_AGENT);

    // 1. Navigate to the listing page
    log.info('  Navigating to listing page...');
    await page.goto(source.source_url, {
      waitUntil: 'networkidle2',
      timeout: PAGE_TIMEOUT_MS,
    });

    // 1a. Dismiss cookie consent / popup overlays that block interaction
    await dismissPopups(page);

    // 1b. Aggressively scroll and click "Load More" to reveal ALL events
    log.info('  Expanding all events (scroll + click "Load More")...');
    await expandAllContent(page);

    // 2. Extract all links from the fully-expanded page
    //    Exclude navigation/header/footer/sidebar links — only keep links inside
    //    the main content area. Also drop login/signup/account/auth URLs.
    log.info('  Extracting event links...');
    const rawLinkData: { href: string; text: string }[] = await page.evaluate(`
      (() => {
        const NAV_SELECTORS = ['nav', 'header', 'footer', '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]', '.navbar', '.nav', '.header', '.footer', '.sidebar', '.menu', '#header', '#footer', '#navbar'];
        function insideNav(el) {
          let cur = el;
          while (cur && cur !== document.body) {
            if (cur.matches && NAV_SELECTORS.some((sel) => cur.matches(sel) || cur.closest(sel))) {
              return true;
            }
            cur = cur.parentElement;
          }
          return false;
        }
        const URL_DENY = /(\\/login|\\/signup|\\/sign-in|\\/sign-up|\\/register\\/user|\\/auth|\\/account|\\/cart|\\/checkout|\\/profile|\\/dashboard|\\/my-account)/i;
        const results = [];
        document.querySelectorAll('a[href]').forEach((a) => {
          const href = a.href || '';
          if (!href || !href.startsWith('http')) return;
          if (URL_DENY.test(href)) return;
          if (insideNav(a)) return; // skip nav/header/footer links
          let title = (a.innerText || '').trim();
          if (!title) {
             const img = a.querySelector('img');
             title = img ? (img.alt || 'Image Link') : 'Card Link';
          }
          results.push({ href, text: title });
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

    // Remove already-visited (but allow retrying failed links)
    const newLinks = filteredLinks.filter((l) => !visitedLinks.has(l.href));

    log.info(`  Found ${newLinks.length} NEW links after filter (${uniqueLinks.length} total unique, ${filteredLinks.length} matched filter, ${uniqueLinks.length - filteredLinks.length} filtered out)`);

    // 2. Deep-visit each new link (process up to MAX_LINKS_PER_SOURCE per source)
    const limit = Math.min(newLinks.length, MAX_LINKS_PER_SOURCE);
    for (let i = 0; i < limit; i++) {
      // Check global timeout
      if (Date.now() >= globalDeadline) {
        log.warn(`  ⏰ Global timeout reached mid-source, stopping at link ${i + 1}/${limit}`);
        break;
      }

      const eventUrl = newLinks[i].href;
      log.info(`  [${i + 1}/${limit}] Visiting: ${eventUrl}`);

      try {
        await page.goto(eventUrl, {
          waitUntil: 'networkidle2',
          timeout: PAGE_TIMEOUT_MS,
        });

        // Scroll the detail page to load lazy content (registration forms, dates, etc.)
        for (let s = 0; s < 5; s++) {
          await page.evaluate('window.scrollBy(0, 800)');
          await new Promise(resolve => setTimeout(resolve, 800));
        }
        await page.evaluate('window.scrollTo(0, 0)'); // Back to top for full text capture
        await new Promise(resolve => setTimeout(resolve, 500));

        const pageText = await page.evaluate(
          'document.body.innerText.slice(0,15000)'
        ) as string;
        if (pageText.length < 100) {
          log.info('    ⚠️ Too little text, skipping.');
          visitedLinks.set(eventUrl, Date.now());
          continue;
        }

        // If source has a filter, double-check the page content contains the keyword
        if (source.filter && source.filter.trim() !== '') {
          const keyword = source.filter.toLowerCase().trim();
          if (!pageText.toLowerCase().includes(keyword)) {
            log.info(`    🔍 Page doesn't contain filter keyword "${source.filter}", skipping.`);
            visitedLinks.set(eventUrl, Date.now());
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
          const reason = (extraction as any)?.rejection_reason || 'not an opportunity';
          log.info(`    🗑️ Rejected: ${reason}`);
        }

        // Successfully analyzed (valid OR rejected) — mark visited and clear failure
        visitedLinks.set(eventUrl, Date.now());
        failedLinks.delete(eventUrl);
        saveVisitedLinks(visitedLinks);
      } catch (linkErr) {
        const errMsg = linkErr instanceof Error ? linkErr.message : String(linkErr);
        // Quota exhausted: stop scraping this run entirely (no point retrying per-link)
        if (errMsg.includes('429') || errMsg.includes('rate_limit_exceeded')) {
          log.warn('    🚫 Groq quota exhausted — stopping scraper for this run');
          recordFailedLink(failedLinks, eventUrl);
          saveFailedLinks(failedLinks);
          break;
        }
        log.warn(`    ❌ Failed: ${errMsg}`);
        // Track failure for retry instead of permanently marking as visited
        recordFailedLink(failedLinks, eventUrl);
        saveFailedLinks(failedLinks);
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
 *
 * Features:
 * - Global 30-minute timeout to prevent runaway scrapes
 * - TTL-based visited links pruning (30-day expiry)
 * - Failed links tracking with 3-retry limit
 * - Atomic file writes to prevent data corruption
 */
export async function runWebScraper(): Promise<ScrapedOpportunity[]> {
  const allResults: ScrapedOpportunity[] = [];
  const visitedLinks = loadVisitedLinks();
  const failedLinks = loadFailedLinks();
  const globalDeadline = Date.now() + GLOBAL_TIMEOUT_MS;

  log.info(`Visited links loaded: ${visitedLinks.size}, Failed links pending retry: ${failedLinks.size}`);

  // Load sources from Google Sheets
  const sources = await sheetsService.getActiveScrapingSources();

  if (sources.length === 0) {
    log.warn('No active scraping sources found. Add sources to the "ScrapingSources" tab in Google Sheets.');
    return [];
  }

  log.info(`Loaded ${sources.length} active scraping sources from Sheets`);
  log.info(`Global timeout: ${GLOBAL_TIMEOUT_MS / 60000} minutes`);

  // Process ONE source at a time (sequential for 1GB RAM)
  for (const source of sources) {
    if (Date.now() >= globalDeadline) {
      log.warn(`⏰ Global timeout reached, skipping remaining sources`);
      break;
    }

    try {
      const results = await scrapeSource(source, visitedLinks, failedLinks, globalDeadline);
      allResults.push(...results);
      log.info(`  ✅ ${source.source_name}: ${results.length} opportunities found`);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      log.error(`  ❌ Failed to scrape ${source.source_name}: ${errMsg}`);
    }

    // Small pause between sources to let memory settle
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  // Final save
  saveVisitedLinks(visitedLinks);
  saveFailedLinks(failedLinks);

  log.info(`\n═══ Web Scraping Complete: ${allResults.length} opportunities found from ${sources.length} sources ═══`);
  log.info(`  Visited links: ${visitedLinks.size}, Failed links pending retry: ${failedLinks.size}`);
  return allResults;
}
