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

1. **Trade Me API keys.** Get a consumer key and secret (see [Applying for a Trade Me API key](#applying-for-a-trade-me-api-key)
   below) and paste them into **Settings → Trade Me API** in Tagline.
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

## Applying for a Trade Me API key

Tagline talks to Trade Me through your own registered API application. Each business needs its own.

> **Who can apply:** since 10 April 2026 Trade Me only approves Marketplace API applications for
> **in-trade sellers**. Make sure your Trade Me account is set up as an in-trade seller first.

1. Log in to [trademe.co.nz](https://www.trademe.co.nz) with the account that should own the app.
   Apps can't be moved to another member later, so use the business account, not a personal one.
2. Open [Register a new application](https://www.trademe.co.nz/MyTradeMe/Api/RegisterNewApplication.aspx),
   or go to **My Trade Me → Settings → API Applications**.
3. Fill in the form:
   - **Application name / description:** e.g. "Tagline – listing tool for our store". Say it's for
     listing and managing your own stock.
   - **Callback URL:** `https://localhost/trademe-callback`
   - **Permissions:** Read and Write (needed to create, edit and withdraw listings).
   - **Contact email:** a business or shared inbox. Trade Me uses it for outage and API change notices.
4. Submit. Copy the **Consumer key** and **Consumer secret** shown and keep them somewhere safe.
5. **Wait for approval.** Live-site apps are reviewed by Trade Me against their
   [use cases](https://developer.trademe.co.nz/api-overview/use-cases) and
   [terms](https://developer.trademe.co.nz/terms-and-conditions). Until it's approved, logging in from
   Tagline won't work.
6. Once approved, paste the key and secret into **Settings → Trade Me API** in Tagline, then log in
   your account(s) under **Settings → Accounts**.

**Testing first (optional):** the [Trade Me Sandbox](https://www.tmsandbox.co.nz) is a separate test
site with its own membership. Sandbox apps are approved instantly:
[register one here](https://www.tmsandbox.co.nz/MyTradeMe/Api/RegisterNewApplication.aspx) and switch
Tagline to Sandbox in Settings. Listings there aren't real.

Never share your consumer secret or commit it anywhere. Tagline stores it encrypted on your computer only.

---

## For developers

*Only needed if you are changing Tagline's code. To just use the app, follow the install and setup steps above.*

### Run from source

Needs [Node.js](https://nodejs.org) 20 or later.

```bash
npm install
npm start
```

### Release a new version

1. Bump `version` in `package.json` and commit.
2. Tag and push: `git tag v1.1.0 && git push origin main v1.1.0`.
3. GitHub Actions builds Windows and Mac and attaches them to the release. Installed apps pick it up
   from Settings → Updates.
