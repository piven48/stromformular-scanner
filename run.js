/**
 * run.js – Einfacher Ablauf:
 * 1. Chrome öffnen → Formular navigieren → Datenschutz akzeptieren
 * 2. scan_v34.js in der Seite ausführen (wie Dev Console)
 * 3. JSON-Ergebnis speichern
 * 4. Claude API aufrufen → Vergleich-Excel generieren
 *
 * Starten: node run.js
 * Nur Analyse: node run.js --analyze-only
 */

const { chromium } = require('playwright');
const Anthropic = require('@anthropic-ai/sdk');
const XLSX = require('xlsx');
const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');

const FORM_URL    = 'https://www.formulare-bfinv.de/ffw/action/invoke.do?id=1400';
const SCAN_JS     = fs.readFileSync(path.join(__dirname, 'scan_v34.js'), 'utf8');
const RESULT_PATH = path.join(__dirname, 'scan_result.json');

// ─── 1. BROWSER-SCAN ────────────────────────────────────────────────────────

async function browserScan() {
  console.log('Browser wird gestartet...');
  const browser = await chromium.launch({ headless: false });

  // Clipboard-Zugriff automatisch erlauben (kein Browser-Dialog)
  const context2 = await browser.newContext({
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  const page = await context2.newPage();
  page.setDefaultTimeout(12 * 60 * 1000);

  // Konsole des Browsers ins Terminal spiegeln
  page.on('console', msg => {
    const t = msg.text();
    if (/\[\d+s\]|FERTIG|Seite|Scan|Fehler/.test(t)) console.log(' >', t);
  });

  console.log('Navigiere zum Formular...');
  await page.goto(FORM_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });

  // Datenschutz automatisch wegklicken falls vorhanden
  for (const sel of ['button:has-text("Akzeptieren")', 'button:has-text("Zustimmen")',
                      'button:has-text("Weiter")', 'input[value="Akzeptieren"]',
                      'input[value="Weiter"]']) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 2000 })) { await el.click(); break; }
    } catch { /* weiter */ }
  }

  // Warte auf Vorblatt-Felder (max 3 Min für manuelle Navigation falls nötig)
  console.log('Warte auf Formular-Vorblatt...');
  try {
    await page.waitForSelector('[id^="Vorblatt_"]', { timeout: 3 * 60 * 1000 });
    console.log('Vorblatt erkannt.\n');
  } catch {
    console.log('Vorblatt nicht automatisch erkannt – starte Scan trotzdem.\n');
  }

  console.log('Führe Scan-Skript aus (3–5 Minuten)...');
  const result = await page.evaluate(SCAN_JS);
  await browser.close();

  if (!result?.fields) throw new Error('Scan hat kein Ergebnis zurückgegeben.');

  fs.writeFileSync(RESULT_PATH, JSON.stringify(result, null, 2));
  console.log(`\nScan fertig: ${result.totalFields} Felder | VB:${result.pagesScanned.vorblatt} S1:${result.pagesScanned.seite1} S2:${result.pagesScanned.seite2}\n`);
  return result;
}

// ─── 2. ANALYSE ─────────────────────────────────────────────────────────────

function parseExcel(excelPath) {
  const wb = XLSX.readFile(excelPath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  const labelRow = raw[2] || [];
  const idRow    = raw[3] || [];
  const fields   = [];
  for (let i = 0; i < idRow.length; i++) {
    const id = String(idRow[i] || '').trim();
    if (id) fields.push({ id, label: String(labelRow[i] || '').trim() });
  }
  return fields;
}

async function analyse(scanResult, excelPath) {
  console.log('Lese Excel...');
  const excelFields = parseExcel(excelPath);
  console.log(`${excelFields.length} Felder in Excel.\n`);

  const client = new Anthropic();
  const scanFields = scanResult.fields.map(f => ({
    id: f.id, label: f.label, foundInContext: f.foundInContext, position_y: f.position_y
  }));

  // Kompaktere Darstellung der Scan-Felder (nur id + label)
  const scanMap = {};
  for (const f of scanFields) scanMap[f.id] = { label: f.label, ctx: f.foundInContext, y: f.position_y };

  const prompt = `# Skill-Anweisungen\n${SKILL_MD}\n\n# Excel-Felder (ID → Label)\n${JSON.stringify(excelFields)}\n\n# Scan-Felder (ID → {label, ctx, y})\n${JSON.stringify(scanMap)}\n\nFühre Schritt 3 durch. Gib NUR dieses JSON zurück:\n{"idVergleich":[{"nr":1,"idExcel":"...","idScan":"...","status":"exakt|ungefaehr|nurExcel|nurScan","anmerkung":"..."}],"labelVergleich":[{"nr":1,"feldId":"...","bezeichnungExcel":"...","bezeichnungScan":"...","status":"identisch|gekuerzt|abweichend|nurScan","anmerkung":"..."}]}`;

  console.log(`Prompt-Größe: ~${Math.round(prompt.length/1000)}KB`);
  console.log('Claude API – Vergleich läuft...');

  let msg;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      msg = await client.messages.create({
        model: 'claude-opus-4-6',
        max_tokens: 16000,
        system: 'Du bist Formular-Analyse-Experte. Antworte NUR mit JSON (kein Markdown).',
        messages: [{ role: 'user', content: prompt }]
      });
      break;
    } catch (e) {
      console.error(`Versuch ${attempt} fehlgeschlagen: ${e.message}`);
      if (attempt === 3) throw e;
      await new Promise(r => setTimeout(r, 5000));
    }
  }

  const json = JSON.parse(msg.content[0].text.match(/\{[\s\S]*\}/)[0]);
  console.log(`Ergebnis: ${json.idVergleich?.length} ID-Einträge, ${json.labelVergleich?.length} Label-Einträge\n`);

  // Excel generieren
  const COLORS = { header:'4472C4', exakt:'C6EFCE', ungefaehr:'FCE4D6', gekuerzt:'FFFFCC', nurExcel:'FFC7CE', nurScan:'BDD7EE' };
  const statusColor = s => ({ exakt:'C6EFCE', ungefaehr:'FCE4D6', nurExcel:'FFC7CE', nurScan:'BDD7EE', identisch:'C6EFCE', gekuerzt:'FFFFCC', abweichend:'FFC7CE' })[s];
  const statusText  = s => ({ exakt:'Exakt gleich', ungefaehr:'Ungefähr gleich', nurExcel:'Nur in Excel', nurScan:'Nur im Scan', identisch:'Identisch', gekuerzt:'Gekürzt', abweichend:'Abweichend' })[s] || s;

  const wb = new ExcelJS.Workbook();

  function addSheet(name, cols, rows, statusKey) {
    const ws = wb.addWorksheet(name);
    const hRow = ws.addRow(cols.map(c => c.h));
    hRow.eachCell(c => {
      c.fill = { type:'pattern', pattern:'solid', fgColor:{ argb:'FF'+COLORS.header } };
      c.font = { bold:true, color:{ argb:'FFFFFFFF' } };
      c.alignment = { wrapText:true, vertical:'middle' };
    });
    ws.getRow(1).height = 22;
    ws.views = [{ state:'frozen', ySplit:1 }];
    ws.autoFilter = { from:{row:1,column:1}, to:{row:1,column:cols.length} };
    cols.forEach((c,i) => { ws.getColumn(i+1).width = c.w || 20; });

    const counts = {};
    for (const r of rows) {
      const row = ws.addRow(cols.map(c => r[c.k]));
      const color = statusColor(r[statusKey]);
      if (color) row.eachCell(c => { c.fill = { type:'pattern', pattern:'solid', fgColor:{ argb:'FF'+color } }; });
      row.eachCell(c => { c.alignment = { wrapText:true, vertical:'top' }; });
      counts[r[statusKey]] = (counts[r[statusKey]] || 0) + 1;
    }

    ws.addRow([]);
    ws.addRow(['— Zusammenfassung —']);
    for (const [s, n] of Object.entries(counts)) {
      const r = ws.addRow([statusText(s), n]);
      const c = statusColor(s);
      if (c) r.getCell(1).fill = { type:'pattern', pattern:'solid', fgColor:{ argb:'FF'+c } };
    }
    return ws;
  }

  addSheet('ID-Vergleich',
    [{h:'Nr',k:'nr',w:5},{h:'ID Excel',k:'idExcel',w:35},{h:'ID Scan',k:'idScan',w:35},{h:'Status',k:'statusText',w:18},{h:'Anmerkung',k:'anmerkung',w:50}],
    json.idVergleich.map(r => ({...r, statusText: statusText(r.status)})),
    'status'
  );

  addSheet('Label-Vergleich',
    [{h:'Nr',k:'nr',w:5},{h:'Feld-ID',k:'feldId',w:30},{h:'Bezeichnung Excel',k:'bezeichnungExcel',w:55},{h:'Bezeichnung Scan',k:'bezeichnungScan',w:55},{h:'Status',k:'statusText',w:18},{h:'Anmerkung',k:'anmerkung',w:45}],
    json.labelVergleich.map(r => ({...r, statusText: statusText(r.status)})),
    'status'
  );

  const out = path.join(path.dirname(excelPath), `Vergleich_${new Date().toISOString().slice(0,10)}.xlsx`);
  await wb.xlsx.writeFile(out);
  console.log(`Excel gespeichert: ${out}`);
  return out;
}

// ─── MAIN ───────────────────────────────────────────────────────────────────

(async () => {
  await browserScan();
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║  Scan-JSON wurde in die Zwischenablage kopiert.           ║');
  console.log('║  → Gehe zu Claude und paste das JSON (Strg+V) im Chat.   ║');
  console.log('╚═══════════════════════════════════════════════════════════╝');
})().catch(e => { console.error(e.message); process.exit(1); });
