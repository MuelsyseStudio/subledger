import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {
  PROJECT_ROOT,
  getStorePaths,
  hasLocalDataFile,
  loadAppConfig,
  loadLocalData,
  saveLocalData,
  writePidInfo,
  clearPidInfo
} from './store.mjs';

import liveRatesFn from '../netlify/functions/live-rates.mjs';
import appIconFn from '../netlify/functions/app-icon.mjs';
import parseScreenshotFn from '../netlify/functions/parse-screenshot.mjs';
import parseMonthlyBillFn from '../netlify/functions/parse-monthly-bill.mjs';
import aiReviewFn from '../netlify/functions/ai-review.mjs';

const PUBLIC_DIR = path.join(PROJECT_ROOT, 'public');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp'
};

const FUNCTION_ROUTES = new Map([
  ['/api/rates', liveRatesFn],
  ['/api/app-icon', appIconFn],
  ['/api/parse-screenshot', parseScreenshotFn],
  ['/api/parse-monthly-bill', parseMonthlyBillFn],
  ['/api/ai-review', aiReviewFn]
]);

function readRequestBody(req, maxBytes = 10 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error('Payload too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

async function invokeWebHandler(handler, req, res, fullUrl) {
  try {
    loadAppConfig(); // Refresh env vars such as GEMINI_API_KEY if updated via CLI
    const method = req.method || 'GET';
    const hasBody = method !== 'GET' && method !== 'HEAD';
    const rawBody = hasBody ? await readRequestBody(req) : undefined;

    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
      if (Array.isArray(v)) headers.set(k, v.join(', '));
      else if (typeof v === 'string') headers.set(k, v);
    }

    const webReq = new Request(fullUrl, {
      method,
      headers,
      body: hasBody && rawBody.length > 0 ? rawBody : undefined
    });

    const webRes = await handler(webReq);
    const resHeaders = {};
    webRes.headers.forEach((val, key) => {
      if (key.toLowerCase() === 'netlify-cdn-cache-control') return;
      resHeaders[key] = val;
    });

    const buf = Buffer.from(await webRes.arrayBuffer());
    res.writeHead(webRes.status, resHeaders);
    res.end(buf);
  } catch (err) {
    sendJson(res, 500, { ok: false, error: err?.message || String(err) });
  }
}

export function createSubledgerServer(options = {}) {
  const cfg = loadAppConfig();
  const host = options.host || cfg.host || '127.0.0.1';
  const port = Number(options.port ?? cfg.port) || 4780;

  const server = http.createServer(async (req, res) => {
    const fullUrl = `http://${req.headers.host || `${host}:${port}`}${req.url || '/'}`;
    const parsedUrl = new URL(fullUrl);
    const pathname = parsedUrl.pathname;

    // 1. Health check endpoint
    if (pathname === '/api/health' && req.method === 'GET') {
      const { dataFile } = getStorePaths();
      const freshCfg = loadAppConfig();
      return sendJson(res, 200, {
        ok: true,
        app: 'SubLedger',
        mode: 'local',
        pid: process.pid,
        host,
        port,
        dataFile,
        hasAiKey: Boolean(freshCfg.geminiApiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_GEMINI_BASE_URL)
      });
    }

    // 2. Local persistent store sync endpoint (Web UI <-> ~/.subledger/data.json <-> CLI)
    if (pathname === '/api/local-store') {
      const { dataFile } = getStorePaths();
      if (req.method === 'GET') {
        const exists = hasLocalDataFile();
        const state = loadLocalData();
        return sendJson(res, 200, {
          ok: true,
          exists,
          dataFile,
          state
        });
      }
      if (req.method === 'POST') {
        try {
          const raw = await readRequestBody(req, 5 * 1024 * 1024);
          const body = JSON.parse(raw.toString('utf8') || '{}');
          const next = body.state || body;
          const saved = saveLocalData(next);
          return sendJson(res, 200, {
            ok: true,
            dataFile,
            updatedAt: saved.updatedAt
          });
        } catch (err) {
          return sendJson(res, 400, { ok: false, error: err?.message || 'Invalid JSON' });
        }
      }
      return sendJson(res, 405, { ok: false, error: 'Method not allowed' });
    }

    // 3. Serverless API handlers (/api/rates, /api/app-icon, /api/parse-screenshot, etc.)
    if (FUNCTION_ROUTES.has(pathname)) {
      return invokeWebHandler(FUNCTION_ROUTES.get(pathname), req, res, fullUrl);
    }

    // 4. Static assets from public/
    const relPath = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
    const safeTarget = path.resolve(PUBLIC_DIR, relPath);
    if (!safeTarget.startsWith(PUBLIC_DIR)) {
      res.writeHead(403);
      return res.end('Forbidden');
    }

    let filePath = safeTarget;
    if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
      filePath = path.join(filePath, 'index.html');
    }

    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Not Found');
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache'
    });
    fs.createReadStream(filePath).pipe(res);
  });

  return { server, host, port };
}

export function startServer({ host, port, writePid = true } = {}) {
  const { server, host: finalHost, port: finalPort } = createSubledgerServer({ host, port });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(finalPort, finalHost, () => {
      const actualPort = server.address().port;
      const url = `http://${finalHost}:${actualPort}`;
      if (writePid) {
        writePidInfo({
          pid: process.pid,
          host: finalHost,
          port: actualPort,
          url,
          startedAt: new Date().toISOString()
        });
        const cleanup = () => clearPidInfo();
        process.once('SIGINT', () => { cleanup(); process.exit(0); });
        process.once('SIGTERM', () => { cleanup(); process.exit(0); });
        process.once('exit', cleanup);
      }
      resolve({ server, host: finalHost, port: actualPort, url });
    });
  });
}

// Allow direct invocation: node src/server.mjs --port 3721 --host 127.0.0.1
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(path.join(PROJECT_ROOT, 'src/server.mjs'))) {
  const args = process.argv.slice(2);
  const getOpt = (flag) => {
    const idx = args.indexOf(flag);
    return idx !== -1 ? args[idx + 1] : undefined;
  };
  const port = getOpt('--port');
  const host = getOpt('--host');
  startServer({ port, host, writePid: true }).then(({ url }) => {
    console.log(`[SubLedger] Local server listening on ${url}`);
  }).catch(err => {
    console.error('[SubLedger] Failed to start server:', err.message);
    process.exit(1);
  });
}
