import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import Groq from 'groq-sdk';
import { fileURLToPath } from 'url';

// Setup environment variables from parent directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const groq = new Groq({ apiKey: process.env.GROQ });

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

If the text is NOT about a student opportunity (e.g., it's a Terms of Service, Privacy Policy, blog post, vlog, product review, news), return:
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
3. Extract the MOST relevant registration link.`;

const SOURCES = [
    { name: 'Unstop Competitions', url: 'https://unstop.com/competitions' },
    { name: 'Unstop Hackathons', url: 'https://unstop.com/hackathons' },
    { name: 'Google Cloud Arcade', url: 'https://go.cloudskillsboost.google/arcade' },
    { name: 'Google Skills Games', url: 'https://www.skills.google/games/' },
    { name: 'Microsoft Tech Community', url: 'https://techcommunity.microsoft.com/blog/skills-hub-blog' },
    { name: 'Microsoft AI Skills Navigator', url: 'https://aiskillsnavigator.microsoft.com/' },
    { name: 'Devnovate Events', url: 'https://devnovate.co/events' },
    { name: 'HackWithIndia', url: 'https://hackwithindia.in/' }
];

const VISITED_FILE = path.join(__dirname, 'visited_links.json');
const OUTPUT_FILE = path.join(__dirname, 'scraped_opportunities.json');

// Load visited links
let visitedLinks = new Set();
if (fs.existsSync(VISITED_FILE)) {
    visitedLinks = new Set(JSON.parse(fs.readFileSync(VISITED_FILE, 'utf-8')));
}

// Load existing scraped opportunities
let allOpportunities = [];
if (fs.existsSync(OUTPUT_FILE)) {
    allOpportunities = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf-8'));
}

async function extractWithGemini(text, sourceUrl) {
    try {
        const userPrompt = `WEBPAGE URL: ${sourceUrl}\n\nWEBPAGE TEXT:\n${text.substring(0, 15000)}\n\nAnalyze this webpage and extract opportunity information.`;
        
        const response = await groq.chat.completions.create({
            model: 'llama-3.1-8b-instant',
            temperature: 0.1,
            messages: [{ role: 'user', content: EXTRACTION_PROMPT + '\n\n' + userPrompt }]
        });

        let content = response.choices?.[0]?.message?.content?.trim();
        if (!content) return null;

        // Clean up markdown code blocks if Groq adds them
        content = content.replace(/```json/g, '').replace(/```/g, '').trim();
        return JSON.parse(content);
    } catch (e) {
        console.error('Groq parsing error:', e.message);
        return null;
    }
}

async function scrapeAll() {
    for (const source of SOURCES) {
        console.log(`\n=========================================`);
        console.log(`🚀 Starting scraping for: ${source.name}`);
        console.log(`🔗 URL: ${source.url}`);
        
        const browser = await puppeteer.launch({
            headless: "new",
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
        });
        
        try {
            const page = await browser.newPage();
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
            
            // 1. Find all links on the main page
            console.log(`Searching for event links...`);
            await page.goto(source.url, { waitUntil: 'networkidle2', timeout: 45000 });
            await page.evaluate(() => window.scrollBy(0, document.body.scrollHeight / 2));
            await new Promise(resolve => setTimeout(resolve, 2000));

            const rawLinks = await page.evaluate(() => {
                const results = [];
                document.querySelectorAll('a').forEach(a => {
                    const title = a.innerText.trim();
                    const href = a.href;
                    if (title.length > 15 && href && href.startsWith('http')) {
                        results.push(href);
                    }
                });
                return results;
            });

            // Filter unique & unvisited links
            const newLinks = [...new Set(rawLinks)].filter(link => !visitedLinks.has(link));
            console.log(`✅ Found ${newLinks.length} NEW potential event links.`);

            // 2. Visit each new link and extract deep content
            for (let i = 0; i < Math.min(newLinks.length, 5); i++) { // Limit to 5 per source for safety/speed right now
                const eventUrl = newLinks[i];
                console.log(`\n  [${i+1}/${Math.min(newLinks.length, 5)}] Visiting: ${eventUrl}`);
                
                try {
                    await page.goto(eventUrl, { waitUntil: 'networkidle2', timeout: 30000 });
                    const pageText = await page.evaluate(() => document.body.innerText);
                    
                    if (pageText.length < 100) {
                        console.log(`  ⚠️ Page has too little text, skipping.`);
                        visitedLinks.add(eventUrl);
                        continue;
                    }

                    console.log(`  🧠 Analyzing with Gemini...`);
                    const extractedData = await extractWithGemini(pageText, eventUrl);
                    
                    if (extractedData && extractedData.is_opportunity) {
                        console.log(`  🎉 VALID OPPORTUNITY: ${extractedData.opportunity_name}`);
                        
                        // Structure like Google Sheets
                        allOpportunities.push({
                            id: crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(),
                            opportunity_name: extractedData.opportunity_name,
                            organizer: extractedData.organizer,
                            registration_link: extractedData.registration_link !== 'Not specified' ? extractedData.registration_link : eventUrl,
                            deadline: extractedData.deadline,
                            eligibility: extractedData.eligibility,
                            benefits: extractedData.benefits,
                            rewards: extractedData.rewards,
                            source_video: eventUrl, // Using this field to store the scraped URL
                            source_channel: source.name,
                            status: 'new',
                            created_at: new Date().toISOString()
                        });
                        
                        // Save immediately so we don't lose data
                        fs.writeFileSync(OUTPUT_FILE, JSON.stringify(allOpportunities, null, 2), 'utf-8');
                    } else {
                        console.log(`  🗑️ Rejected by AI (Not an opportunity)`);
                    }

                    // Mark as visited
                    visitedLinks.add(eventUrl);
                    fs.writeFileSync(VISITED_FILE, JSON.stringify([...visitedLinks], null, 2), 'utf-8');

                } catch (linkError) {
                    console.log(`  ❌ Failed to process ${eventUrl}: ${linkError.message}`);
                    visitedLinks.add(eventUrl); // Mark failed as visited so we don't infinitely retry
                }
            }

        } catch (error) {
            console.error(`❌ Error scraping ${source.name}:`, error.message);
        } finally {
            console.log(`🧹 Closing browser...`);
            await browser.close();
        }
    }

    console.log(`\n🎉 Deep Scraping complete! Results saved to ${OUTPUT_FILE}`);
}

scrapeAll().catch(console.error);
