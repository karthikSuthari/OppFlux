import fs from 'fs';
import path from 'path';
import type { Opportunity, Content } from '../types/index.js';
import { createServiceLogger } from '../utils/logger.js';

const log = createServiceLogger('pending-store');

const DATA_DIR = path.resolve(process.cwd(), 'data');
const PENDING_FILE = path.join(DATA_DIR, 'pending_opportunities.json');

interface PendingStore {
  [messageId: string]: {
    opportunity: Opportunity;
    content: Content;
  };
}

export function initStore(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(PENDING_FILE)) {
    fs.writeFileSync(PENDING_FILE, JSON.stringify({}), 'utf-8');
  }
}

function readStore(): PendingStore {
  initStore();
  try {
    const data = fs.readFileSync(PENDING_FILE, 'utf-8');
    return JSON.parse(data) as PendingStore;
  } catch (error) {
    log.error('Error reading pending store', { error: String(error) });
    return {};
  }
}

function writeStore(store: PendingStore): void {
  initStore();
  try {
    fs.writeFileSync(PENDING_FILE, JSON.stringify(store, null, 2), 'utf-8');
  } catch (error) {
    log.error('Error writing pending store', { error: String(error) });
  }
}

export function savePendingOpportunity(messageId: string, opportunity: Opportunity, content: Content): void {
  const store = readStore();
  store[messageId] = { opportunity, content };
  writeStore(store);
}

export function getPendingOpportunity(messageId: string): { opportunity: Opportunity; content: Content } | null {
  const store = readStore();
  return store[messageId] || null;
}

export function deletePendingOpportunity(messageId: string): void {
  const store = readStore();
  if (store[messageId]) {
    delete store[messageId];
    writeStore(store);
  }
}
