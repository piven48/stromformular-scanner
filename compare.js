/**
 * compare.js – Vergleichslogik (lokal, kein API-Key nötig)
 * Wird von server.js verwendet.
 */

const XLSX   = require('xlsx');
const ExcelJS = require('exceljs');
const path   = require('path');

const RENAMES = {
  'Vorblatt_plz_de':                  'Vorblatt_plz',
  'Vorblatt_plz_de2':                 'Vorblatt_plz2',
  'Vorblatt_plz_de_hauptbuchhaltung': 'Vorblatt_plz_hauptbuchhaltung',
  'iban_land':                        'iban_land-selectized',
};
const RENAME_TARGETS = new Set(Object.values(RENAMES));

function isUIField(id) {
  if (RENAME_TARGETS.has(id)) return false;
  return /wechsel|aria-selectize(?!.*iban)|dropdown/i.test(id);
}

function expandExcelId(id) {
  const parts = id.split(';').map(s => s.trim()).filter(Boolean);
  const all = new Set(parts);
  for (const p of parts) {
    for (const [ja, nein] of [['_ja','_nein'],['_ja2','_nein2'],['_ja3','_nein3'],['_j','_n']]) {
      if (p.endsWith(ja))   all.add(p.slice(0, -ja.length)   + nein);
      if (p.endsWith(nein)) all.add(p.slice(0, -nein.length) + ja);
    }
    if (p === 'Vorblatt_k_antrag1') all.add('Vorblatt_k_antrag2');
  }
  return all;
}

function normalize(s) {
  return s
    .replace(/\*/g, '').replace(/\r?\n/g, ' ').replace(/\s+/g, ' ')
    .replace(/^\d+(\.\d+)*\s+/, '')
    .replace(/Elektrischer Strom.*?\)/gi, '')
    .replace(/Elektronischer Strom.*?\)/gi, '')
    .replace(/- selbst betriebene Stromerzeugungsanlagen[^(]*/gi, '')
    .replace(/- (von|durch) Dritte[^(]*/gi, '')
    .replace(/INFO:.*$/s, '')
    .replace(/§\s*9/g, '§ 9').replace(/Absatz/g, 'Abs.').replace(/Nummer/g, 'Nr.')
    .replace(/\s+/g, ' ').trim().toLowerCase();
}

function parseExcel(excelPath) {
  const wb  = XLSX.readFile(excelPath);
  const ws  = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  const fields = [];
  const idRow    = raw[3] || [];
  const labelRow = raw[2] || [];
  for (let i = 0; i < idRow.length; i++) {
    const id = String(idRow[i] || '').trim();
    if (id) fields.push({ id, label: String(labelRow[i] || '').trim() });
  }
  return fields;
}

function runComparison(scanResult, excelFields) {
  const scanMap  = new Map(scanResult.fields.map(f => [f.id, f]));
  const scanIds  = new Set(scanResult.fields.map(f => f.id));
  const covered  = new Set();
  const idVergleich = [];
  let nr = 0;

  // ── ID-Vergleich ──────────────────────────────────────────────────────────
  for (const ef of excelFields) {
    nr++;
    const primaryIds = ef.id.split(';').map(s => s.trim());
    const expanded   = expandExcelId(ef.id);
    for (const eid of expanded) covered.add(eid);

    // Rename-Ziel abdecken
    let renamedTarget = null;
    for (const pid of primaryIds) {
      if (RENAMES[pid]) { renamedTarget = RENAMES[pid]; covered.add(renamedTarget); }
    }

    const foundDirect  = primaryIds.some(id => scanIds.has(id));
    const foundRenamed = renamedTarget && scanIds.has(renamedTarget);

    if (foundDirect) {
      idVergleich.push({ nr, idExcel: ef.id, idScan: primaryIds.filter(id => scanIds.has(id)).join(';') || ef.id, status: 'exakt', anmerkung: '' });
    } else if (foundRenamed) {
      idVergleich.push({ nr, idExcel: ef.id, idScan: renamedTarget, status: 'ungefaehr', anmerkung: 'Umbenennung: ' + ef.id + ' → ' + renamedTarget });
    } else {
      const partnerMatch = primaryIds.some(id => {
        const base = id.replace(/_nein(\d*)$/, '_ja$1').replace(/_n(\d+)$/, '_j$1');
        return base !== id && scanIds.has(base);
      });
      if (partnerMatch) {
        idVergleich.push({ nr, idExcel: ef.id, idScan: '(Partner im Scan)', status: 'exakt', anmerkung: 'Ja/Nein-Partner vorhanden' });
      } else {
        idVergleich.push({ nr, idExcel: ef.id, idScan: '-', status: 'nurExcel', anmerkung: 'Nicht im Scan gefunden' });
      }
    }
  }

  // Nur-im-Scan
  const nurImScan = scanResult.fields.filter(f => !isUIField(f.id) && !covered.has(f.id));
  for (const f of nurImScan) {
    nr++;
    let seite = 'Vorblatt';
    if (f.id.startsWith('ke_') || f.id === 'menge22' || f.id === 'menge23') seite = 'Seite 2';
    else if (!f.id.startsWith('Vorblatt') && !['ansprechpartner','telefon','telefax','email','internet','mastrnr'].includes(f.id)) seite = 'Seite 1';
    const neighbors = scanResult.fields
      .filter(n => n.id !== f.id && Math.abs(n.position_y - f.position_y) < 60 && covered.has(n.id))
      .map(n => n.id).slice(0, 2);
    const pos = seite + ' | Kontext: ' + (f.foundInContext || '') + (neighbors.length ? ' | Nachbar: ' + neighbors.join(', ') : '');
    idVergleich.push({ nr, idExcel: '-', idScan: f.id, status: 'nurScan', anmerkung: pos });
  }

  // ── Label-Vergleich ───────────────────────────────────────────────────────
  const labelVergleich = [];
  nr = 0;

  for (const ef of excelFields) {
    nr++;
    const primaryIds = ef.id.split(';').map(s => s.trim());
    let scanField = null;
    for (const pid of primaryIds) {
      if (scanMap.has(pid)) { scanField = scanMap.get(pid); break; }
      if (RENAMES[pid] && scanMap.has(RENAMES[pid])) { scanField = scanMap.get(RENAMES[pid]); break; }
    }

    if (!scanField) {
      labelVergleich.push({ nr, feldId: ef.id, bezeichnungExcel: ef.label, bezeichnungScan: '—', status: 'abweichend', anmerkung: 'Kein Scan-Feld' });
      continue;
    }

    const excelNorm = normalize(ef.label);
    const scanNorm  = normalize(scanField.label || '');
    let status = 'abweichend', anmerkung = '';

    if (!scanField.label || scanNorm === excelNorm || scanNorm.includes(excelNorm) || excelNorm.includes(scanNorm)) {
      status = 'identisch';
      if (scanNorm !== excelNorm) anmerkung = 'Teilmenge';
    } else {
      const ew = new Set(excelNorm.split(/\s+/).filter(w => w.length > 3));
      const sw = new Set(scanNorm.split(/\s+/).filter(w => w.length > 3));
      const ratio = ew.size > 0 ? [...ew].filter(w => sw.has(w)).length / ew.size : 0;
      if (ratio >= 0.4) { status = 'gekuerzt'; anmerkung = 'Scan kürzer formuliert'; }
      else              { status = 'abweichend'; anmerkung = 'Inhaltlich abweichend'; }
    }
    labelVergleich.push({ nr, feldId: ef.id, bezeichnungExcel: ef.label, bezeichnungScan: scanField.label || '', status, anmerkung });
  }

  // Nur-im-Scan auch im Label-Sheet
  for (const r of idVergleich.filter(r => r.status === 'nurScan')) {
    nr++;
    const sf = scanMap.get(r.idScan);
    if (sf) labelVergleich.push({ nr, feldId: r.idScan, bezeichnungExcel: '—', bezeichnungScan: sf.label || '', status: 'nurScan', anmerkung: r.anmerkung });
  }

  return { idVergleich, labelVergleich };
}

const STATUS_COLOR = {
  exakt: 'C6EFCE', ungefaehr: 'FCE4D6', nurExcel: 'FFC7CE', nurScan: 'BDD7EE',
  identisch: 'C6EFCE', gekuerzt: 'FFFFCC', abweichend: 'FFC7CE',
};
const STATUS_TEXT = {
  exakt:'Exakt gleich', ungefaehr:'Ungefähr gleich', nurExcel:'Nur in Excel', nurScan:'Nur im Scan',
  identisch:'Identisch', gekuerzt:'Gekürzt', abweichend:'Abweichend',
};

async function generateExcel(comparison, outputPath) {
  const { idVergleich, labelVergleich } = comparison;
  const wb = new ExcelJS.Workbook();

  function addSheet(name, cols, rows, statusKey) {
    const ws = wb.addWorksheet(name);
    const hRow = ws.addRow(cols.map(c => c.h));
    hRow.eachCell(c => {
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } };
      c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      c.alignment = { wrapText: true, vertical: 'middle' };
    });
    ws.getRow(1).height = 22;
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
    cols.forEach((c, i) => { ws.getColumn(i + 1).width = c.w || 20; });

    const cnt = {};
    for (const r of rows) {
      const row = ws.addRow(cols.map(c => r[c.k]));
      const col = STATUS_COLOR[r[statusKey]];
      if (col) row.eachCell(c => c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + col } });
      row.eachCell(c => c.alignment = { wrapText: true, vertical: 'top' });
      cnt[r[statusKey]] = (cnt[r[statusKey]] || 0) + 1;
    }

    ws.addRow([]);
    ws.addRow(['— Zusammenfassung —']);
    for (const [s, n] of Object.entries(cnt)) {
      const r = ws.addRow([STATUS_TEXT[s] || s, n]);
      const col = STATUS_COLOR[s];
      if (col) r.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + col } };
    }
    return ws;
  }

  addSheet('ID-Vergleich',
    [{ h:'Nr', k:'nr', w:5 }, { h:'ID Excel', k:'idExcel', w:38 }, { h:'ID Scan', k:'idScan', w:38 }, { h:'Status', k:'st', w:20 }, { h:'Anmerkung', k:'anmerkung', w:55 }],
    idVergleich.map(r => ({ ...r, st: STATUS_TEXT[r.status] || r.status })),
    'status');

  const wsL = addSheet('Label-Vergleich',
    [{ h:'Nr', k:'nr', w:5 }, { h:'Feld-ID', k:'feldId', w:32 }, { h:'Bezeichnung Excel', k:'bezeichnungExcel', w:58 }, { h:'Bezeichnung Scan', k:'bezeichnungScan', w:58 }, { h:'Status', k:'st', w:18 }, { h:'Anmerkung', k:'anmerkung', w:45 }],
    labelVergleich.map(r => ({ ...r, st: STATUS_TEXT[r.status] || r.status })),
    'status');

  wsL.addRow([]); wsL.addRow(['— Legende —']);
  for (const [s, l, d] of [['identisch','Identisch','Bezeichnung gleich'],['gekuerzt','Gekürzt','Scan kürzer formuliert'],['abweichend','Abweichend','Inhaltlich anders'],['nurScan','Nur im Scan','Neues Feld, nicht in Excel']]) {
    const r = wsL.addRow([l, '', d]);
    const col = STATUS_COLOR[s];
    if (col) r.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + col } };
  }

  await wb.xlsx.writeFile(outputPath);
}

module.exports = { parseExcel, runComparison, generateExcel };
