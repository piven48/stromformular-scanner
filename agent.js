/**
 * agent.js – Haupteinstiegspunkt des Automation Agents
 *
 * Verwendung:
 *   node agent.js                  → Vollständiger Ablauf: Scan + Analyse
 *   node agent.js --scan-only      → Nur Browser-Scan (kein Claude-Aufruf)
 *   node agent.js --analyze-only   → Nur Analyse (verwendet scan_result.json)
 *
 * Voraussetzungen:
 *   ANTHROPIC_API_KEY=... node agent.js
 */

const fs = require('fs');
const path = require('path');

const SCAN_RESULT_PATH = path.join(__dirname, 'scan_result.json');

function findExcel() {
  const files = fs.readdirSync(__dirname).filter(f => f.endsWith('.xlsx') && !f.startsWith('Vergleich_'));
  if (files.length === 0) throw new Error('Keine Excel-Datei (.xlsx) im Ordner gefunden.');
  if (files.length > 1) {
    console.warn(`  Mehrere Excel-Dateien gefunden – verwende: ${files[0]}`);
  }
  return path.join(__dirname, files[0]);
}

(async () => {
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║       STROMFORMULAR AUTOMATION AGENT                      ║');
  console.log('╚═══════════════════════════════════════════════════════════╝\n');

  const args = process.argv.slice(2);
  const scanOnly    = args.includes('--scan-only');
  const analyzeOnly = args.includes('--analyze-only');

  let scanResult;

  // ── Phase 1: Browser-Scan ──────────────────────────────────────────────────
  if (!analyzeOnly) {
    const { runBrowserScan } = require('./browser-scan');
    scanResult = await runBrowserScan();
  } else {
    if (!fs.existsSync(SCAN_RESULT_PATH)) {
      console.error('scan_result.json nicht gefunden. Erst einen Scan durchführen.');
      process.exit(1);
    }
    console.log(`Lade gecachtes Scan-Ergebnis: ${SCAN_RESULT_PATH}`);
    scanResult = JSON.parse(fs.readFileSync(SCAN_RESULT_PATH, 'utf8'));
    console.log(`  ${scanResult.totalFields} Felder geladen (${scanResult.extractionDate})\n`);
  }

  if (scanOnly) {
    console.log('--scan-only: Analyse übersprungen.');
    process.exit(0);
  }

  // ── Phase 2: Analyse ───────────────────────────────────────────────────────
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('\nFehler: ANTHROPIC_API_KEY ist nicht gesetzt.');
    console.error('Starte mit:  ANTHROPIC_API_KEY=sk-... node agent.js\n');
    process.exit(1);
  }

  const { runAnalysis } = require('./analyze');
  const excelPath = findExcel();
  console.log(`Excel-Datei: ${path.basename(excelPath)}\n`);

  const outputPath = await runAnalysis(scanResult, excelPath);

  console.log('\n╔═══════════════════════════════════════════════════════════╗');
  console.log('║  FERTIG                                                   ║');
  console.log(`║  Vergleich: ${path.basename(outputPath).padEnd(47)}║`);
  console.log('╚═══════════════════════════════════════════════════════════╝');
})().catch(err => {
  console.error('\nFehler:', err.message);
  process.exit(1);
});
