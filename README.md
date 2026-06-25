# 🎓 OppFlux: AI-Powered Opportunity Discovery Platform (v2.0.0)

[![TypeScript](https://img.shields.io/badge/Language-TypeScript-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Runtime-Node.js%2020%2B-green.svg)](https://nodejs.org/)
[![AI-Gemini](https://img.shields.io/badge/AI-Gemini%202.0%20Flash-orange.svg)](https://aistudio.google.com/)
[![License](https://img.shields.io/badge/License-MIT-purple.svg)](LICENSE)

An automated pipeline that monitors YouTube feeds and executes aggressive web-scraping to discover student opportunities. It leverages Google Gemini AI to extract structured data, generate Instagram-ready captions and visuals, saves everything to Google Sheets, and hooks into Discord for real-time review.

---

## 📋 Table of Contents

- [Architecture](#-architecture)
- [Features](#-features)
- [Tech Stack](#-tech-stack)
- [Prerequisites](#-prerequisites)
- [Quick Start](#-quick-start)
- [Google Sheets Setup](#-google-sheets-setup)
- [Configuration Reference](#-configuration-reference)
- [Deployment (Oracle Cloud / VM)](#-deployment-oracle-cloud--vm)
- [Process Management (PM2)](#-process-management-pm2)
- [Project Structure](#-project-structure)
- [Troubleshooting](#-troubleshooting)
- [Repository Public Release Safety](#-repository-public-release-safety)
- [License](#-license)

---

## 🏗 Architecture

The system is split into two components managed by PM2:
1. **The Pipeline (Cron Job)**: Runs every 5 hours to poll sources, run scrapers, extract details, and save them.
2. **The Server (Always Running Daemon)**: Serves a health check endpoint and hosts the Discord Bot client listening for reactions on pending opportunities.

```
                  ┌───────────────────────────────┐
                  │          PM2 PROCESS          │
                  └──────────────┬────────────────┘
                                 │
         ┌───────────────────────┴───────────────────────┐
         ▼ (Cron Schedule)                               ▼ (Always-On Daemon)
┌────────────────────────────────┐              ┌────────────────────────────────┐
│     PIPELINE RUNNER (Index)    │              │     UNIFIED SERVER (Server)    │
│  - Poll YouTube Feed Channels  │              │  - Runs Express Health Checks  │
│  - Run Aggressive Web Scraper  │              │  - Monitors Discord Reactions  │
│  - AI Feature Extraction       │              │  - Updates Sheets Statuses     │
│  - Social Content Generation   │              └────────────────────────────────┘
│  - Google Sheets Storage       │
└────────────────────────────────┘
```

### Data Flow

```
[Sources: RSS/Scraping] ➔ [3-Layer Deduplication] ➔ [Gemini AI Extraction] ➔ [Gemini Visuals & Captions] ➔ [Discord Review Embed] ➔ [Google Sheets Approval]
```

---

## ✨ Features

- **Automated Opportunity Discovery**: Watches YouTube RSS feeds and utilizes a Puppeteer scraper configured with automatic scrolling, pop-up dismissal, and detailed page extraction.
- **AI Extraction & Reasoning**: Extracts structured data (event name, organizer, deadline, eligibility, rewards, and fees) using Gemini. Rejects stale or non-opportunity links.
- **Discord Feedback Loop**: Pushes pending items to a designated Discord channel. Approving or rejecting via emoji reactions directly updates the source spreadsheet.
- **Dynamic Content Generator**: Formats captions, targeted hashtags, and high-quality image generation prompts tailored for Instagram.
- **Robust Duplication Safeguards**: Avoids spam using a 3-layer check combining Video ID matching, link tracking, and fuzzy string distance matching.
- **Log Management**: Structured file log rotation using Winston.

---

## 🛠 Tech Stack

- **Runtime Environment**: Node.js + TypeScript
- **Web Scraping**: Puppeteer
- **AI Engines**: Google Gemini API (`@google/genai`) & Groq SDK (Llama-3.3-70b-versatile)
- **Data Store**: Google Sheets API via `google-spreadsheet`
- **Orchestration**: Express.js & Discord.js (`v14`)
- **Process Management**: PM2

---

## 📋 Prerequisites

Before running the application, make sure you have:
1. **Node.js 20+** installed on your server or local environment.
2. **Gemini API Key** from [Google AI Studio](https://aistudio.google.com/apikey).
3. **Groq API Key** (optional, for alternative reasoning engines).
4. **Google Cloud Service Account** with the **Google Sheets API** enabled.
5. **Google Sheets ID** of the spreadsheet you want to store details on.
6. **Discord Bot Token & Channel Webhook** for notifications.

---

## 🚀 Quick Start

### 1. Clone & Install
```bash
git clone https://github.com/karthikSuthari/Content.git
cd Content
npm install
```

### 2. Set Up Environment Variables
Copy the template configuration file:
```bash
cp .env.example .env
```
Fill in the variables in `.env` (see the [Configuration Reference](#-configuration-reference) section).

### 3. Initialize Spreadsheet Columns
Share your Google Sheet with your service account email (Editor access). 
*(Note: Missing sheets/tabs are auto-created when the pipeline boots).*

### 4. Running Scripts
```bash
# Run Express server & Discord Bot (Local Dev)
npm run dev

# Run Pipeline Engine (Local Dev)
npm run dev:pipeline

# Run Pipeline in Dry Run Mode (No Google Sheets mutations)
npm run pipeline:dry-run

# Run Independent Scraper Test
npm run scrape

# Build & Run Production Bundle
npm run build
npm run start           # Starts server daemon
npm run start:pipeline  # Runs pipeline run once
```

---

## 📊 Google Sheets Setup

Share the spreadsheet with your service account (e.g. `your-service-account@your-project.iam.gserviceaccount.com`) as an **Editor**. The engine will automatically construct the tabs if they do not exist:

1. **Channels**: Monitors YouTube channel IDs.
   * Required headers: `channel_name`, `channel_id`, `active`
2. **Opportunities**: Extracted raw data.
   * Required headers: `id`, `opportunity_name`, `organizer`, `registration_link`, `deadline`, `eligibility`, `rewards`, `source_video`, `source_channel`, `status`, `created_at`
3. **Content**: Generated marketing content.
   * Required headers: `opportunity_id`, `caption`, `hashtags`, `image_prompt`, `image_url`, `content_status`

---

## ⚙ Configuration Reference

| Environment Variable | Description | Default / Format |
|---|---|---|
| `NODE_ENV` | Run Environment | `development` / `production` |
| `GEMINI_API_KEY` | Google Gemini API Authorization Key | **Required** |
| `GROQ_API_KEY` | Groq API Authorization Key | **Required** |
| `GOOGLE_SHEETS_ID` | Spreadsheet ID from the Sheets URL | **Required** |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL`| Service Account client email address | **Required** |
| `GOOGLE_PRIVATE_KEY` | Service Account secret private key | `"-----BEGIN PRIVATE KEY-----\n..."` |
| `DISCORD_BOT_TOKEN` | Bot client token | **Required** |
| `DISCORD_CHANNEL_ID` | Bot listener channel | **Required** |
| `DISCORD_WEBHOOK_URL` | Channel webhook link | **Required** |
| `IMAGE_OUTPUT_DIR` | Local storage location for generated assets | `./images` |
| `LOG_LEVEL` | Minimum log logging level | `info` |
| `DRY_RUN` | Run without writing outputs to Sheets | `false` |

---

## 🚀 Deployment (Oracle Cloud / VM)

### 1. SSH into the Remote Instance
```bash
ssh -i /path/to/ssh-key.key opc@YOUR_VM_IP
```

### 2. Copy Setup Files
You can upload the configuration utilities in the `/deploy` folder to automate package installation:
```bash
scp -i /path/to/ssh-key.key deploy/setup.sh opc@YOUR_VM_IP:/tmp/
```

### 3. Run VM Setup
On the remote VM, run the installer:
```bash
chmod +x /tmp/setup.sh
/tmp/setup.sh
```
This installs Node.js, PM2, and fetches Puppeteer dependencies.

### 4. Create local environment
Navigate to `/opt/content-engine`, create a `.env` file, and paste your active production environment variables.

---

## 🔧 Process Management (PM2)

Use [ecosystem.config.cjs](file:///c:/Users/sutha/Desktop/Content/ecosystem.config.cjs) to manage execution.

```bash
# Start both server and pipeline
pm2 start ecosystem.config.cjs

# Show real-time system logs
pm2 logs

# Display active tasks and daemon statuses
pm2 list

# Monitor resource usage
pm2 monit

# Save current PM2 processes to restore on system reboot
pm2 save
pm2 startup
```

---

## 📁 Project Structure

```
Content/
├── .github/workflows/
│   └── scraper.yml            # GitHub actions workflow cron
├── deploy/                    # Setup & server proxy configuration scripts
├── src/
│   ├── config/                # Environment schema loading
│   ├── pipeline/              # Main orchestration runs
│   ├── scripts/               # Sheet macros and manual scrapers
│   ├── services/              # Integrations (Sheets, Discord, Scrapers, Gemini)
│   ├── types/                 # Typings and Interfaces
│   └── utils/                 # Logger and safety wrappers
├── ecosystem.config.cjs       # PM2 settings
├── package.json
└── tsconfig.json
```

---

## 🐛 Troubleshooting

* **Missing Required Env Variables**: Ensure you copied `.env.example` to `.env` and populated every variable correctly.
* **OpenSSL JWT Decode Errors**: Verify your `GOOGLE_PRIVATE_KEY` has quotes around it and literal `\n` characters are properly formatted. The loader contains helper code to parse multiline strings automatically.
* **Puppeteer Missing Browser on Linux**: Run `npx puppeteer browsers install` on your server to fetch the Chromium binary.
* **Rate Limits**: If encountering Gemini API errors, configure `GEMINI_RATE_LIMIT_MS` to a higher cooldown (e.g. `2000`).

---

## 🔒 Repository Public Release Safety

Yes! This repository **is safe to make public**.
Before doing so, ensure:
- Your active `.env` file remains untracked (verified in `.gitignore`).
- All active Google Cloud JSON credential files (e.g., `gen-lang-client-*.json`) are not in the repository.
- General documentation (like this README) uses placeholder variables (e.g., `YOUR_GOOGLE_SHEETS_ID` instead of actual production spreadsheet IDs). This has already been cleaned up in this updated README.

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).

