# Tagline

Desktop app for listing shoes on Trade Me fast: SKU lookup, size conversion, price comps,
live listing management (edit, withdraw, bulk price drops, views and watchers), sold and relist views.

Your Trade Me API keys, accounts and tokens are stored on your own computer only, never in this repo.

---

## Install on Windows

1. Go to [Releases](https://github.com/FootlockerNZ/tagline/releases/latest) and download
   `Tagline-Setup-x.y.z.exe`.
2. Run it. Windows may show **"Windows protected your PC"** because the app is not code-signed:
   click **More info → Run anyway**.
3. Tagline installs and opens. It is in the Start menu from then on.

**Updates:** open **Settings → Updates → Check for updates**, then **Download** and **Restart to install**.

## Install on Mac

1. Go to [Releases](https://github.com/FootlockerNZ/tagline/releases/latest) and download the right `.dmg`:
   - `Tagline-x.y.z-arm64.dmg` for Apple silicon (M1, M2, M3, M4)
   - `Tagline-x.y.z-x64.dmg` for Intel Macs

   Not sure which one? Click  → **About This Mac**. "Chip: Apple M…" means arm64.
2. Open the `.dmg` and drag **Tagline** into **Applications**.
3. The app is not signed by Apple, so the first time you open it:
   - In **Applications**, right-click **Tagline → Open**, then click **Open** again.
   - If macOS says the app "is damaged" or still won't open, run this once in Terminal:

     ```bash
     xattr -cr /Applications/Tagline.app
     ```

**Updates:** **Settings → Updates** tells you when a new version is out. Download the new `.dmg` and
drag it into Applications to replace the old app. Your settings are kept.

---

## First-time setup (both platforms)

1. **Trade Me API keys.** On Trade Me, go to **My Trade Me → API applications** and register an app.
   Use the callback URL `https://localhost/trademe-callback`. Copy the consumer key and secret into
   **Settings → Trade Me API** in Tagline. (Sandbox testing needs a separate app on tmsandbox.co.nz.)
2. **Add your Trade Me account(s).** In **Settings → Accounts**, click **Log in with Trade Me**, sign in and click **Allow**.
   You can add more than one and choose a default.
3. **Set up your sections.** Under **Defaults**, each section (Men's sneakers, Women's sneakers,
   Collectables, or your own) has its own category, listing type, shipping, payment and
   **title/description templates**. The templates start empty: fill them in with your own wording
   and placeholders like `{brand}`, `{name}`, `{sku}`, `{size}` and `{condition}`.
4. *(Optional)* **Product lookup token.** Paste a Trace bearer token under **Settings → Product lookup (Trace)** to fill product
   details from a SKU.

That's it: enter a SKU, pick a size and price, and list.

---

## Develop

Needs [Node.js](https://nodejs.org) 20 or later.

```bash
npm install
npm start
```

## Release a new version

1. Bump `version` in `package.json` and commit.
2. Tag and push: `git tag v1.1.0 && git push origin main v1.1.0`.
3. GitHub Actions builds Windows and Mac and attaches them to the release. Installed apps pick it up
   from Settings → Updates.
