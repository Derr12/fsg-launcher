# Auto-Updates (GitHub Releases)

Dieser Launcher nutzt **electron-updater**. Damit funktionieren Updates in der **installierten** (NSIS) Version sauber.

## 1) GitHub Repo eintragen

Öffne `package.json` und setze unter `build.publish` deinen Repo-Namen:

```json
"publish": [
  {
    "provider": "github",
    "owner": "DEIN_GITHUB_NAME",
    "repo": "DEIN_REPO_NAME"
  }
]
```

> Wichtig: Das Repo muss **öffentlich** sein (bei privaten Repos brauchst du Tokens).

## 2) Version erhöhen

In `package.json` die Version hochsetzen, z.B.:

- `0.0.9` → `0.0.10`

## 3) Bauen

```bash
npm install
npm run dist
```

## 4) GitHub Release erstellen

Erstelle auf GitHub ein **Release** (nicht nur ein Commit!). Lade aus deinem `dist/` Ordner die generierten Dateien als Release-Assets hoch, typischerweise:

- `FSG Launcher Setup X.Y.Z.exe`
- `latest.yml`
- `*.blockmap` (falls erzeugt)

Ohne `latest.yml` findet der Updater **kein** Update.

## 5) Was der Launcher macht

- Beim Start: **automatisch** `checkForUpdates()` (nur wenn `app.isPackaged`)
- In der UI oben erscheint eine Leiste:
  - „Update verfügbar“ → **Download**
  - Download-Fortschritt → Progressbar
  - „Update heruntergeladen“ → **Neu starten** (installiert das Update)

