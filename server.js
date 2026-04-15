/**
 * server.js – Lokaler Web-Server für den Formular-Scanner
 * Start: node server.js  (oder via start.bat / start.command)
 */

const express  = require('express');
const multer   = require('multer');
const path     = require('path');
const fs       = require('fs');
const os       = require('os');
const crypto   = require('crypto');
const { EventEmitter } = require('events');
const { chromium } = require('playwright');
const { parseExcel, runComparison, generateExcel } = require('./compare');

const SCAN_JS   = fs.readFileSync(path.join(__dirname, '!!!Final_Formular_Scan_v35.js'), 'utf8');
const FORM_URL  = 'https://www.formulare-bfinv.de/ffw/action/invoke.do?id=1400';
const PORT      = process.env.PORT || 3400;
const JOBS_DIR  = path.join(os.tmpdir(), 'formular-jobs');
if (!fs.existsSync(JOBS_DIR)) fs.mkdirSync(JOBS_DIR, { recursive: true });

const app    = express();
const upload = multer({ dest: JOBS_DIR });
const jobs   = new Map(); // jobId → EventEmitter + state

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// ── Passwort-Schutz ──────────────────────────────────────────────────────────
const SITE_PASSWORD = process.env.SITE_PASSWORD;

function hashPw(pw) {
  return crypto.createHash('sha256').update(pw + 'formular1400salt').digest('hex');
}

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k) out[k.trim()] = decodeURIComponent(v.join('='));
  }
  return out;
}

function requireAuth(req, res, next) {
  if (!SITE_PASSWORD) return next(); // lokal ohne Passwort
  const cookies = parseCookies(req);
  if (cookies.auth === hashPw(SITE_PASSWORD)) return next();
  if (req.path === '/login' || req.path === '/api/login') return next();
  res.redirect('/login');
}

// Login-Seite
app.get('/login', (req, res) => {
  res.send(`<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8">
<title>Anmelden</title>
<style>
  body{font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#f5f6fa;margin:0}
  .card{background:#fff;border-radius:12px;box-shadow:0 4px 24px rgba(0,0,0,.1);padding:40px;max-width:360px;width:100%}
  h1{font-size:20px;margin-bottom:24px}
  input{width:100%;padding:10px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:15px;box-sizing:border-box}
  button{width:100%;padding:12px;background:#4472C4;color:#fff;border:none;border-radius:8px;font-size:15px;font-weight:600;cursor:pointer;margin-top:12px}
  button:hover{background:#3461b0}
  .err{color:#dc2626;font-size:13px;margin-top:10px;display:none}
</style></head><body>
<div class="card">
  <h1>🔐 Formular-Scanner</h1>
  <input type="password" id="pw" placeholder="Passwort" autofocus>
  <button onclick="login()">Anmelden</button>
  <div class="err" id="err">Falsches Passwort</div>
</div>
<script>
  document.getElementById('pw').addEventListener('keydown', e => { if(e.key==='Enter') login(); });
  async function login(){
    const pw = document.getElementById('pw').value;
    const r = await fetch('/api/login', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({password: pw})});
    if(r.ok){ window.location.href='/'; }
    else { document.getElementById('err').style.display='block'; }
  }
</script></body></html>`);
});

// Login API
app.post('/api/login', (req, res) => {
  if (!SITE_PASSWORD) return res.json({ ok: true });
  const { password } = req.body;
  if (password === SITE_PASSWORD) {
    const hash = hashPw(SITE_PASSWORD);
    res.setHeader('Set-Cookie', `auth=${hash}; HttpOnly; Path=/; Max-Age=${7 * 24 * 3600}; SameSite=Lax`);
    return res.json({ ok: true });
  }
  res.status(401).json({ error: 'Falsches Passwort' });
});

app.use(requireAuth);
app.use(express.static(path.join(__dirname, 'public')));

// ── Job starten ──────────────────────────────────────────────────────────────
app.post('/start', upload.single('excel'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Keine Excel-Datei hochgeladen.' });

  const jobId   = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const emitter = new EventEmitter();
  jobs.set(jobId, { emitter, status: 'running', resultPath: null });

  res.json({ jobId });

  // Async scan starten
  runJob(jobId, req.file.path, emitter).catch(err => {
    emit(emitter, 'error', err.message);
    jobs.get(jobId).status = 'error';
  });
});

// ── Fortschritt (SSE) ────────────────────────────────────────────────────────
app.get('/progress/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).end();

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (type, data) => {
    res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  // Bereits abgeschlossene Jobs direkt melden
  if (job.status === 'done') { send('done', { downloadUrl: `/download/${req.params.jobId}` }); return res.end(); }
  if (job.status === 'error') { send('error', { message: 'Fehler aufgetreten.' }); return res.end(); }

  job.emitter.on('log',      d => send('log',  d));
  job.emitter.on('progress', d => send('progress', d));
  job.emitter.on('done',     d => { send('done', d); res.end(); });
  job.emitter.on('error',    d => { send('error', d); res.end(); });

  req.on('close', () => {
    job.emitter.removeAllListeners();
  });
});

// ── Download ─────────────────────────────────────────────────────────────────
app.get('/download/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job || !job.resultPath) return res.status(404).send('Ergebnis nicht gefunden.');
  const date = new Date().toISOString().slice(0, 10);
  res.download(job.resultPath, `Vergleich_${date}.xlsx`);
});

// ── Scan + Vergleich ─────────────────────────────────────────────────────────
function emit(emitter, type, data) {
  emitter.emit(type, typeof data === 'string' ? { message: data } : data);
}

async function runJob(jobId, excelPath, emitter) {
  const job = jobs.get(jobId);

  // 1. Browser-Scan
  emit(emitter, 'log', 'Browser wird gestartet...');
  emit(emitter, 'progress', { pct: 5, text: 'Browser startet...' });

  // Lokal (HEADLESS=0): sichtbarer Browser / IIS/Server: headless
  const isHeadless = process.env.HEADLESS !== '0';
  const browser = await chromium.launch({
    headless: isHeadless,
    args: isHeadless ? [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--window-size=1920,1080',
    ] : [],
  });

  // Viewport 1920×1080 damit getBoundingClientRect() korrekte Werte liefert
  const context = await browser.newContext({
    permissions: ['clipboard-read', 'clipboard-write'],
    viewport: { width: 1920, height: 1080 },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(0); // kein Timeout

  // Browser-Konsole ins Log spiegeln
  page.on('console', msg => {
    const t = msg.text();
    const match = t.match(/\[(\d+)s\] (.*)/);
    if (match) {
      const [, sec, text] = match;
      const pct = Math.min(5 + Math.round(parseInt(sec) / 3), 75);
      emit(emitter, 'log', text.replace(/%c/g, ''));
      emit(emitter, 'progress', { pct, text: text.replace(/%c/g, '').slice(0, 60) });
    } else if (/FERTIG/.test(t)) {
      emit(emitter, 'log', '✓ Scan abgeschlossen');
      emit(emitter, 'progress', { pct: 80, text: 'Scan abgeschlossen' });
    }
  });

  emit(emitter, 'log', 'Formular wird geöffnet...');
  await page.goto(FORM_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });

  // Datenschutz automatisch wegklicken
  for (const sel of ['button:has-text("Akzeptieren")', 'button:has-text("Zustimmen")', 'button:has-text("Weiter")', 'input[value="Akzeptieren"]', 'input[value="Weiter"]']) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 2000 })) { await el.click(); break; }
    } catch { /* weiter */ }
  }

  emit(emitter, 'log', 'Warte auf Vorblatt...');
  try {
    await page.waitForSelector('[id^="Vorblatt_"]', { timeout: 3 * 60 * 1000 });
    emit(emitter, 'log', 'Vorblatt erkannt – Scan startet.');
  } catch {
    emit(emitter, 'log', 'Starte Scan (Vorblatt-Erkennung übersprungen).');
  }

  emit(emitter, 'progress', { pct: 10, text: 'Scan läuft (~3-5 Minuten)...' });

  // MAX_RUNTIME unbegrenzt — Skript selbst unverändert
  const scanJsPatched = SCAN_JS.replace(
    /var MAX_RUNTIME\s*=\s*10\s*\*\s*60\s*\*\s*1000/,
    'var MAX_RUNTIME = 999 * 60 * 1000'
  );
  const scanResult = await page.evaluate(scanJsPatched);
  await browser.close();

  if (!scanResult?.fields) throw new Error('Scan hat kein Ergebnis zurückgegeben.');

  emit(emitter, 'log', `✓ Scan fertig: ${scanResult.totalFields} Felder (VB:${scanResult.pagesScanned.vorblatt} S1:${scanResult.pagesScanned.seite1} S2:${scanResult.pagesScanned.seite2})`);
  emit(emitter, 'progress', { pct: 82, text: 'Vergleich läuft...' });

  // 2. Excel einlesen
  emit(emitter, 'log', 'Excel wird gelesen...');
  const excelFields = parseExcel(excelPath);
  emit(emitter, 'log', `${excelFields.length} Felder in Excel gefunden.`);

  // 3. Vergleich
  emit(emitter, 'progress', { pct: 88, text: 'Vergleich wird berechnet...' });
  let comparison = runComparison(scanResult, excelFields);

  const idCounts = comparison.idVergleich.reduce((a, r) => { a[r.status] = (a[r.status] || 0) + 1; return a; }, {});
  emit(emitter, 'log', `ID-Vergleich: ${idCounts.exakt||0} exakt | ${idCounts.ungefaehr||0} umbenannt | ${idCounts.nurExcel||0} nur Excel | ${idCounts.nurScan||0} neu im Scan`);

  // 4. Excel generieren
  emit(emitter, 'progress', { pct: 95, text: 'Excel wird erstellt...' });
  const resultPath = path.join(JOBS_DIR, `result_${jobId}.xlsx`);
  await generateExcel(comparison, resultPath);

  job.resultPath = resultPath;
  job.status = 'done';

  emit(emitter, 'log', '✓ Fertig! Excel kann heruntergeladen werden.');
  emit(emitter, 'progress', { pct: 100, text: 'Fertig!' });
  emit(emitter, 'done', { downloadUrl: `/download/${jobId}` });
}

// ── Server starten ───────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n╔═══════════════════════════════════════════╗`);
  console.log(`║  Formular-Scanner läuft                   ║`);
  console.log(`║  → http://localhost:${PORT}                  ║`);
  console.log(`║  Strg+C zum Beenden                       ║`);
  console.log(`╚═══════════════════════════════════════════╝\n`);

  // Browser automatisch öffnen
  const url = `http://localhost:${PORT}`;
  const cmd = process.platform === 'win32' ? `start ${url}`
            : process.platform === 'darwin' ? `open ${url}`
            : `xdg-open ${url}`;
  require('child_process').exec(cmd);
});
