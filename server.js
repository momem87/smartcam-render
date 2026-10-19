// SmartCam API + Dashboard  (Render.com version)
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
app.set('trust proxy', true);

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY || '';
const DASH_PASSWORD = process.env.DASH_PASSWORD || '';
const SHUTDOWN_PIN = String(process.env.SHUTDOWN_PIN || '').trim();

// ملاحظة: الـ disk في Render المجاني مؤقت، بيتمسح مع كل Restart/Deploy
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const MINI_PATH = path.join(DATA_DIR, 'mini.jpg');
const CAPTURE_PATH = path.join(DATA_DIR, 'capture.jpg');
const STATUS_PATH = path.join(DATA_DIR, 'smartcam-status.json');
const PI_STATUS_PATH = path.join(DATA_DIR, 'pi-status.json');
const REQUEST_PATH = path.join(DATA_DIR, 'capture-request.json');
const CAPTURE_STATUS_PATH = path.join(DATA_DIR, 'capture-status.json');
const SHUTDOWN_REQUEST_PATH = path.join(DATA_DIR, 'shutdown-request.json');
fs.mkdirSync(DATA_DIR, { recursive: true });

app.use(express.json({ limit: '1mb' }));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

// ---------- helpers ----------
const nowIso = () => new Date().toISOString();
function readJson(p, fallback) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return fallback; } }
function writeJson(p, d) { fs.writeFileSync(p, JSON.stringify(d, null, 2)); }
function ageSeconds(iso) {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return t ? Math.max(0, Math.round((Date.now() - t) / 1000)) : null;
}
function humanBytes(n) {
  if (!n && n !== 0) return '0 B';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KiB';
  return (n / 1024 / 1024).toFixed(1) + ' MiB';
}
function updateMainStatus(patch) { writeJson(STATUS_PATH, Object.assign({}, readJson(STATUS_PATH, {}), patch)); }
function safeEqual(a, b) {
  const A = Buffer.from(String(a)), B = Buffer.from(String(b));
  return A.length === B.length && crypto.timingSafeEqual(A, B);
}

// ---------- auth ----------
// مسارات الـ Pi: محمية بمفتاح x-api-key
const PI_ROUTES = new Set([
  'POST /api/live-upload', 'POST /api/capture-upload', 'POST /api/pi-status',
  'POST /api/capture-phase', 'POST /api/pi-shutdown-ack',
  'GET /api/capture-request', 'GET /api/pi-shutdown-request'
]);
app.use(function (req, res, next) {
  if (req.path === '/healthz' || req.path === '/api/ping') return next();
  if (PI_ROUTES.has(req.method + ' ' + req.path)) {
    if (!API_KEY || safeEqual(req.get('x-api-key') || '', API_KEY)) return next();
    return res.status(401).json({ ok: false, error: 'Bad API key' });
  }
  if (!DASH_PASSWORD) return next();
  const h = req.get('authorization') || '';
  if (h.startsWith('Basic ')) {
    const decoded = Buffer.from(h.slice(6), 'base64').toString('utf8');
    const pass = decoded.slice(decoded.indexOf(':') + 1);
    if (safeEqual(pass, DASH_PASSWORD)) return next();
  }
  res.set('WWW-Authenticate', 'Basic realm="SmartCam"');
  res.status(401).send('Login required');
});

// ---------- health ----------
app.get('/healthz', (req, res) => res.send('ok'));
app.get('/api/ping', (req, res) => res.json({ ok: true, time: nowIso() }));

// ---------- status ----------
app.get('/api/status', function (req, res) {
  const main = readJson(STATUS_PATH, {});
  const pi = readJson(PI_STATUS_PATH, {});
  const capStatus = readJson(CAPTURE_STATUS_PATH, { status: 'done' });
  const mini = main.mini || {};
  const miniAge = ageSeconds(mini.time);
  const piAge = ageSeconds(pi.time);
  const connected = miniAge !== null && miniAge <= 40;
  res.json({
    ok: true,
    state: connected ? 'Connected' : 'Offline',
    current_state: connected ? 'Connected' : 'Offline',
    ip: req.ip,
    local_ip: pi.local_ip || null,
    ssid: pi.ssid || null,
    last_access: mini.time || null,
    last_access_seconds_ago: miniAge,
    transmitted_bytes: main.transmitted_bytes || 0,
    transmitted_human: humanBytes(main.transmitted_bytes || 0),
    temperature_c: pi.temperature_c || null,
    temperature: pi.temperature || 'N/A',
    latency_ms: pi.latency_ms || null,
    latency: pi.latency_ms ? (pi.latency_ms + ' ms') : 'N/A',
    signal_dbm: pi.signal_dbm || null,
    signal: pi.signal_quality || 'N/A',
    mini: mini,
    capture: main.capture || {},
    capture_status: capStatus.status || 'done',
    log: main.log || 'System initialized',
    pi_status_age_seconds: piAge,
    mini_age_seconds: miniAge,
    server_time: nowIso()
  });
});

// ---------- uploads (from Pi) ----------
app.post('/api/live-upload', upload.single('image'), function (req, res) {
  if (!req.file) return res.status(400).json({ ok: false, error: 'No image uploaded' });
  fs.writeFileSync(MINI_PATH, req.file.buffer);
  const info = { time: nowIso(), bytes: req.file.size, size: humanBytes(req.file.size), path: '/captures/mini.jpg' };
  const total = (readJson(STATUS_PATH, {}).transmitted_bytes || 0) + req.file.size;
  updateMainStatus({
    ok: true, state: 'Connected', current_state: 'Connected', last_access: info.time,
    transmitted_bytes: total, transmitted_human: humanBytes(total), mini: info,
    log: 'Live upload OK: ' + info.time + ', Size: ' + info.size
  });
  res.json({ ok: true, saved: true, mini: info });
});

app.post('/api/capture-upload', upload.single('image'), function (req, res) {
  if (!req.file) return res.status(400).json({ ok: false, error: 'No image uploaded' });
  fs.writeFileSync(CAPTURE_PATH, req.file.buffer);
  const info = { time: nowIso(), bytes: req.file.size, size: humanBytes(req.file.size), resolution: '2592x1944', path: '/captures/capture.jpg' };
  const total = (readJson(STATUS_PATH, {}).transmitted_bytes || 0) + req.file.size;
  updateMainStatus({
    capture: info, transmitted_bytes: total, transmitted_human: humanBytes(total),
    log: 'HD capture upload OK: ' + info.time + ', Size: ' + info.size
  });
  writeJson(CAPTURE_STATUS_PATH, { ok: true, status: 'done', message: 'Done.', capture: info, time: info.time });
  try { fs.unlinkSync(REQUEST_PATH); } catch (e) {}
  res.json({ ok: true, status: 'done', saved: '/captures/capture.jpg', bytes: req.file.size, size: info.size, resolution: info.resolution, time: info.time });
});

app.post('/api/pi-status', function (req, res) {
  const b = req.body || {};
  const clean = {
    local_ip: b.local_ip || null, ssid: b.ssid || null,
    temperature_c: b.temperature_c || null, temperature: b.temperature || null,
    latency_ms: b.latency_ms || null, signal_dbm: b.signal_dbm || null,
    signal_quality: b.signal_quality || null, time: nowIso()
  };
  writeJson(PI_STATUS_PATH, clean);
  updateMainStatus({ log: 'Pi status OK: temp=' + (clean.temperature || 'N/A') + ', latency=' + (clean.latency_ms || 'N/A') + ', signal=' + (clean.signal_quality || 'N/A') });
  res.json({ ok: true, saved: true, time: clean.time });
});

// ---------- capture flow ----------
app.post('/api/capture-request', function (req, res) {
  const allowed = ['original', 'screen', 'low_light', 'warm'];
  let preset = (req.body || {}).preset || 'original';
  if (allowed.indexOf(preset) === -1) preset = 'original';
  const request = { ok: true, requested: true, request_id: Date.now().toString(), preset: preset, time: nowIso() };
  writeJson(REQUEST_PATH, request);
  writeJson(CAPTURE_STATUS_PATH, { ok: true, status: 'requested', request_id: request.request_id, preset: preset, message: 'Capture requested: ' + preset, time: request.time });
  updateMainStatus({ log: 'Capture requested: ' + preset + ' at ' + request.time });
  res.json(request);
});
app.get('/api/capture-request', (req, res) => res.json(readJson(REQUEST_PATH, { requested: false })));

app.post('/api/capture-phase', function (req, res) {
  const b = req.body || {};
  const phase = b.phase || 'working';
  const status = { ok: true, status: phase, message: b.message || phase, time: nowIso() };
  writeJson(CAPTURE_STATUS_PATH, status);
  updateMainStatus({ log: 'Capture phase: ' + status.message + ' at ' + status.time });
  res.json(status);
});
app.get('/api/capture-status', (req, res) => res.json(readJson(CAPTURE_STATUS_PATH, { ok: true, status: 'done', message: 'Ready.' })));

// ---------- shutdown (PIN + lockout) ----------
const pinFails = new Map(); // ip -> { n, until }
app.post('/api/pi-shutdown-request', function (req, res) {
  const f = pinFails.get(req.ip) || { n: 0, until: 0 };
  if (Date.now() < f.until) {
    return res.status(429).json({ ok: false, error: 'Too many wrong PINs. Try again in a few minutes.' });
  }
  const pin = String((req.body || {}).pin || '').trim();
  if (!SHUTDOWN_PIN || !safeEqual(pin, SHUTDOWN_PIN)) {
    f.n += 1;
    if (f.n >= 5) { f.until = Date.now() + 5 * 60 * 1000; f.n = 0; }
    pinFails.set(req.ip, f);
    return res.status(403).json({ ok: false, error: 'Wrong shutdown PIN' });
  }
  pinFails.delete(req.ip);
  const request = { ok: true, requested: true, request_id: Date.now().toString(), time: nowIso() };
  writeJson(SHUTDOWN_REQUEST_PATH, request);
  updateMainStatus({ log: 'Shutdown requested at ' + request.time });
  res.json({ ok: true, requested: true, message: 'Shutdown request sent to Raspberry Pi', request_id: request.request_id, time: request.time });
});
app.get('/api/pi-shutdown-request', (req, res) => res.json(readJson(SHUTDOWN_REQUEST_PATH, { requested: false })));
app.post('/api/pi-shutdown-ack', function (req, res) {
  try { fs.unlinkSync(SHUTDOWN_REQUEST_PATH); } catch (e) {}
  updateMainStatus({ log: 'Raspberry Pi accepted shutdown request at ' + nowIso() });
  res.json({ ok: true, acknowledged: true, time: nowIso() });
});

// ---------- images + dashboard ----------
app.get('/captures/:name', function (req, res) {
  const file = path.join(DATA_DIR, path.basename(req.params.name));
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  fs.access(file, fs.constants.R_OK, function (err) {
    if (err) return res.status(404).send('Not found');
    res.sendFile(file);
  });
});
app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, '0.0.0.0', function () {
  console.log('SmartCam listening on port ' + PORT);
  if (!API_KEY) console.warn('WARNING: API_KEY is not set - Pi endpoints are open to everyone');
  if (!DASH_PASSWORD) console.warn('WARNING: DASH_PASSWORD is not set - dashboard is open to everyone');
  if (!SHUTDOWN_PIN) console.warn('WARNING: SHUTDOWN_PIN is not set - shutdown is disabled');
});
