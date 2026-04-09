# Formular-Scanner 1400 – Windows Setup-Anleitung

## Voraussetzungen (einmalig)

### Schritt 1: Node.js installieren

1. Gehe zu **https://nodejs.org**
2. Klicke auf **„LTS"** (die empfohlene Version)
3. Lade die `.msi`-Datei herunter und starte sie
4. Installation durchklicken (alle Standardeinstellungen lassen)
5. Den PC **neu starten**

**Prüfen ob es geklappt hat:**
- `Windows-Taste` drücken → `cmd` eingeben → Enter
- Im schwarzen Fenster eingeben: `node --version`
- Es sollte etwas wie `v22.0.0` erscheinen ✓

---

### Schritt 2: Programm-Ordner einrichten

1. Den Ordner **„stromformular automation"** auf den PC kopieren  
   (z.B. nach `C:\Benutzer\DEINNAME\Desktop\stromformular automation`)
2. Im Windows-Explorer in diesen Ordner navigieren
3. In der Adressleiste oben klicken → `cmd` eingeben → Enter  
   *(öffnet ein schwarzes Fenster direkt im richtigen Ordner)*

---

### Schritt 3: Abhängigkeiten installieren

Im schwarzen Fenster (cmd) folgende Befehle **nacheinander** eingeben:

```
npm install
```
*(wartet bis „added X packages" erscheint)*

```
npx playwright install chromium
```
*(lädt den Browser herunter, ca. 150 MB – dauert 1-2 Minuten)*

---

## Programm starten (täglich)

1. Doppelklick auf **`formular-scanner.bat`** im Ordner
2. Es öffnet sich ein schwarzes Fenster und kurz danach der Browser
3. Die Seite **`http://localhost:3400`** öffnet sich automatisch

> Falls der Browser nicht automatisch aufgeht:  
> Browser öffnen und **http://localhost:3400** eingeben

---

## Bedienung

### Vergleich durchführen

1. **Excel-Datei hochladen**  
   → Den aktuellen Erfassungsbogen (.xlsx) in das Feld ziehen  
   oder auf das Feld klicken und die Datei auswählen

2. **„Scan starten"** klicken  
   → Ein Browser-Fenster öffnet sich automatisch  
   → Das Formular auf `formulare-bfinv.de` wird geladen  
   → Der Scan läuft **3–5 Minuten** automatisch durch  
   → Fortschritt wird im Browser angezeigt

3. **Ergebnis herunterladen**  
   → Nach dem Scan erscheint der Button **„⬇ Ergebnis herunterladen"**  
   → Die Excel-Datei `Vergleich_DATUM.xlsx` wird gespeichert

### Ergebnis-Excel

Die heruntergeladene Datei enthält zwei Tabellenblätter:

| Blatt | Inhalt |
|---|---|
| **ID-Vergleich** | Welche Felder neu sind, umbenannt wurden oder fehlen |
| **Label-Vergleich** | Ob Feldbezeichnungen sich geändert haben |

**Farben:**
- 🟢 Grün = Identisch / Exakt gleich
- 🟡 Gelb = Gekürzt (gleicher Inhalt, kürzere Formulierung)
- 🟠 Orange = Umbenennung bekannt
- 🔴 Rot = Abweichend / Nur in Excel
- 🔵 Blau = Neu im Formular (nicht in Excel)

---

## Programm beenden

Im schwarzen Fenster: **Strg + C** drücken → Fenster schließen

---

## Häufige Probleme

### „node wird nicht erkannt"
→ Node.js wurde nicht korrekt installiert oder der PC wurde nicht neu gestartet.  
→ Node.js neu installieren und PC neu starten.

### Browser öffnet sich nicht automatisch
→ Manuell **http://localhost:3400** im Browser eingeben.

### „Port bereits belegt" / Seite lädt nicht
→ Das Programm läuft bereits im Hintergrund.  
→ Im Task-Manager nach `node.exe` suchen und beenden, dann neu starten.

### Scan bleibt bei „Warte auf Vorblatt" hängen
→ Die Website hat sich möglicherweise geändert oder ist nicht erreichbar.  
→ Prüfen ob **https://www.formulare-bfinv.de** im Browser erreichbar ist.

### Antivirus blockiert das Programm
→ Den Ordner `stromformular automation` in der Antivirus-Software als Ausnahme hinzufügen.

---

## Technische Hinweise

- Das Programm läuft **komplett lokal** – keine Daten werden ins Internet gesendet
- Es wird **kein API-Key** benötigt
- Der Scanner öffnet einen eigenen Browser (nicht Chrome/Firefox des Benutzers)
- Ergebnisse werden temporär gespeichert und beim nächsten Start nicht mehr verfügbar
