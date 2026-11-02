import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { Reader } from './reader.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const port = 4318;
const origin = `http://127.0.0.1:${port}`;
const session = randomBytes(32).toString('hex');
const instance = process.env.AI_READER_INSTANCE_ID || randomBytes(16).toString('hex');
const reader = new Reader({ dataDir: process.env.AI_READER_DATA_DIR || join(root, '.data') });
await reader.load();
const refresh = () =>
  reader.refresh().catch((error) => {
    reader.storageError = `保存に失敗しました: ${error.message}`;
  });
const json = (res, status, data) => {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(data));
};
const allowed = (req) =>
  ['127.0.0.1:4318', 'localhost:4318'].includes(req.headers.host) &&
  (!req.headers.origin || [origin, 'http://localhost:4318'].includes(req.headers.origin)) &&
  req.headers['sec-fetch-site'] !== 'cross-site';
const authorized = (req) => {
  const got = Buffer.from(String(req.headers['x-reader-token'] || ''));
  const want = Buffer.from(session);
  return got.length === want.length && timingSafeEqual(got, want);
};
async function body(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 4096) throw new Error('入力が大きすぎます');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}
const staticFiles = {
  '/': ['index.html', 'text/html'],
  '/app.js': ['app.js', 'text/javascript'],
  '/style.css': ['style.css', 'text/css'],
};
const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  );
  if (!allowed(req)) return json(res, 403, { error: 'ローカル専用です' });
  const path = new URL(req.url, origin).pathname;
  try {
    if (req.method === 'GET') {
      if (path === '/health')
        return json(res, 200, { serviceId: 'ai-reader', version: 1, instance });
      if (path === '/api/session') return json(res, 200, { token: session });
      if (path === '/api/state') return json(res, 200, reader.snapshot());
      if (staticFiles[path]) {
        const [file, type] = staticFiles[path];
        res.writeHead(200, {
          'Content-Type': `${type}; charset=utf-8`,
          'Cache-Control': 'no-cache',
        });
        return res.end(await readFile(join(root, 'public', file)));
      }
      return json(res, 404, { error: '見つかりません' });
    }
    if (req.method !== 'POST') return json(res, 405, { error: '未対応です' });
    if (!authorized(req)) return json(res, 403, { error: '画面を再読み込みしてください' });
    if (!String(req.headers['content-type']).startsWith('application/json'))
      return json(res, 415, { error: 'JSONが必要です' });
    const input = await body(req);
    if (path === '/api/refresh') {
      void refresh();
      return json(res, 202, reader.snapshot());
    }
    if (path === '/api/flag')
      return json(res, 200, await reader.flag(input.id, input.key, input.value));
    if (path === '/api/discovery/save')
      return json(res, 200, await reader.saveDiscovery(input.id, input.value));
    if (path === '/api/x') return json(res, 200, await reader.addX(input.url, input.title || ''));
    if (path === '/api/x/remove') return json(res, 200, await reader.removeX(input.id));
    return json(res, 404, { error: '見つかりません' });
  } catch (error) {
    return json(res, error instanceof SyntaxError ? 400 : 400, { error: error.message });
  }
});
server.listen(port, '127.0.0.1', () => {
  console.log(`AI Reader: ${origin}`);
  void refresh();
});
server.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
process.on('SIGTERM', () => server.close());
process.on('SIGINT', () => server.close());
