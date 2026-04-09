/**
 * analyze.js
 * Liest Scan-JSON + Excel-Erfassungsbogen, ruft Claude API mit dem Skill auf
 * und generiert eine Excel-Vergleichsdatei.
 */

const Anthropic = require('@anthropic-ai/sdk');
const XLSX = require('xlsx');
const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');

const SKILL_PATH = path.join(__dirname, 'formular-scanner-extracted', 'formular-scanner', 'SKILL.md');

// Farben gemäß Skill-Spezifikation
const COLORS = {
  headerFill:  '4472C4',
  headerFont:  'FFFFFF',
  exakt:       'C6EFCE',  // grün  – Exakt gleich / Identisch
  ungefaehr:   'FCE4D6',  // orange – Ungefähr gleich
  gekuerzt:    'FFFFCC',  // gelb  – Gekürzt
  nurExcel:    'FFC7CE',  // rot   – Nur in Excel / Abweichend
  nurScan:     'BDD7EE',  // blau  – Nur im Scan
};

function parseExcel(excelPath) {
  const wb = XLSX.readFile(excelPath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  // Zeile 3 (Index 2): Labels, Zeile 4 (Index 3): IDs
  const labelRow = raw[2] || [];
  const idRow    = raw[3] || [];

  const fields = [];
  for (let col = 0; col < idRow.length; col++) {
    const id = String(idRow[col] || '').trim();
    const label = String(labelRow[col] || '').trim();
    if (id) fields.push({ id, label, col });
  }
  return fields;
}

async function callClaudeForComparison(skillMd, excelFields, scanResult) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY nicht gesetzt. Bitte in der Umgebung setzen.');
  }

  const client = new Anthropic();

  // Kompaktes Scan-Feld-Array (nur relevante Felder)
  const scanFields = scanResult.fields.map(f => ({
    id: f.id,
    label: f.label,
    foundInContext: f.foundInContext,
    position_y: f.position_y,
    visible: f.visible,
  }));

  const systemPrompt = `Du bist ein Formular-Analyse-Experte für das FMS der Bundesfinanzverwaltung.
Führe den im Skill beschriebenen Vergleich exakt durch.
Antworte NUR mit einem JSON-Objekt (kein Markdown, kein Text davor/danach).`;

  const userPrompt = `# Skill-Anweisungen
${skillMd}

# Excel-Felder (aus Erfassungsbogen)
${JSON.stringify(excelFields, null, 2)}

# Scan-Ergebnis (${scanFields.length} Felder)
Scan-Datum: ${scanResult.extractionDate}
${JSON.stringify(scanFields, null, 2)}

# Aufgabe
Führe Schritt 3 des Workflows durch (Vergleich mit Excel).
Gib das Ergebnis als JSON zurück:
{
  "idVergleich": [
    {
      "nr": <Nummer>,
      "idExcel": "<ID aus Excel, ggf. Semikolon-getrennt>",
      "idScan": "<gefundene Scan-ID oder '-'>",
      "status": "exakt" | "ungefaehr" | "nurExcel" | "nurScan",
      "anmerkung": "<Beschreibung, bei nurScan: Seite | Abschnitt | Position>"
    }
  ],
  "labelVergleich": [
    {
      "nr": <Nummer>,
      "feldId": "<Feld-ID>",
      "bezeichnungExcel": "<Label aus Excel oder '—'>",
      "bezeichnungScan": "<Label aus Scan oder '—'>",
      "status": "identisch" | "gekuerzt" | "abweichend" | "nurScan",
      "anmerkung": "<Beschreibung>"
    }
  ]
}`;

  console.log('Rufe Claude API auf (Analyse läuft)...');

  const response = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 16000,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const text = response.content[0].text.trim();

  // JSON aus Antwort extrahieren (falls doch Markdown-Blöcke)
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Claude hat kein valides JSON zurückgegeben.');

  return JSON.parse(match[0]);
}

function statusColor(status) {
  const map = {
    exakt:      COLORS.exakt,
    ungefaehr:  COLORS.ungefaehr,
    nurExcel:   COLORS.nurExcel,
    nurScan:    COLORS.nurScan,
    identisch:  COLORS.exakt,
    gekuerzt:   COLORS.gekuerzt,
    abweichend: COLORS.nurExcel,
  };
  return map[status] || null;
}

function statusLabel(status) {
  const map = {
    exakt:      'Exakt gleich',
    ungefaehr:  'Ungefähr gleich',
    nurExcel:   'Nur in Excel',
    nurScan:    'Nur im Scan',
    identisch:  'Identisch',
    gekuerzt:   'Gekürzt',
    abweichend: 'Abweichend',
  };
  return map[status] || status;
}

function applyHeader(ws, columns) {
  const headerRow = ws.addRow(columns.map(c => c.header));
  headerRow.eachCell(cell => {
    cell.fill   = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + COLORS.headerFill } };
    cell.font   = { bold: true, color: { argb: 'FF' + COLORS.headerFont } };
    cell.border = { bottom: { style: 'thin' } };
    cell.alignment = { wrapText: true, vertical: 'middle' };
  });
  ws.getRow(1).height = 22;
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  columns.forEach((col, i) => {
    ws.getColumn(i + 1).width = col.width || 20;
  });
}

function applyDataRow(ws, values, status) {
  const row = ws.addRow(values);
  const color = statusColor(status);
  if (color) {
    row.eachCell(cell => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + color } };
    });
  }
  row.eachCell(cell => {
    cell.alignment = { wrapText: true, vertical: 'top' };
  });
  return row;
}

function addSummary(ws, col, counts, statusMap) {
  ws.addRow([]);
  ws.addRow(['— Zusammenfassung —']);
  for (const [key, count] of Object.entries(counts)) {
    const row = ws.addRow([statusMap[key] || key, count]);
    const color = statusColor(key);
    if (color) {
      row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + color } };
    }
  }
}

async function generateExcel(analysis, outputPath) {
  const wb = new ExcelJS.Workbook();

  // ── Sheet 1: ID-Vergleich ──────────────────────────────────────────────────
  const wsId = wb.addWorksheet('ID-Vergleich');
  applyHeader(wsId, [
    { header: 'Nr',          width: 6  },
    { header: 'ID Excel',    width: 35 },
    { header: 'ID Scan',     width: 35 },
    { header: 'Status',      width: 18 },
    { header: 'Anmerkung',   width: 50 },
  ]);

  const idCounts = { exakt: 0, ungefaehr: 0, nurExcel: 0, nurScan: 0 };
  for (const row of analysis.idVergleich) {
    applyDataRow(wsId,
      [row.nr, row.idExcel, row.idScan, statusLabel(row.status), row.anmerkung],
      row.status
    );
    if (idCounts[row.status] !== undefined) idCounts[row.status]++;
  }
  addSummary(wsId, 5, idCounts, {
    exakt:     'Exakt gleich',
    ungefaehr: 'Ungefähr gleich',
    nurExcel:  'Nur in Excel',
    nurScan:   'Nur im Scan',
  });

  // ── Sheet 2: Label-Vergleich ───────────────────────────────────────────────
  const wsLbl = wb.addWorksheet('Label-Vergleich');
  applyHeader(wsLbl, [
    { header: 'Nr',                  width: 6  },
    { header: 'Feld-ID (Excel)',      width: 30 },
    { header: 'Bezeichnung Excel',    width: 55 },
    { header: 'Bezeichnung Scan',     width: 55 },
    { header: 'Status',               width: 18 },
    { header: 'Anmerkung',            width: 45 },
  ]);

  const lblCounts = { identisch: 0, gekuerzt: 0, abweichend: 0, nurScan: 0 };
  for (const row of analysis.labelVergleich) {
    applyDataRow(wsLbl,
      [row.nr, row.feldId, row.bezeichnungExcel, row.bezeichnungScan, statusLabel(row.status), row.anmerkung],
      row.status
    );
    if (lblCounts[row.status] !== undefined) lblCounts[row.status]++;
  }
  addSummary(wsLbl, 6, lblCounts, {
    identisch:  'Identisch',
    gekuerzt:   'Gekürzt',
    abweichend: 'Abweichend',
    nurScan:    'Nur im Scan',
  });

  // Legende
  wsLbl.addRow([]);
  wsLbl.addRow(['— Legende —']);
  const legend = [
    ['identisch',  'Identisch',  'Bezeichnung nach Normalisierung gleich'],
    ['gekuerzt',   'Gekürzt',    'Gleicher Sachverhalt, Scan kürzer formuliert'],
    ['abweichend', 'Abweichend', 'Bezeichnung inhaltlich anders'],
    ['nurScan',    'Nur im Scan','Neues Feld im Scan, kein Gegenstück in Excel'],
  ];
  for (const [status, label, desc] of legend) {
    const row = wsLbl.addRow([label, '', desc]);
    const color = statusColor(status);
    if (color) {
      row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + color } };
    }
  }

  await wb.xlsx.writeFile(outputPath);
  console.log(`✓ Excel-Ausgabe gespeichert: ${outputPath}`);
}

async function runAnalysis(scanResult, excelPath) {
  console.log('Lese Excel-Erfassungsbogen...');
  const excelFields = parseExcel(excelPath);
  console.log(`  ${excelFields.length} Felder in Excel gefunden.`);

  const skillMd = fs.readFileSync(SKILL_PATH, 'utf8');

  const analysis = await callClaudeForComparison(skillMd, excelFields, scanResult);

  console.log('\n Analyse-Ergebnis:');
  console.log('  ID-Vergleich  :', analysis.idVergleich?.length ?? 0, 'Einträge');
  console.log('  Label-Vergleich:', analysis.labelVergleich?.length ?? 0, 'Einträge');

  const now = new Date().toISOString().slice(0, 10);
  const outputPath = path.join(path.dirname(excelPath), `Vergleich_${now}.xlsx`);
  await generateExcel(analysis, outputPath);

  return outputPath;
}

module.exports = { runAnalysis };
