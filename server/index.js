// 90RACK server.
//
// One small process that:
//   - serves the rack UI (Vite middleware in --dev, ./dist otherwise)
//   - proxies /plex/* to your Plex server, adding the token server-side so
//     it never lives in the browser and the browser never hits CORS or
//     mixed-content problems
//   - lists and streams ROMs from ROMS_DIR for the game deck
//   - tells the UI which components have a source wired up (/api/status)
//   - relays the phone remote (/remote) to the rack over server-sent events

import http from 'node:http';
import os from 'node:os';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { SYSTEMS, systemForFile } from './systems.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEV = process.argv.includes('--dev');
const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 9090);
// Forgive hand-edited .env files: stray spaces ("192.168.1.5 : 32400"),
// a missing http://, a trailing slash.
let PLEX_URL = (process.env.PLEX_URL || '').replace(/\s+/g, '').replace(/\/+$/, '');
if (PLEX_URL && !/^https?:\/\//i.test(PLEX_URL)) PLEX_URL = 'http://' + PLEX_URL;
let PLEX_URL_PROBLEM = null;
try {
  if (PLEX_URL) new URL(PLEX_URL);
} catch {
  PLEX_URL_PROBLEM = `PLEX_URL "${process.env.PLEX_URL}" isn't a valid address (expected something like http://192.168.1.50:32400)`;
  PLEX_URL = '';
}
const PLEX_TOKEN = (process.env.PLEX_TOKEN || '').trim();
const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID || '';
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY || '';
const ROMS_DIR = path.resolve(ROOT, process.env.ROMS_DIR || './roms');
const DATA_DIR = path.resolve(ROOT, process.env.DATA_DIR || './data');
const SHELVES_FILE = path.join(DATA_DIR, 'shelves.json');

const PLEX_CLIENT_HEADERS = {
  'X-Plex-Product': '90RACK',
  'X-Plex-Version': '0.1.0',
  'X-Plex-Client-Identifier': '90rack-' + (process.env.HOSTNAME || 'local'),
  'X-Plex-Platform': 'Chrome',
  'X-Plex-Device': 'Hi-Fi Rack',
  'X-Plex-Device-Name': '90RACK',
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
};

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

// ── Plex proxy ─────────────────────────────────────────────────────────

async function proxyPlex(req, res, url) {
  if (!PLEX_URL || !PLEX_TOKEN) return sendJson(res, 503, { error: 'Plex is not configured' });

  const target = new URL(PLEX_URL + url.pathname.slice('/plex'.length) + url.search);
  target.searchParams.set('X-Plex-Token', PLEX_TOKEN);

  // Ask for an uncompressed reply: fetch() would decompress it anyway, and
  // the compressed Content-Length would then truncate what we pass on.
  const headers = { ...PLEX_CLIENT_HEADERS, Accept: req.headers.accept || 'application/json', 'Accept-Encoding': 'identity' };
  if (req.headers.range) headers.Range = req.headers.range;
  if (req.headers['x-plex-session-identifier']) {
    headers['X-Plex-Session-Identifier'] = req.headers['x-plex-session-identifier'];
  }

  const ac = new AbortController();
  res.on('close', () => ac.abort());
  try {
    const upstream = await fetch(target, { method: req.method, headers, signal: ac.signal });
    const out = {};
    const encoded = upstream.headers.has('content-encoding'); // body arrives already decoded
    for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'cache-control', 'last-modified', 'etag']) {
      if (h === 'content-length' && encoded) continue;
      const v = upstream.headers.get(h);
      if (v) out[h] = v;
    }
    res.writeHead(upstream.status, out);
    if (!upstream.body || req.method === 'HEAD') return res.end();
    Readable.fromWeb(upstream.body).on('error', () => res.destroy()).pipe(res);
  } catch (err) {
    if (ac.signal.aborted) return;
    sendJson(res, 502, { error: `Could not reach Plex at ${PLEX_URL}: ${err.message}` });
  }
}

// ── ROMs ───────────────────────────────────────────────────────────────

async function walk(dir, base = dir, out = []) {
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) await walk(full, base, out);
    else out.push(path.relative(base, full));
  }
  return out;
}

async function listRoms() {
  const files = await walk(ROMS_DIR);
  const roms = [];
  for (const rel of files) {
    const system = systemForFile(rel);
    if (!system) continue;
    const name = path.basename(rel).replace(/\.[^.]+$/, '');
    roms.push({
      id: rel,
      name: name.replace(/\s*[([].*?[)\]]/g, '').trim() || name,
      system: system.id,
      url: '/roms/' + rel.split(path.sep).map(encodeURIComponent).join('/'),
    });
  }
  roms.sort((a, b) => a.system.localeCompare(b.system) || a.name.localeCompare(b.name));
  return roms;
}

function serveRom(req, res, url) {
  const rel = decodeURIComponent(url.pathname.slice('/roms/'.length));
  const full = path.resolve(ROMS_DIR, rel);
  if (!full.startsWith(ROMS_DIR + path.sep)) return sendJson(res, 403, { error: 'nope' });
  fs.stat(full, (err, st) => {
    if (err || !st.isFile()) return sendJson(res, 404, { error: 'ROM not found' });
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': st.size });
    fs.createReadStream(full).pipe(res);
  });
}

// ── Phone remote relay ─────────────────────────────────────────────────
// The rack page streams commands from /api/remote/rack and posts its state
// to /api/remote/state; phones stream that state from /api/remote/phone and
// post commands to /api/remote/cmd. Plain SSE + POST, no dependencies.

const racks = new Set();
const phones = new Set();
let rackState = null;

function sse(req, res, set, onOpen) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.write('retry: 2000\n\n');
  set.add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 20_000);
  req.on('close', () => {
    clearInterval(ping);
    set.delete(res);
    if (set === racks) broadcastState();
  });
  onOpen?.();
}

function send(res, data) {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function broadcastState() {
  for (const p of phones) send(p, { racks: racks.size, state: rackState });
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c) => {
      body += c;
      if (body.length > 512_000) req.destroy();
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(body || '{}'));
      } catch (e) {
        reject(e);
      }
    });
  });
}

async function remoteApi(req, res, url) {
  const route = url.pathname.slice('/api/remote/'.length);
  if (route === 'rack' && req.method === 'GET') return sse(req, res, racks, broadcastState);
  if (route === 'phone' && req.method === 'GET') return sse(req, res, phones, () => send(res, { racks: racks.size, state: rackState }));
  if (route === 'state' && req.method === 'POST') {
    rackState = await readJson(req);
    broadcastState();
    return sendJson(res, 200, { ok: true });
  }
  if (route === 'cmd' && req.method === 'POST') {
    const cmd = await readJson(req);
    for (const r of racks) send(r, cmd);
    return sendJson(res, racks.size ? 200 : 503, { racks: racks.size });
  }
  sendJson(res, 404, { error: 'unknown remote route' });
}

// ── Shelves (what's on display) ────────────────────────────────────────

async function shelvesApi(req, res) {
  if (req.method === 'PUT') {
    const body = await readJson(req);
    await fsp.mkdir(DATA_DIR, { recursive: true });
    await fsp.writeFile(SHELVES_FILE, JSON.stringify(body));
    for (const r of racks) send(r, { type: 'shelvesChanged' });
    for (const p of phones) send(p, { shelvesChanged: true });
    return sendJson(res, 200, { ok: true });
  }
  try {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(await fsp.readFile(SHELVES_FILE));
  } catch {
    res.end('{}');
  }
}

/** URLs a phone on the same network can open, for the QR code on the rack. */
function lanUrls() {
  if (HOST !== '0.0.0.0' && HOST !== '::') return [];
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => `http://${i.address}:${PORT}/remote`);
}

// ── Static (prod) ──────────────────────────────────────────────────────

function serveStatic(req, res, url) {
  const dist = path.join(ROOT, 'dist');
  const pathname = url.pathname === '/remote' ? '/remote.html' : url.pathname;
  let file = path.resolve(dist, '.' + decodeURIComponent(pathname));
  if (!file.startsWith(dist)) return sendJson(res, 403, { error: 'nope' });
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) file = path.join(dist, 'index.html'); // SPA fallback (e.g. /callback)
    fs.readFile(file, (err2, buf) => {
      if (err2) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        return res.end('Build missing. Run `npm run build` first, or use `npm run dev`.');
      }
      const ext = path.extname(file);
      const immutable = url.pathname.startsWith('/assets/');
      res.writeHead(200, {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
      });
      res.end(buf);
    });
  });
}

// ── Boot ───────────────────────────────────────────────────────────────

let vite;
if (DEV) {
  const { createServer } = await import('vite');
  vite = await createServer({ root: ROOT, server: { middlewareMode: true }, appType: 'spa' });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname === '/api/status') {
      const roms = await listRoms();
      return sendJson(res, 200, {
        plex: Boolean(PLEX_URL && PLEX_TOKEN),
        spotifyClientId: SPOTIFY_CLIENT_ID || null,
        youtubeApiKey: YOUTUBE_API_KEY || null,
        romCount: roms.length,
        remoteUrls: lanUrls(),
        systems: SYSTEMS,
      });
    }
    if (url.pathname === '/api/roms') return sendJson(res, 200, await listRoms());
    if (url.pathname.startsWith('/api/remote/')) return remoteApi(req, res, url);
    if (url.pathname === '/api/shelves') return shelvesApi(req, res);
    if (url.pathname.startsWith('/plex/')) return proxyPlex(req, res, url);
    if (url.pathname.startsWith('/roms/')) return serveRom(req, res, url);
    if (vite) {
      if (url.pathname === '/remote') req.url = '/remote.html';
      return vite.middlewares(req, res);
    }
    return serveStatic(req, res, url);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) sendJson(res, 500, { error: err.message });
  }
});

/** Say plainly at startup whether Plex answers, so a typo shows up right away. */
async function checkPlex() {
  if (!PLEX_URL || !PLEX_TOKEN) return;
  try {
    const r = await fetch(`${PLEX_URL}/library/sections?X-Plex-Token=${encodeURIComponent(PLEX_TOKEN)}`, {
      headers: { ...PLEX_CLIENT_HEADERS, Accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
    });
    if (r.status === 401) return console.log('    ✗ Plex rejected the token. Double-check PLEX_TOKEN in .env.\n');
    if (!r.ok) return console.log(`    ✗ Plex answered with HTTP ${r.status}.\n`);
    const n = (await r.json()).MediaContainer?.Directory?.length ?? 0;
    console.log(`    ✓ Plex is reachable: ${n} librar${n === 1 ? 'y' : 'ies'} found.\n`);
  } catch (e) {
    console.log(`    ✗ Can't reach Plex at ${PLEX_URL} (${e.cause?.code || e.cause?.message || e.message}). Is the address right and is Plex running?\n`);
  }
}

server.listen(PORT, HOST, () => {
  const shown = HOST === '0.0.0.0' ? '127.0.0.1' : HOST;
  console.log(`\n  ▶ 90RACK powered on  →  http://${shown}:${PORT}\n`);
  const plexLine = PLEX_URL_PROBLEM
    ? '✗ ' + PLEX_URL_PROBLEM
    : PLEX_URL && PLEX_TOKEN
      ? '✓ ' + PLEX_URL
      : PLEX_URL
        ? '– PLEX_TOKEN is missing (demo discs)'
        : '– not configured (demo discs)';
  console.log(`    Plex     ${plexLine}`);
  console.log(`    Spotify  ${SPOTIFY_CLIENT_ID ? '✓ client id set' : '– not configured'}`);
  console.log(`    YouTube  ${YOUTUBE_API_KEY ? '✓ search enabled' : '– paste-a-link mode'}`);
  console.log(`    ROMs     ${ROMS_DIR}`);
  const remotes = lanUrls();
  console.log(`    Remote   ${remotes[0] ?? '– set HOST=0.0.0.0 to use your phone as a remote'}\n`);
  checkPlex();
});
