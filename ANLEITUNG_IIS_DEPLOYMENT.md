# Formular-Scanner 1400 – IIS Deployment Anleitung

## Übersicht

Diese Anleitung beschreibt die Installation der Webanwendung auf einem Windows-Server mit IIS.  
Die Anwendung läuft als Node.js-Prozess hinter IIS (via **iisnode**).

---

## Voraussetzungen (einmalig vom IT-Administrator)

### 1. Node.js installieren
- Download: **https://nodejs.org** → LTS-Version (`.msi`)
- Installation mit Standardeinstellungen durchführen
- Prüfen: `node --version` in der Eingabeaufforderung → sollte `v22.x.x` zeigen

### 2. iisnode-Modul installieren
iisnode ermöglicht das Ausführen von Node.js-Anwendungen direkt in IIS.

- Download: **https://github.com/azure/iisnode/releases**
  - Datei: `iisnode-full-v0.2.26-x64.msi` (oder aktuellste Version)
- Installation durchführen
- IIS Manager neu starten

**Prüfen:** IIS Manager → Server → Module → „iisnode" muss in der Liste erscheinen

### 3. URL Rewrite Modul installieren
Wird benötigt, damit IIS Anfragen an Node.js weiterleitet.

- Download über **Web Platform Installer** oder:  
  `https://www.iis.net/downloads/microsoft/url-rewrite`
- Installation durchführen, IIS neu starten

### 4. Chromium-Browser installieren (für den Scan)
Der Scanner öffnet intern einen unsichtbaren Browser.

```cmd
cd C:\inetpub\wwwroot\formular-scanner
npx playwright install chromium
```

> Falls Antivirus blockiert: Den Chromium-Ordner als Ausnahme hinzufügen  
> Standard-Pfad: `C:\Users\<AppPool-User>\AppData\Local\ms-playwright\`

---

## Installation der Anwendung

### Schritt 1: Anwendungsordner kopieren

Den kompletten Ordner `stromformular automation` auf den Server kopieren, z.B.:
```
C:\inetpub\wwwroot\formular-scanner\
```

**Inhalt des Ordners (wichtige Dateien):**
```
formular-scanner/
├── server.js                         ← Hauptprogramm
├── compare.js                        ← Vergleichslogik
├── !!!Final_Formular_Scan_v35.js     ← Scan-Skript
├── package.json
├── web.config                        ← IIS-Konfiguration
└── public/
    └── index.html                    ← Weboberfläche
```

### Schritt 2: Abhängigkeiten installieren

Eingabeaufforderung **als Administrator** öffnen:

```cmd
cd C:\inetpub\wwwroot\formular-scanner
npm install
npx playwright install chromium
```

### Schritt 3: IIS-Anwendung einrichten

1. **IIS Manager** öffnen (`inetmgr`)
2. Unter **Sites** → rechte Maustaste → **„Anwendung hinzufügen"**
3. Einstellungen:
   - **Alias:** `formular-scanner` (Adresse wird dann: `http://servername/formular-scanner`)
   - **Anwendungspool:** Einen eigenen Pool anlegen (siehe unten)
   - **Physischer Pfad:** `C:\inetpub\wwwroot\formular-scanner`
4. **OK** klicken

### Schritt 4: Anwendungspool konfigurieren

1. IIS Manager → **Anwendungspools**
2. Neuen Pool erstellen: Name z.B. `FormularScannerPool`
3. Einstellungen des Pools:
   - **.NET CLR-Version:** Kein verwalteter Code
   - **Pipelinemodus:** Integriert
4. **Erweiterte Einstellungen** des Pools:
   - **Identität:** `LocalSystem` oder ein Dienstkonto mit Schreibrechten auf den Ordner
   - **Leerlauftimeout:** `0` (nie beenden, da Scans bis zu 10 Minuten dauern)
   - **Maximale Arbeitsprozesse:** `1`
   - **Reguläres Zeitlimit:** `0`

> **Wichtig:** Der App-Pool-Benutzer braucht Schreibrechte auf `C:\Windows\Temp`  
> (für temporäre Job-Dateien während des Scans)

### Schritt 5: Berechtigungen setzen

Rechte für den Anwendungsordner:
```cmd
icacls "C:\inetpub\wwwroot\formular-scanner" /grant "IIS AppPool\FormularScannerPool":(OI)(CI)F
```

---

## Port-Konfiguration (optional)

Standardmäßig läuft die App unter der IIS-URL (kein eigener Port nötig).  
Wenn die App auf einem eigenen Port laufen soll (z.B. `http://server:3400`):

In IIS Manager → Site → **Bindungen** → Port `3400` hinzufügen.

---

## Testen

1. Browser öffnen
2. `http://SERVERNAME/formular-scanner` aufrufen
3. Die Weboberfläche sollte erscheinen
4. Eine Test-Excel hochladen und Scan starten

---

## Troubleshooting

### „500.1000 – iisnode failed to initialize"
→ iisnode-Modul nicht installiert oder Node.js nicht im PATH  
→ Node.js neu installieren, Server neu starten

### „Die Seite kann nicht angezeigt werden" (403/404)
→ `web.config` fehlt im Anwendungsordner  
→ URL Rewrite Modul nicht installiert

### „Chromium konnte nicht gestartet werden"
→ `npx playwright install chromium` noch nicht ausgeführt  
→ Antivirus blockiert Chromium – Ausnahme hinzufügen  
→ App-Pool-Identität hat keine Rechte auf Playwright-Ordner

### Scan hängt bei „Browser wird gestartet..."
→ Chromium braucht `--no-sandbox` auf Servern (bereits konfiguriert)  
→ Prüfen ob `ms-playwright` Ordner im Profil des App-Pool-Benutzers vorhanden ist

### „iisnode-logs" prüfen
Fehlermeldungen in: `C:\inetpub\wwwroot\formular-scanner\iisnode-logs\`

---

## Sicherheitshinweise

- Die Anwendung läuft **komplett intern** – keine Daten gehen ins Internet  
  (außer der Aufruf von `formulare-bfinv.de` für den Scan)
- Kein API-Key oder externe Authentifizierung erforderlich
- Optional: Passwortschutz aktivieren (Umgebungsvariable `SITE_PASSWORD` setzen)

### Passwortschutz aktivieren (empfohlen für Firmennetz)

In den **Erweiterten Einstellungen** des Anwendungspools oder als System-Umgebungsvariable:

```
Variable: SITE_PASSWORD
Wert:     IhrGewuenschtesPasswort
```

Nach dem Setzen muss der App-Pool neu gestartet werden.

---

## Lokaler Betrieb (weiterhin möglich)

Die `formular-scanner.bat` funktioniert weiterhin für lokalen Betrieb.  
Lokal öffnet sich ein sichtbares Browser-Fenster während des Scans.  
Auf dem IIS-Server läuft der Browser unsichtbar im Hintergrund.
