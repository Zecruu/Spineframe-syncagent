import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import path from 'path';
import { app } from 'electron';

let logDir: string;

// PHI patterns to sanitize
const PHI_PATTERNS = [
  /\b\d{3}-\d{2}-\d{4}\b/g, // SSN
  /\b\d{9}\b/g, // SSN without dashes
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, // Email
];

function sanitizePHI(message: string): string {
  let sanitized = message;
  PHI_PATTERNS.forEach(pattern => {
    sanitized = sanitized.replace(pattern, '[REDACTED]');
  });
  return sanitized;
}

function maskApiKey(key: string): string {
  if (!key || key.length < 12) return '***';
  return `${key.substring(0, 8)}...${key.substring(key.length - 4)}`;
}

const customFormat = winston.format.printf(({ level, message, timestamp, service }) => {
  const sanitizedMessage = sanitizePHI(message as string);
  return `[${timestamp}] [${level.toUpperCase()}] [${service}] ${sanitizedMessage}`;
});

let logger: winston.Logger;

export function initializeLogger(appDataPath: string, level: string = 'INFO'): winston.Logger {
  logDir = path.join(appDataPath, 'logs');

  const transport = new DailyRotateFile({
    dirname: logDir,
    filename: 'sync-%DATE%.log',
    datePattern: 'YYYY-MM-DD',
    maxSize: '10m',
    maxFiles: '7d',
    level: level.toLowerCase(),
  });

  logger = winston.createLogger({
    level: level.toLowerCase(),
    format: winston.format.combine(
      winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
      customFormat
    ),
    defaultMeta: { service: 'SyncAgent' },
    transports: [
      transport,
      new winston.transports.Console({
        format: winston.format.combine(
          winston.format.colorize(),
          winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
          customFormat
        ),
      }),
    ],
  });

  return logger;
}

export function getLogger(serviceName: string = 'SyncAgent'): winston.Logger {
  if (!logger) {
    // Fallback for early initialization
    const fallbackDir = process.env.APPDATA 
      ? path.join(process.env.APPDATA, 'SpineFrameSyncAgent')
      : './logs';
    initializeLogger(fallbackDir);
  }
  return logger.child({ service: serviceName });
}

export function getLogDir(): string {
  return logDir;
}

export { maskApiKey, sanitizePHI };

