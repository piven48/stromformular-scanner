/**
 * compare.js – Vergleichslogik v2 + Claude Haiku Enhancement
 * Änderungen gegenüber v1:
 *  - Semikolon-IDs werden im ID-Vergleich in einzelne Zeilen aufgeteilt
 *  - Vorblatt_reg_art2 → Vorblatt_reg_art2-selectized als Umbenennung
 *  - MessageEmbedding_* und hidden Base-Selects (wenn -selectized vorhanden) gefiltert
 *  - Label-Normalisierung verbessert (datum4/datum7/bet5 → Gekürzt)
 *  - Optionales Claude Haiku Enhancement für "Nur im Scan"-Felder
 */

const XLSX    = require('xlsx');
const ExcelJS = require('exceljs');
const path    = require('path');

// ── Bekannte Umbenennungen: Excel-ID → Scan-ID ─────────────────────────────
const RENAMES = {
  'Vorblatt_plz_de':                  'Vorblatt_plz',
  'Vorblatt_plz_de2':                 'Vorblatt_plz2',
  'Vorblatt_plz_de_hauptbuchhaltung': 'Vorblatt_plz_hauptbuchhaltung',
  'iban_land':                        'iban_land-selectized',
  'Vorblatt_reg_art2':                'Vorblatt_reg_art2-selectized',
};
const RENAME_TARGETS = new Set(Object.values(RENAMES));

// ── UI-Felder ausschließen ─────────────────────────────────────────────────
function isUIField(id, scanIds) {
  // Technische Embedding-Felder
  if (/^MessageEmbedding_/.test(id)) return true;
  // Hidden Base-Select: wenn die -selectized Version im Scan existiert
  if (!id.endsWith('-selectized') && scanIds && scanIds.has(id + '-selectized')) return true;
  // Standard UI-Pattern (außer Rename-Ziele)
  if (RENAME_TARGETS.has(id)) return false;
  return /wechsel|aria-selectize(?!.*iban)|dropdown/i.test(id);
}

// ── Ja/Nein-Partner-Erweiterung ────────────────────────────────────────────
function expandPartners(id) {
  const all = new Set([id]);
  for (const [ja, nein] of [['_ja','_nein'],['_ja2','_nein2'],['_ja3','_nein3'],['_j','_n']]) {
    if (id.endsWith(ja))   all.add(id.slice(0, -ja.length)   + nein);
    if (id.endsWith(nein)) all.add(id.slice(0, -nein.length) + ja);
  }
  if (id === 'Vorblatt_k_antrag1') all.add('Vorblatt_k_antrag2');
  return all;
}

// ── Excel einlesen ─────────────────────────────────────────────────────────
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

// ── Label-Normalisierung ───────────────────────────────────────────────────
function normalize(s) {
  return s
    .replace(/\*/g, '')
    .replace(/\r?\n/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^\d+(\.\d+)*\s+/, '')                               // Abschnittsnummern (9.1.1 etc.)
    .replace(/Elektrischer Strom\s*§\s*1\s*StromStG/gi, '')      // "Elektrischer Strom § 1 StromStG"
    .replace(/Elektronischer Strom\s*§\s*1\s*StromStG/gi, '')
    .replace(/\s*-\s*[^()\n]*Stromerzeugungsanlagen[^()\n]*/gi, '') // Anlagenart-Details
    .replace(/[–-]\s*bis zu \d+\s*MW[^()\n]*/gi, '')             // "– bis zu 2 MW ..."
    .replace(/\(Contracting\)/gi, '')                             // "(Contracting)"
    .replace(/\(Menge in MWh\)/gi, '')                           // "(Menge in MWh)"
    .replace(/- (von|durch) Dritte[^(]*/gi, '')
    .replace(/INFO:.*$/s, '')
    .replace(/§\s*9/g, '§ 9')
    .replace(/Absatz/g, 'Abs.')
    .replace(/Nummer/g, 'Nr.')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function wordOverlap(a, b) {
  const wa = new Set(a.split(/\s+/).filter(w => w.length > 3));
  const wb = new Set(b.split(/\s+/).filter(w => w.length > 3));
  if (wa.size === 0) return 0;
  return [...wa].filter(w => wb.has(w)).length / wa.size;
}

// ── Hauptvergleich ─────────────────────────────────────────────────────────
function runComparison(scanResult, excelFields) {
  const scanMap  = new Map(scanResult.fields.map(f => [f.id, f]));
  const scanIds  = new Set(scanResult.fields.map(f => f.id));
  const covered  = new Set(); // Scan-IDs die durch Excel abgedeckt sind

  // ── ID-Vergleich ───────────────────────────────────────────────────────
  // Semikolon-IDs in einzelne Zeilen aufteilen
  const expandedForId = [];
  for (const ef of excelFields) {
    const parts = ef.id.split(';').map(s => s.trim()).filter(Boolean);
    for (const part of parts) {
      expandedForId.push({ id: part, label: ef.label, semikolonGruppe: ef.id });
    }
  }

  const idVergleich = [];
  let nr = 0;

  for (const ef of expandedForId) {
    nr++;
    const partners = expandPartners(ef.id);
    for (const p of partners) covered.add(p);

    const renamedTarget = RENAMES[ef.id];
    if (renamedTarget) covered.add(renamedTarget);

    // foundDirect: nur wenn Feld sichtbar ist ODER kein Rename existiert
    const directScanField = scanMap.get(ef.id);
    const foundDirect  = !!directScanField && (directScanField.visible !== false || !renamedTarget);
    const foundRenamed = renamedTarget && scanIds.has(renamedTarget);
    const partnerMatch = !foundDirect && !foundRenamed && [...partners].some(p => p !== ef.id && scanIds.has(p));

    if (foundDirect || partnerMatch) {
      idVergleich.push({ nr, idExcel: ef.id, idScan: foundDirect ? ef.id : [...partners].find(p => scanIds.has(p)), status: 'exakt', anmerkung: partnerMatch ? 'Ja/Nein-Partner' : '' });
    } else if (foundRenamed) {
      idVergleich.push({ nr, idExcel: ef.id, idScan: renamedTarget, status: 'ungefaehr', anmerkung: 'Umbenannt: ' + ef.id + ' → ' + renamedTarget });
    } else {
      idVergleich.push({ nr, idExcel: ef.id, idScan: '-', status: 'nurExcel', anmerkung: 'Nicht im Scan gefunden' });
    }
  }

  // Nur-im-Scan: Felder die nicht in Excel abgedeckt sind
  const nurImScan = scanResult.fields.filter(f => !isUIField(f.id, scanIds) && !covered.has(f.id));
  for (const f of nurImScan) {
    nr++;
    let seite = 'Vorblatt';
    if (f.id.startsWith('ke_') || f.id === 'menge22' || f.id === 'menge23') seite = 'Seite 2';
    else if (!f.id.startsWith('Vorblatt') && !['ansprechpartner','telefon','telefax','email','internet','mastrnr'].includes(f.id)) seite = 'Seite 1';

    const neighbors = scanResult.fields
      .filter(n => n.id !== f.id && Math.abs(n.position_y - f.position_y) < 60 && covered.has(n.id))
      .map(n => n.id).slice(0, 2);
    const pos = seite + ' | y=' + f.position_y + (neighbors.length ? ' | Nachbar: ' + neighbors.join(', ') : '');
    idVergleich.push({ nr, idExcel: '—', idScan: f.id, status: 'nurScan', anmerkung: pos });
  }

  // ── Label-Vergleich ────────────────────────────────────────────────────
  // Semikolon-IDs bleiben zusammen (da gleiche Label)
  const labelVergleich = [];
  nr = 0;

  for (const ef of excelFields) {
    nr++;
    const primaryIds = ef.id.split(';').map(s => s.trim());

    // Scan-Feld suchen — bei Umbenennungen immer das Rename-Ziel bevorzugen
    let scanField = null;
    let usedRename = false;
    for (const pid of primaryIds) {
      if (RENAMES[pid] && scanMap.has(RENAMES[pid])) {
        scanField = scanMap.get(RENAMES[pid]); usedRename = true; break;
      }
      const direct = scanMap.get(pid);
      if (direct && direct.visible !== false) { scanField = direct; break; }
      if (direct) { scanField = direct; } // hidden fallback
    }
    if (!scanField && primaryIds.some(p => scanMap.has(p))) {
      scanField = scanMap.get(primaryIds.find(p => scanMap.has(p)));
    }

    if (!scanField) {
      const renamedNote = primaryIds.map(p => RENAMES[p]).filter(Boolean);
      labelVergleich.push({
        nr, feldId: ef.id,
        bezeichnungExcel: ef.label,
        bezeichnungScan: '—',
        status: 'abweichend',
        anmerkung: renamedNote.length ? 'ID umbenannt: ' + primaryIds[0] + ' → ' + renamedNote[0] : 'Kein Scan-Feld',
      });
      continue;
    }

    // Rename-Ziel mit leerem Label → Abweichend (ID wurde umbenannt, neues Feld hat anderen Label)
    if (usedRename && !scanField.label) {
      const renameId = primaryIds.find(p => RENAMES[p]);
      labelVergleich.push({
        nr, feldId: ef.id,
        bezeichnungExcel: ef.label,
        bezeichnungScan: '—',
        status: 'abweichend',
        anmerkung: 'ID umbenannt: ' + renameId + ' → ' + RENAMES[renameId],
      });
      continue;
    }

    const excelNorm = normalize(ef.label);
    const scanNorm  = normalize(scanField.label || '');

    let status = 'abweichend';
    let anmerkung = '';

    if (!scanField.label || scanNorm === excelNorm) {
      status = 'identisch';
    } else if (scanNorm.includes(excelNorm) || excelNorm.includes(scanNorm)) {
      status = 'identisch';
      anmerkung = 'Teilmenge';
    } else {
      const ratio = wordOverlap(excelNorm, scanNorm);
      const ratioReverse = wordOverlap(scanNorm, excelNorm);
      const maxRatio = Math.max(ratio, ratioReverse);
      if (maxRatio >= 0.35) {
        status = 'gekuerzt';
        anmerkung = 'Scan kürzer formuliert';
      } else {
        status = 'abweichend';
        anmerkung = 'Inhaltlich abweichend';
      }
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

// ── Excel-Ausgabe ──────────────────────────────────────────────────────────
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
  for (const [s, l, d] of [
    ['identisch',  'Identisch',  'Bezeichnung gleich'],
    ['gekuerzt',   'Gekürzt',    'Scan kürzer formuliert, gleicher Inhalt'],
    ['abweichend', 'Abweichend', 'Inhaltlich anders'],
    ['nurScan',    'Nur im Scan','Neues Feld, nicht in Excel'],
  ]) {
    const r = wsL.addRow([l, '', d]);
    const col = STATUS_COLOR[s];
    if (col) r.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + col } };
  }

  await wb.xlsx.writeFile(outputPath);
}

module.exports = { parseExcel, runComparison, generateExcel };
