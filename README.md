# 🎓 Opportunity Content Engine

Automated pipeline that discovers student opportunities from YouTube channels, extracts structured data using Google Gemini AI, generates Instagram-ready content and images, and stores everything in Google Sheets.

## 📋 Table of Contents

- [Architecture](#architecture)
- [Features](#features)
- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [Google Sheets Setup](#google-sheets-setup)
- [Deployment to Oracle Cloud](#deployment-to-oracle-cloud)
- [PM2 Management](#pm2-management)
- [Troubleshooting](#troubleshooting)
- [Production Readiness Checklist](#production-readiness-checklist)

---

## 🏗 Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    PM2 SCHEDULER                         │
│                  (every 30 minutes)                      │
└──────────────────────┬──────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────┐
│                  PIPELINE RUNNER                         │
│                                                          │
│  1. Get active channels from Sheets                      │
│  2. For each channel:                                    │
│     ├─ Fetch YouTube RSS feed                           │
│     └─ For each video:                                  │
│        ├─ Check duplicates (3-layer)                    │
│        ├─ Extract opportunity (Gemini)                  │
│        ├─ Generate caption + hashtags (Gemini)          │
│        ├─ Generate image (Gemini)                       │
│        └─ Save to Sheets                                │
└─────────────────────────────────────────────────────────┘
```

### Data Flow

```
YouTube RSS → Parse → Duplicate Check → Gemini Extract → Gemini Content → Gemini Image → Google Sheets
```

### Tech Stack

| Component | Technology |
|---|---|
| Runtime | Node.js + TypeScript |
| AI | Google Gemini 2.0 Flash |
| Storage | Google Sheets |
| Scheduling | PM2 Cron |
| Hosting | Oracle Cloud VM |
| Logging | Winston |

---

## ✨ Features

- **Automated Discovery**: Monitors YouTube RSS feeds for new opportunity videos
- **AI Extraction**: Uses Gemini to extract structured opportunity data (name, organizer, deadline, eligibility, rewards)
- **Content Generation**: Creates Instagram-ready captions, hashtags, and image prompts
- **Image Generation**: Produces professional Instagram visuals using Gemini image generation
- **Duplicate Detection**: Three-layer protection (video ID, registration link, fuzzy name matching)
- **Structured Logging**: Winston with daily log rotation and JSON format
- **Error Resilience**: Individual video failures don't stop the pipeline
- **Dry Run Mode**: Test without writing to Sheets
- **Auto-initialization**: Missing Sheets tabs are created automatically

---

## 📋 Prerequisites

1. **Node.js** 20+ installed
2. **Gemini API Key** from [Google AI Studio](https://aistudio.google.com/apikey)
3. **Google Cloud Service Account** with Sheets API enabled
4. **Google Sheets** spreadsheet shared with the service account email

---

## 🚀 Quick Start

### 1. Clone and Install

```bash
git clone https://github.com/karthikSuthari/Content.git
cd Content
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
# Edit .env with your actual values
```

Required values in `.env`:

```env
GEMINI_API_KEY=your-gemini-api-key
GOOGLE_SHEETS_ID=1kd8BZda47CSerTKZfiAm1KUxfOqga3DNscTPxTAfvlY
GOOGLE_SERVICE_ACCOUNT_EMAIL=oppurtunity@gen-lang-client-0304817256.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

### 3. Add YouTube Channels

In Google Sheets, go to the **Channels** tab and add rows:

| channel_name | channel_id | active |
|---|---|---|
| Google Cloud | UCVHFbqXqoYvEWM1Ddxl0QDg | TRUE |
| freeCodeCamp | UC8butISFwT-Wl7EV0hUK0BQ | TRUE |

### 4. Run

```bash
# Development (with TypeScript)
npm run dev

# Dry run (no writes to Sheets)
npm run pipeline:dry-run

# Production (build first)
npm run build
npm start
```

---

## ⚙ Configuration

| Variable | Description | Default |
|---|---|---|
| `GEMINI_API_KEY` | Google Gemini API key | **Required** |
| `GOOGLE_SHEETS_ID` | Google Sheets spreadsheet ID | **Required** |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | Service account email | **Required** |
| `GOOGLE_PRIVATE_KEY` | Service account private key | **Required** |
| `IMAGE_OUTPUT_DIR` | Directory for generated images | `./images` |
| `LOG_LEVEL` | Logging level (error/warn/info/debug) | `info` |
| `POLL_INTERVAL_MINUTES` | Feed polling interval | `30` |
| `DRY_RUN` | Run without writing to Sheets | `false` |
| `GEMINI_RATE_LIMIT_MS` | Delay between Gemini API calls | `1500` |

---

## 📊 Google Sheets Setup

### 1. Share the Spreadsheet

Share your Google Sheet with the service account email (Editor access):
```
oppurtunity@gen-lang-client-0304817256.iam.gserviceaccount.com
```

### 2. Sheet Tabs (auto-created if missing)

**Channels** — YouTube channels to monitor

| channel_name | channel_id | active |
|---|---|---|
| Example Channel | UC... | TRUE |

**Opportunities** — Extracted opportunity data

| id | opportunity_name | organizer | registration_link | deadline | eligibility | rewards | source_video | source_channel | status | created_at |

**Content** — Generated Instagram content

| opportunity_id | caption | hashtags | image_prompt | image_url | content_status |

**Posted** — Instagram posting log

| opportunity_id | instagram_post_url | posted_at |

---

## 🚀 Deployment to Oracle Cloud

### 1. Transfer SSH Keys

```bash
# From your local machine
chmod 400 ssh-key-2026-06-15.key
ssh -i ssh-key-2026-06-15.key opc@YOUR_VM_IP
```

### 2. Run Setup Script

```bash
# Transfer the script
scp -i ssh-key-2026-06-15.key deploy/setup.sh opc@YOUR_VM_IP:/tmp/

# SSH into VM and run
ssh -i ssh-key-2026-06-15.key opc@YOUR_VM_IP
chmod +x /tmp/setup.sh
/tmp/setup.sh
```

### 3. Configure Environment

```bash
cd /opt/content-engine
nano .env
# Fill in all required values
```

### 4. Start the Pipeline

```bash
pm2 restart content-engine
pm2 logs content-engine --lines 50
```

---

## 🔧 PM2 Management

```bash
# View status
pm2 list

# View logs (real-time)
pm2 logs content-engine

# View recent logs
pm2 logs content-engine --lines 100

# Restart
pm2 restart content-engine

# Stop
pm2 stop content-engine

# Delete
pm2 delete content-engine

# Monitor (CPU, memory, logs)
pm2 monit

# Save current process list
pm2 save

# Startup script (auto-start on boot)
pm2 startup
```

---

## 🐛 Troubleshooting

### "Missing required environment variables"
→ Copy `.env.example` to `.env` and fill in all required values.

### "Tab not found"
→ The system auto-creates tabs. Ensure the service account has Editor access.

### "Gemini extraction failed"
→ Check your `GEMINI_API_KEY` is valid. Verify at [AI Studio](https://aistudio.google.com/).

### "No active channels found"
→ Add channels to the Channels tab with `active` set to `TRUE`.

### "RSS feed fetch failed"
→ Verify the channel ID is correct. Test the feed URL in your browser.

### "Image generation failed"
→ Image generation requires paid Gemini API tier. The pipeline continues without images.

### Log files
→ Check `logs/app-YYYY-MM-DD.log` and `logs/error-YYYY-MM-DD.log`

---

## ✅ Production Readiness Checklist

- [ ] Gemini API key configured and tested
- [ ] Google Sheets shared with service account
- [ ] Channels tab populated with target YouTube channels
- [ ] `.env` file configured with all required values
- [ ] `npm run build` succeeds without errors
- [ ] Test run with `npm run dev` shows correct behavior
- [ ] PM2 configured and running: `pm2 list` shows `content-engine`
- [ ] PM2 startup configured: `pm2 startup` + `pm2 save`
- [ ] Log rotation working: check `logs/` directory
- [ ] Oracle Cloud VM firewall allows outbound HTTPS (port 443)
- [ ] SSH key permissions set: `chmod 400`
- [ ] Secrets NOT committed to git (check `.gitignore`)
- [ ] Dry run tested: `DRY_RUN=true npm run dev`
- [ ] Duplicate detection tested: run pipeline twice, verify no duplicates

---

## 📁 Project Structure

```
Content/
├── src/
│   ├── index.ts                        # Entry point
│   ├── config/
│   │   └── env.ts                      # Environment configuration
│   ├── services/
│   │   ├── sheets.service.ts           # Google Sheets CRUD
│   │   ├── rss.service.ts              # YouTube RSS parser
│   │   ├── gemini-extract.service.ts   # AI opportunity extraction
│   │   ├── gemini-content.service.ts   # AI content generation
│   │   ├── gemini-image.service.ts     # AI image generation
│   │   └── duplicate.service.ts        # Duplicate detection
│   ├── pipeline/
│   │   └── runner.ts                   # Pipeline orchestration
│   ├── types/
│   │   └── index.ts                    # TypeScript interfaces
│   └── utils/
│       ├── logger.ts                   # Winston structured logging
│       └── retry.ts                    # Retry with backoff
├── images/                             # Generated images
├── logs/                               # Application logs
├── deploy/
│   └── setup.sh                        # Oracle Cloud setup script
├── .env.example                        # Config template
├── .gitignore
├── ecosystem.config.js                 # PM2 configuration
├── package.json
├── tsconfig.json
└── README.md
```

---

## 📄 License

MIT
