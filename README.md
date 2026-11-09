# Tagline

Desktop app for listing shoes on Trade Me fast: SKU lookup, size conversion, price comps,
live listing management (edit, withdraw, bulk price drops), sold and relist views.

## Install

Download the latest installer from [Releases](https://github.com/FootlockerNZ/trademe-lister/releases/latest):

- **Windows:** `Tagline-Setup-x.y.z.exe`. Updates install from Settings → Updates.
- **Mac:** `Tagline-x.y.z-arm64.dmg` (Apple silicon) or `-x64.dmg` (Intel). The app is unsigned, so the
  first time right-click Tagline → Open. Settings → Updates tells you when a new version is out;
  download the new .dmg and replace the app.

Your Trade Me API keys, accounts and tokens are stored on your computer only, never in this repo.

## Develop

```bash
npm install
npm start
```

## Release a new version

1. Bump `version` in `package.json` and commit.
2. Tag and push: `git tag v1.1.0 && git push origin main v1.1.0`.
3. GitHub Actions builds Windows + Mac and attaches them to the release. Installed apps pick it up
   from Settings → Updates.
