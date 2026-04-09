/**
 * browser-scan.js
 * Öffnet Chrome mit Playwright, navigiert zum Formular und führt scan_v34.js aus.
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const TARGET_URL = 'https://www.formulare-bfinv.de/ffw/action/invoke.do?id=1400';
const SCAN_SCRIPT_PATH = path.join(__dirname, 'scan_v34.js');
const OUTPUT_PATH = path.join(__dirname, 'scan_result.json');

// Selektoren die anzeigen dass das Vorblatt geladen ist
const VORBLATT_SELECTOR = '[id^="Vorblatt_"], #Vorblatt_k_antrag1, [id="Vorblatt_hza"]';

// Typische Datenschutz-Buttons auf deutschen Behördenwebsites
const DATENSCHUTZ_BUTTONS = [
  'button:has-text("Akzeptieren")',
  'button:has-text("Zustimmen")',
  'button:has-text("Verstanden")',
  'button:has-text("Weiter")',
  'button:has-text("Bestätigen")',
  'input[value="Akzeptieren"]',
  'input[value="Zustimmen"]',
  'input[value="Weiter"]',
  'a:has-text("Akzeptieren")',
];

async function tryAcceptPrivacy(page) {
  for (const sel of DATENSCHUTZ_BUTTONS) {
    try {
      const btn = page.locator(sel).first();
      if (await btn.isVisible({ timeout: 1000 })) {
        console.log(`  Datenschutz-Button gefunden: ${sel}`);
        await btn.click();
        await page.waitForTimeout(1500);
        return true;
      }
    } catch { /* weiter versuchen */ }
  }
  return false;
}

async function runBrowserScan() {
  const scanScript = fs.readFileSync(SCAN_SCRIPT_PATH, 'utf8');

  console.log('Starte Chrome...');

  let browser;
  try {
    browser = await chromium.launch({ headless: false, channel: 'chrome' });
  } catch {
    console.log('Chrome nicht gefunden, verwende Chromium...');
    browser = await chromium.launch({ headless: false });
  }

  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(12 * 60 * 1000);

  console.log(`Navigiere zu: ${TARGET_URL}`);
  await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });

  // Datenschutz automatisch akzeptieren
  console.log('Suche nach Datenschutz-Dialog...');
  await tryAcceptPrivacy(page);

  // Warte bis das Vorblatt sichtbar ist (max. 3 Minuten für manuelle Navigation)
  console.log('Warte auf Vorblatt...');
  console.log('  (Falls nötig: Im Browser manuell zum Formular navigieren)\n');
  try {
    await page.waitForSelector(VORBLATT_SELECTOR, { timeout: 3 * 60 * 1000 });
    console.log('✓ Vorblatt erkannt — starte Scan automatisch.\n');
  } catch {
    console.log('  Vorblatt-Erkennung fehlgeschlagen — starte Scan trotzdem...\n');
  }

  console.log('Starte Scan (3–5 Minuten, bitte warten)...\n');

  // Konsolen-Logs des Scripts in Terminal spiegeln
  page.on('console', msg => {
    const text = msg.text();
    if (text.includes('[') || text.includes('FERTIG') || text.includes('Fehler')) {
      process.stdout.write(`  [Browser] ${text}\n`);
    }
  });

  let result;
  try {
    result = await page.evaluate(scanScript);
  } catch (err) {
    console.error('\nFehler beim Ausführen des Scan-Skripts:', err.message);
    await browser.close();
    throw err;
  }

  await browser.close();

  if (!result || !result.fields) {
    throw new Error('Scan-Skript hat kein valides Ergebnis zurückgegeben.');
  }

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(result, null, 2), 'utf8');

  console.log('\n✓ Scan abgeschlossen!');
  console.log(`  Felder gesamt : ${result.totalFields}`);
  console.log(`  Vorblatt      : ${result.pagesScanned.vorblatt}`);
  console.log(`  Seite 1       : ${result.pagesScanned.seite1}`);
  console.log(`  Seite 2       : ${result.pagesScanned.seite2}`);
  console.log(`  Laufzeit      : ${result.runtimeSeconds}s`);
  if (result.errors && result.errors.length > 0) {
    console.log(`  Warnungen     : ${result.errors.length} (siehe scan_result.json)`);
  }
  console.log(`  Gespeichert   : ${OUTPUT_PATH}\n`);

  return result;
}

module.exports = { runBrowserScan, OUTPUT_PATH };
