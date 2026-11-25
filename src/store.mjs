import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDefaultRatesMap, getSubledgerConfig } from './metrics.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = path.resolve(__dirname, '..');

export function getHomeDir() {
  const dir = process.env.SUBLEDGER_HOME || path.join(os.homedir(), '.subledger');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function getStorePaths() {
  const home = getHomeDir();
  return {
    home,
    dataFile: path.join(home, 'data.json'),
    configFile: path.join(home, 'config.json'),
    pidFile: path.join(home, 'server.json'),
    logFile: path.join(home, 'server.log')
  };
}

export function loadDotEnv() {
  const candidates = [
    path.join(process.cwd(), '.env'),
    path.join(PROJECT_ROOT, '.env')
  ];
  for (const envPath of candidates) {
    if (!fs.existsSync(envPath)) continue;
    try {
      const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx <= 0) continue;
        const key = trimmed.slice(0, eqIdx).trim();
        let val = trimmed.slice(eqIdx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (key && process.env[key] === undefined) {
          process.env[key] = val;
        }
      }
    } catch {
      // Ignore malformed .env
    }
  }
}

export function loadAppConfig() {
  loadDotEnv();
  const { configFile } = getStorePaths();
  const defaults = {
    port: Number(process.env.SUBLEDGER_PORT || process.env.PORT) || 4780,
    host: process.env.SUBLEDGER_HOST || '127.0.0.1',
    geminiApiKey: '',
    geminiBaseUrl: ''
  };

  let saved = {};
  if (fs.existsSync(configFile)) {
    try {
      saved = JSON.parse(fs.readFileSync(configFile, 'utf8')) || {};
    } catch {
      saved = {};
    }
  }

  const merged = { ...defaults, ...saved };
  if (process.env.SUBLEDGER_PORT) merged.port = Number(process.env.SUBLEDGER_PORT) || 4780;
  if (merged.geminiApiKey && !process.env.GEMINI_API_KEY) {
    process.env.GEMINI_API_KEY = merged.geminiApiKey;
  }
  if (merged.geminiBaseUrl && !process.env.GOOGLE_GEMINI_BASE_URL) {
    process.env.GOOGLE_GEMINI_BASE_URL = merged.geminiBaseUrl;
  }
  return merged;
}

export function saveAppConfig(partial) {
  const { configFile } = getStorePaths();
  const current = loadAppConfig();
  const next = { ...current, ...partial };
  const tmp = `${configFile}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8');
  fs.renameSync(tmp, configFile);
  return next;
}

export function hasLocalDataFile() {
  const { dataFile } = getStorePaths();
  return fs.existsSync(dataFile);
}

export function normalizeState(raw = {}) {
  const cfg = getSubledgerConfig();
  const hasSubs = Array.isArray(raw.subscriptions);
  return {
    subscriptions: hasSubs ? raw.subscriptions : cfg.createDemoSubscriptions(),
    monthlyBills: Array.isArray(raw.monthlyBills) ? raw.monthlyBills : [],
    dedupOverrides: raw.dedupOverrides && typeof raw.dedupOverrides === 'object' ? raw.dedupOverrides : {},
    settings: {
      monthlyBudget: raw.settings?.monthlyBudget ?? 3500,
      alertDays: Number(raw.settings?.alertDays) || 14,
      rates: { ...getDefaultRatesMap(), ...(raw.settings?.rates || {}) },
      autoSyncRates: raw.settings?.autoSyncRates !== false,
      ratesLastSynced: raw.settings?.ratesLastSynced || 0,
      ratesUpdatedUtc: raw.settings?.ratesUpdatedUtc || '',
      theme: raw.settings?.theme || 'light'
    },
    isDemo: hasSubs ? Boolean(raw.isDemo) : true,
    demoBannerDismissed: Boolean(raw.demoBannerDismissed),
    aiReviews: raw.aiReviews && typeof raw.aiReviews === 'object' ? raw.aiReviews : {},
    updatedAt: raw.updatedAt || new Date().toISOString()
  };
}

export function loadLocalData() {
  const { dataFile } = getStorePaths();
  if (!fs.existsSync(dataFile)) {
    return normalizeState({});
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    return normalizeState(parsed);
  } catch {
    return normalizeState({});
  }
}

export function saveLocalData(nextState) {
  const { dataFile } = getStorePaths();
  const normalized = normalizeState({
    ...nextState,
    updatedAt: new Date().toISOString()
  });
  const tmp = `${dataFile}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(normalized, null, 2), 'utf8');
  fs.renameSync(tmp, dataFile);
  return normalized;
}

export function readPidInfo() {
  const { pidFile } = getStorePaths();
  if (!fs.existsSync(pidFile)) return null;
  try {
    return JSON.parse(fs.readFileSync(pidFile, 'utf8'));
  } catch {
    return null;
  }
}

export function writePidInfo(info) {
  const { pidFile } = getStorePaths();
  fs.writeFileSync(pidFile, JSON.stringify(info, null, 2), 'utf8');
}

export function clearPidInfo() {
  const { pidFile } = getStorePaths();
  try {
    if (fs.existsSync(pidFile)) fs.unlinkSync(pidFile);
  } catch {
    // Ignore
  }
}
