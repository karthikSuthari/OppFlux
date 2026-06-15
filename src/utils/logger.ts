// ===========================================
// Structured Logger (Winston)
// ===========================================

import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const logsDir = path.resolve(__dirname, '../../logs');

// Ensure logs directory exists
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

const logLevel = process.env.LOG_LEVEL || 'info';

/**
 * Custom format for structured JSON logging with timestamp
 */
const structuredFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

/**
 * Console format with colors for development readability
 */
const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.colorize(),
  winston.format.printf(({ timestamp, level, message, service, ...meta }) => {
    const svc = service ? `[${service}]` : '';
    const metaStr = Object.keys(meta).length > 0
      ? ` ${JSON.stringify(meta)}`
      : '';
    return `${timestamp} ${level} ${svc} ${message}${metaStr}`;
  })
);

/**
 * Daily rotating file transport for application logs
 */
const appFileTransport = new DailyRotateFile({
  filename: path.join(logsDir, 'app-%DATE%.log'),
  datePattern: 'YYYY-MM-DD',
  maxSize: '20m',
  maxFiles: '14d',
  format: structuredFormat,
});

/**
 * Daily rotating file transport for error logs
 */
const errorFileTransport = new DailyRotateFile({
  filename: path.join(logsDir, 'error-%DATE%.log'),
  datePattern: 'YYYY-MM-DD',
  maxSize: '20m',
  maxFiles: '30d',
  level: 'error',
  format: structuredFormat,
});

/**
 * Main application logger
 */
export const logger = winston.createLogger({
  level: logLevel,
  defaultMeta: { service: 'content-engine' },
  transports: [
    new winston.transports.Console({
      format: consoleFormat,
    }),
    appFileTransport,
    errorFileTransport,
  ],
});

/**
 * Create a child logger with a specific service name
 */
export function createServiceLogger(serviceName: string): winston.Logger {
  return logger.child({ service: serviceName });
}
