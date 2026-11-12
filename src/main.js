const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
// Keep settings/accounts in the same folder whether run from source or installed,
// so switching to the installed app keeps your accounts.
app.setPath('userData', path.join(app.getPath('appData'), 'trademe-lister'));
const store = require('./store');
const tm = require('./trademe');
const sku = require('./sku');
const trace = require('./trace');

let win;

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 980,
    minHeight: 640,
    backgroundColor: '#0e1014',
    title: 'Tagline',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, webviewTag: true },
  });
  // Embedded Trade Me pages (Questions tab): only trademe.co.nz, never with node access or our preload.
  win.webContents.on('will-attach-webview', (e, prefs, params) => {
    delete prefs.preload;
    prefs.nodeIntegration = false;
    prefs.contextIsolation = true;
    prefs.sandbox = true;
    if (!/^https:\/\/([a-z0-9-]+\.)*trademe\.co\.nz\//i.test(params.src) || !String(params.partition).startsWith('persist:tm-')) e.preventDefault();
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

const account = (id) => {
  const a = store.getAccount(id);
  if (!a) throw new Error('Pick a Trade Me account first (Settings → Accounts).');
  return a;
};
// History entry for something done to a listing on this account.
const logAction = (acc, action, fields) =>
  store.addHistory({ action, accountNickname: acc.nickname, env: acc.env, ...(fields.listingId ? { url: tm.listingUrl(acc.env, fields.listingId) } : {}), ...fields });
const priceOf = (l) => l?.BuyNowPrice || l?.StartPrice || null;

// Wrap handlers so errors reach the renderer as { error } instead of an opaque rejection.
const handle = (ch, fn) =>
  ipcMain.handle(ch, async (_e, ...args) => {
    try {
      return { ok: true, data: await fn(...args) };
    } catch (err) {
      return { ok: false, error: err.message || String(err) };
    }
  });

// Updates come from this repo's GitHub Releases (public, so no token needed).
// Only the installed app can update itself; running from source just reports the version.
let updater = null;
const getUpdater = () => {
  if (updater || !app.isPackaged) return updater;
  updater = require('electron-updater').autoUpdater;
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = true;
  updater.on('download-progress', (p) => win?.webContents.send('update-progress', Math.round(p.percent)));
  updater.on('update-downloaded', () => win?.webContents.send('update-progress', 100));
  return updater;
};
handle('update:check', async () => {
  const u = getUpdater();
  if (!u) return { current: app.getVersion(), dev: true };
  const r = await u.checkForUpdates();
  const latest = r?.updateInfo?.version;
  return {
    current: app.getVersion(),
    latest,
    available: !!latest && r.isUpdateAvailable !== false && latest !== app.getVersion(),
    // macOS only installs updates for Apple-signed apps; until then, download the new .dmg by hand.
    manual: process.platform === 'darwin',
    url: 'https://github.com/FootlockerNZ/tagline/releases/latest',
  };
});
handle('update:download', async () => {
  await getUpdater().downloadUpdate();
  return true;
});
handle('update:install', () => setImmediate(() => getUpdater().quitAndInstall()));
handle('app:version', () => app.getVersion());

handle('settings:get', () => store.publicSettings());
handle('settings:update', (patch) => (store.updateSettings(patch), store.publicSettings()));

handle('account:login', async (env) => {
  const r = await tm.login(env, win);
  const added = store.load().accounts.find((a) => a.env === env && String(a.memberId) === String(r?.memberId ?? r?.account?.memberId));
  store.addHistory({ action: 'account-added', accountNickname: added?.nickname || r?.nickname || r?.account?.nickname || '', env });
  return { ...r, settings: store.publicSettings() };
});
handle('account:remove', (id) => {
  const acc = store.getAccount(id);
  store.removeAccount(id);
  if (acc) store.addHistory({ action: 'account-removed', accountNickname: acc.nickname, env: acc.env });
  return store.publicSettings();
});

handle('sku:lookup', (raw, brandOverride) => {
  const s = sku.normalize(raw);
  const brand = brandOverride || sku.detect(s);
  return {
    sku: s,
    brand,
    detected: sku.detect(s),
    candidates: sku.detectAll(s), // >1 = pattern is ambiguous (e.g. Hoka vs Birkenstock)
    label: sku.BRANDS[brand]?.label || '',
  };
});

// Trace product lookup. Results come back in Trace's order; the first is the default pick.
// Sign in with your Trace email + password (saved encrypted on this computer) and keep the token.
// When it expires, trace:search signs in again with the saved details. A blank password reuses the saved one.
handle('trace:login', async ({ email, password } = {}) => {
  email = String(email || '').trim();
  password = password || store.traceLogin()?.password;
  if (!email || !password) throw new Error('Enter your Trace email and password.');
  const token = await trace.signIn(email, password);
  // Check the token actually works for lookups before saving, so problems show in the login popup.
  const check = await traceFetch('DD1391-100', token).catch(() => null);
  if (check?.status === 401 || check?.status === 403)
    throw new Error(`Trace accepted your login but refused product lookups (${check.status}).`);
  store.updateSettings({ trace: { token, viaLogin: true, email, password } });
  return store.publicSettings();
});
let traceRefreshing = null;
const traceFetch = (q, token) =>
  // Works for SKUs and product names alike; Trace expects spaces as "+".
  fetch(`https://fulltrace-server.onrender.com/api/products?search=${encodeURIComponent(String(q).trim()).replace(/%20/g, '+')}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
handle('trace:search', async (q) => {
  let token = store.traceToken();
  if (!token) return null; // not configured → caller falls back to image templates
  let res = await traceFetch(q, token);
  // Expired: if your Trace email and password are saved, sign in again quietly and try once more.
  const creds = store.traceLogin();
  let signInError = null;
  if (res.status === 401 && creds) {
    try {
      traceRefreshing ||= trace.signIn(creds.email, creds.password).finally(() => (traceRefreshing = null));
      token = await traceRefreshing;
      store.updateSettings({ trace: { token, viaLogin: true } });
      res = await traceFetch(q, token);
    } catch (err) {
      signInError = err;
    }
  }
  const j = await res.json().catch(() => null);
  if (res.status === 401) {
    if (signInError) throw new Error(`Trace wouldn't sign you in again: ${signInError.message} Check Settings → Product lookup.`);
    throw new Error(creds ? 'Trace signed you in but refused the product lookup (401). Try Change login.' : 'Trace token expired. Log in under Settings → Product lookup.');
  }
  if (!res.ok || !j) throw new Error(`Trace lookup failed (${res.status})`);
  // StockX thumbnails are 140×100; ask the same CDN for a large version for the listing photo.
  const big = (u) => (/images\.stockx\.com/.test(u) ? u.replace(/([?&])w=\d+/, '$1w=1200').replace(/([?&])h=\d+/, '$1h=1200') : u);
  return (j.data?.products || []).map((p) => ({
    title: p.title,
    sku: p.sku,
    handle: p.stockXHandle || '',
    brand: p.brand,
    colour: p.color || '',
    gender: p.gender || '',
    thumb: p.image,
    image: p.image && !/Placeholder/i.test(p.image) ? big(p.image) : '',
  }));
});

handle('image:fetch', async (url) => {
  const { buffer, mime } = await sku.fetchImage(url);
  return `data:${mime};base64,${buffer.toString('base64')}`;
});

handle('category:search', (env, q) => tm.searchCategories(env, q));
handle('category:details', async (env, number) => {
  const d = await tm.categoryDetails(env, number);
  return {
    name: d.Name,
    path: d.Path,
    // Promotion packages (Basic is free), unit fees and allowed durations for the cost UI.
    promotions: (d.Promotions || []).map((p) => ({ id: p.Id, name: p.Name, price: p.Price || 0, recommended: !!p.Recommended, description: p.Description || '' })),
    fees: d.Fees || {},
    durations: d.AllowedDurations || [],
    attributes: (d.Attributes || []).map((a) => ({
      name: a.Name,
      label: a.DisplayName || a.Name,
      type: a.Type,
      required: !!a.IsRequiredForSell,
      options: (a.Options || []).map((o) => ({ value: o.Value, label: o.Display || o.Value })),
      group: a.GroupName,
    })),
  };
});

const validationMessage = (r) =>
  [r.Description, ...(r.ValidationErrors || []).map((v) => v.Message)].filter(Boolean).join('\n') || 'Trade Me rejected the listing.';

// What Trade Me will charge to list this, plus the success fee if it sells at salePrice.
// Uses placeholder title/description so it works on a half-filled form.
handle('listing:fees', async ({ accountId, listing, salePrice }) => {
  const acc = account(accountId);
  const body = {
    ...listing,
    Title: listing.Title?.trim() || 'Fee estimate',
    Description: listing.Description?.[0]?.trim() ? listing.Description : ['Fee estimate'],
    Attributes: [],
  };
  const [f, s] = await Promise.all([
    tm.api(acc, 'POST', '/v1/Selling/Fees.json', body),
    salePrice > 0 ? tm.api(acc, 'POST', `/v1/Selling/SuccessFees.json?sale_price=${salePrice}`, body).catch(() => null) : null,
  ]);
  if (!f.Success) throw new Error(validationMessage(f));
  return {
    total: f.TotalCost || 0,
    items: (f.FeeItems?.List || []).map((i) => ({ label: i.Description, amount: (i.Debit || 0) - (i.Credit || 0) })).filter((i) => i.amount),
    insufficient: !!f.InsufficientBalance,
    successFee: s?.Success ? s.SuccessFee : null,
  };
});

handle('listing:validate', async ({ accountId, listing }) => {
  const r = await tm.validate(account(accountId), listing);
  if (!r.Success) throw new Error(validationMessage(r));
  return true;
});

// photos: [{ base64, fileName }] already converted to JPEG by the renderer.
handle('listing:submit', async ({ accountId, listing, photos, meta }) => {
  const acc = account(accountId);
  const photoIds = [];
  for (const [i, p] of photos.entries()) {
    win?.webContents.send('progress', `Uploading photo ${i + 1} of ${photos.length}…`);
    photoIds.push(await tm.uploadPhoto(acc, { buffer: Buffer.from(p.base64, 'base64'), fileType: 'JPG', fileName: p.fileName }));
  }
  win?.webContents.send('progress', 'Creating listing…');
  const r = await tm.list(acc, { ...listing, PhotoIds: photoIds });
  if (!r.Success) throw new Error(validationMessage(r));
  const url = tm.listingUrl(acc.env, r.ListingId);
  store.addHistory({
    action: 'listed',
    listingId: r.ListingId,
    url,
    title: listing.Title,
    sku: listing.SKU,
    price: listing.BuyNowPrice || listing.StartPrice,
    accountNickname: acc.nickname,
    env: acc.env,
    thumb: meta?.thumb,
    at: new Date().toISOString(),
  });
  return { listingId: r.ListingId, url };
});

// Unsold listings that can still be relisted and haven't been yet.
// Trade Me only keeps unsold items for 45 days, so that's the furthest back this can see.
const tmDate = (d) => {
  const m = /Date\((\d+)/.exec(d || '');
  return m ? new Date(+m[1]).toISOString() : d || null;
};
handle('relist:list', async (accountId) => {
  const acc = account(accountId);
  const out = [];
  for (let page = 1; page <= 20; page++) {
    const r = await tm.api(acc, 'GET', `/v1/MyTradeMe/UnsoldItems/ItemsICanRelist.json?page=${page}&rows=200&photo_size=List`);
    for (const i of r.List || []) {
      if (i.RelistedItemId || i.CanRelist === false) continue;
      out.push({
        listingId: i.ListingId,
        title: i.Title,
        price: i.BuyNowPrice || i.StartPrice,
        isBuyNow: !!i.BuyNowPrice,
        endDate: tmDate(i.EndDate),
        picture: i.PictureHref || '',
        url: tm.listingUrl(acc.env, i.ListingId),
      });
    }
    if (!r.List?.length || page * (r.PageSize || 200) >= r.TotalCount) break;
  }
  return out.sort((a, b) => (b.endDate || '').localeCompare(a.endDate || ''));
});

// Archive/unarchive relistable listings. `items` are the rows from relist:list (or just { listingId } to unarchive).
handle('relist:archive', ({ accountId, items, archived }) => {
  const acc = account(accountId);
  const pick = ({ listingId, title, price, isBuyNow, endDate, picture, url }) => ({ listingId: +listingId, env: acc.env, memberId: acc.memberId, title, price, isBuyNow, endDate, picture, url });
  store.setArchived(items.map(pick), archived);
  for (const i of items) logAction(acc, archived ? 'archived' : 'unarchived', { listingId: +i.listingId, title: i.title || store.load().relistArchive[i.listingId]?.title, price: i.price, thumb: i.picture });
  return store.publicSettings();
});

// Relists one at a time so a single failure doesn't stop the rest.
handle('relist:run', async ({ accountId, ids, meta = {} }) => {
  const acc = account(accountId);
  const results = [];
  for (const [n, id] of ids.entries()) {
    win?.webContents.send('relist-progress', { id, n: n + 1, total: ids.length });
    try {
      if (store.isArchived(id)) throw new Error('Archived: unarchive it to relist.');
      const r = await tm.api(acc, 'POST', '/v1/Selling/Relist.json', { ListingId: id });
      results.push(r.Success ? { id, ok: true, newId: r.ListingId, url: tm.listingUrl(acc.env, r.ListingId) } : { id, ok: false, error: r.Description || 'Relist failed' });
    } catch (err) {
      results.push({ id, ok: false, error: err.message });
    }
    const res = results.at(-1), m = meta[id] || {};
    logAction(acc, res.ok ? 'relisted' : 'relist-failed', { listingId: res.ok ? res.newId : id, oldListingId: id, title: m.title, price: m.price, thumb: m.picture, detail: res.ok ? `Was #${id}` : res.error });
    win?.webContents.send('relist-progress', { id, n: n + 1, total: ids.length, result: res });
  }
  return results;
});

// Suggested price from comparable live listings (Trade Me doesn't expose past sale prices).
// Searches by SKU and by model name, keeps listings that carry the same SKU or the same model name
// with no other style code, ignores size and your own listings, and only uses Buy Now prices.
const STOP = new Set(['retro', 'men', 'mens', 'womens', 'wmns', 'women', 'unisex', 'shoes', 'shoe', 'sneakers', 'sneaker', 'the', 'and', 'og', 'new', 'brand']);
const CODE_RES = Object.values(sku.BRANDS).map((b) => new RegExp('\\b' + b.re.source.replace(/^\^|\$$/g, '').replace('(?=.{6})', '') + '\\b', 'gi'));
handle('price:comps', async ({ accountId, sku: rawSku, name, brand, isNew }) => {
  const acc = account(accountId);
  const code = sku.normalize(rawSku);
  const own = new Set(store.load().accounts.map((a) => a.memberId));
  const tokens = String(name || '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOP.has(t) && t !== String(brand || '').toLowerCase());
  const queries = [code, tokens.length >= 2 ? `${brand || ''} ${tokens.join(' ')}`.trim() : ''].filter(Boolean);

  const seen = new Map();
  for (const q of queries) {
    const r = await tm.api(acc, 'GET', `/v1/Search/General.json?search_string=${encodeURIComponent(q)}&rows=100&photo_size=List`).catch(() => null);
    for (const i of r?.List || []) if (!seen.has(i.ListingId)) seen.set(i.ListingId, i);
  }

  // Kids/infant pairs sell for far less; skip them unless the item itself is a kids' version.
  const KIDS = /\b(infants?|toddlers?|td|ps|gs|pre-?school|grade school|youth|kids?|baby|\d{1,2}(\.5)?\s?[cy])\b/i;
  const wantKids = KIDS.test(String(name || ''));
  const comps = [];
  for (const i of seen.values()) {
    if (!wantKids && KIDS.test(String(i.Title || ''))) continue;
    if (own.has(i.MemberId) || !(i.BuyNowPrice > 0)) continue;
    if (!i.IsNew) continue; // brand-new listings only
    const title = String(i.Title || '');
    const t = title.toLowerCase();
    const codes = CODE_RES.flatMap((re) => title.toUpperCase().match(re) || []);
    const hasCode = code && (t.includes(code.toLowerCase()) || codes.includes(code));
    const nameMatch = tokens.length >= 2 && tokens.every((w) => t.includes(w));
    const otherCode = codes.length && !codes.includes(code);
    if (!(hasCode || (nameMatch && !otherCode))) continue;
    comps.push({ id: i.ListingId, title, price: i.BuyNowPrice, url: tm.listingUrl(acc.env, i.ListingId), picture: i.PictureHref || '', exact: !!hasCode });
  }
  comps.sort((a, b) => b.exact - a.exact || a.price - b.price);

  // Size for each comp (display only): from the title, else the listing's description or Size field.
  const SIZE_RE = /\b(?:(US|UK|EU)\s?(?:men'?s\s|mens\s|M\s)?(\d{1,2}(?:\.5)?)|size\s?:?\s?(?:US\s?)?(\d{1,2}(?:\.5)?))\b/i;
  const sizeFrom = (text) => {
    const m = String(text || '').match(SIZE_RE);
    return m ? (m[1] ? `${m[1].toUpperCase()} ${m[2]}` : `US ${m[3]}`) : '';
  };
  const shown = comps.slice(0, 15);
  for (let i = 0; i < shown.length; i += 5) {
    await Promise.all(
      shown.slice(i, i + 5).map(async (c) => {
        c.size = sizeFrom(c.title);
        if (c.size) return;
        const d = await tm.api(acc, 'GET', `/v1/Listings/${c.id}.json`).catch(() => null);
        const attr = (d?.Attributes || []).find((a) => /size/i.test(a.Name))?.DisplayValue || '';
        c.size = sizeFrom(attr) || sizeFrom(d?.Body) || attr;
      }),
    );
  }

  // Suggestion: undercut the cheapest exact-SKU listing by $10; with no exact match, the average of similar ones.
  const exact = comps.filter((c) => c.exact);
  const basis = exact.length ? 'exact' : 'similar';
  const suggested = exact.length
    ? Math.max(1, Math.round(exact[0].price - 10))
    : comps.length
      ? Math.round(comps.reduce((s, c) => s + c.price, 0) / comps.length)
      : null;
  const prices = comps.map((c) => c.price);
  return { comps, count: comps.length, exactCount: exact.length, basis, suggested, low: prices.length ? Math.min(...prices) : null, high: prices.length ? Math.max(...prices) : null, exactLow: exact[0]?.price ?? null };
});

// Trade Me account balance (pays listing fees) and Ping balance (money from sales).
handle('account:balance', async (accountId) => {
  const r = await tm.api(account(accountId), 'GET', '/v1/MyTradeMe/Summary.json');
  return { balance: r.Balance ?? null, ping: r.PayNowBalance ?? null };
});

// Which payment methods the account has set up (from its Trade Me selling preferences).
handle('account:payments', async (accountId) => {
  const r = await tm.api(account(accountId), 'GET', '/v1/Selling/Preferences.json');
  const m = r.DefaultEnabledSellingMethods || [];
  return { ping: m.includes(32), afterpay: m.includes(64), cash: m.includes(4) };
});

// Everything currently for sale on one or more accounts, whether listed from this app or not.
handle('live:list', async (accountIds) => {
  const out = [];
  for (const id of accountIds) {
    const acc = account(id);
    for (let page = 1; page <= 20; page++) {
      const r = await tm.api(acc, 'GET', `/v1/MyTradeMe/SellingItems/All.json?page=${page}&rows=200&photo_size=List`);
      for (const i of r.List || []) {
        out.push({
          accountId: id,
          nickname: acc.nickname,
          listingId: i.ListingId,
          title: i.Title,
          picture: i.PictureHref || '',
          url: tm.listingUrl(acc.env, i.ListingId),
          buyNow: i.BuyNowPrice || 0,
          start: i.StartPrice || 0,
          maxBid: i.MaxBidAmount || 0,
          bids: i.BidCount || 0,
          // Trade Me leaves these out when they're 0.
          views: i.ViewCount ?? 0,
          watchers: i.BidderAndWatchers ?? 0,
          quantity: i.Quantity ?? i.RemainingQuantity ?? null,
          sku: i.SKU || '',
          startDate: tmDate(i.StartDate),
          endDate: tmDate(i.EndDate),
        });
      }
      if (!r.List?.length || page * (r.PageSize || 200) >= r.TotalCount) break;
    }
  }
  return out.sort((a, b) => (a.endDate || '').localeCompare(b.endDate || ''));
});

// A live listing in Trade Me's edit format (the full sell form as it stands now).
handle('listing:get', async ({ accountId, listingId }) => tm.api(account(accountId), 'GET', `/v1/Selling/Listings/${listingId}.json`));

// Edit sends the whole form back: anything left out is reset, so `listing` is the fetched form with changes applied.
handle('listing:edit', async ({ accountId, listing, before, thumb }) => {
  // Drop the read-only extras the retrieve call adds; everything else goes back as it was.
  const { ImmutableFields, AvailablePromotions, AvailablePaymentMethodsForEdit, Photos, StartDate, IsSafePaymentsCompliant, ...body } = listing;
  const acc = account(accountId);
  const r = await tm.api(acc, 'POST', '/v1/Selling/Edit.json', body);
  if (!r.Success) throw new Error(validationMessage(r));
  // Log what changed. Only a price change is logged as 'price'; anything else is 'edited' with the field names.
  const FIELDS = { Title: 'title', Description: 'description', SKU: 'SKU', BuyNowPrice: 'Buy Now price', StartPrice: 'start price', ReservePrice: 'reserve', Quantity: 'quantity', IsCounterOffersAllowed: 'offers' };
  const changed = before ? Object.keys(FIELDS).filter((k) => JSON.stringify(before[k] ?? null) !== JSON.stringify(listing[k] ?? null)) : [];
  const onlyPrice = changed.length && changed.every((k) => /Price$/.test(k));
  const from = priceOf(before), to = priceOf(listing);
  logAction(acc, onlyPrice ? 'price' : 'edited', {
    listingId: listing.ListingId, title: listing.Title, price: to, thumb,
    ...(from !== to ? { from, to } : {}),
    detail: onlyPrice ? '' : changed.length ? 'Changed ' + changed.map((k) => FIELDS[k]).join(', ') : '',
  });
  return true;
});

// Take a live listing down. sold: true = sold elsewhere (optional salePrice), false = just withdrawn (optional reason).
handle('listing:withdraw', async ({ accountId, listingId, sold, salePrice, reason, meta = {} }) => {
  const body = { ListingId: listingId, Type: sold ? 1 : 2 };
  if (sold && salePrice > 0) body.SalePrice = salePrice;
  if (!sold && reason) body.Reason = String(reason).slice(0, 255);
  const acc = account(accountId);
  const r = await tm.api(acc, 'POST', '/v1/Selling/Withdraw.json', body);
  if (!r.Success) throw new Error(r.Description || 'Trade Me would not withdraw the listing.');
  logAction(acc, sold ? 'sold-elsewhere' : 'withdrawn', {
    listingId, title: meta.title, price: sold && salePrice > 0 ? salePrice : meta.price, thumb: meta.picture,
    detail: sold ? (salePrice > 0 ? `Sold elsewhere for ${salePrice}` : 'Sold elsewhere') : reason || '',
  });
  return true;
});

// Sold items (Trade Me keeps 45 days) for one or more accounts, with the real fees and payout.
const SOLD_STATUS = { 0: 'Unknown', 10: 'Awaiting payment', 20: 'Paid', 30: 'Shipped', 40: 'Completed' };
handle('sold:list', async (accountIds) => {
  const out = [];
  for (const id of accountIds) {
    const acc = account(id);
    for (let page = 1; page <= 10; page++) {
      const r = await tm.api(acc, 'GET', `/v1/MyTradeMe/SoldItems/Last45Days.json?page=${page}&rows=200&photo_size=List`);
      for (const i of r.List || []) {
        const qty = i.QuantitySold || 1;
        const subtotal = i.SubtotalPrice ?? (i.SalePrice ?? i.Price ?? 0);
        const shipping = i.TotalShippingPrice ?? i.ShippingPrice ?? 0;
        const method = i.PaymentDetails?.PaymentType || i.PaymentMethod || 0;
        const processing = i.PaymentDetails?.PaymentMethodFee || 0;
        const success = i.SuccessFees || 0;
        out.push({
          accountId: id,
          nickname: acc.nickname,
          listingId: i.ListingId,
          purchaseId: i.PurchaseId,
          title: i.Title,
          picture: i.PictureHref || '',
          url: tm.listingUrl(acc.env, i.ListingId),
          soldDate: tmDate(i.SoldDate),
          buyer: i.Buyer?.Nickname || '',
          qty,
          subtotal,
          shipping,
          total: i.TotalSalePrice ?? subtotal + shipping,
          method, // 32 Ping, 64 Afterpay, 4 Cash, 0 not paid yet
          processing,
          success,
          payout: Math.round((subtotal + shipping - processing - success) * 100) / 100,
          pending: !!(i.IsPaymentPending || i.PaymentDetails?.IsPaymentPending),
          status: SOLD_STATUS[i.Status] || '',
        });
      }
      if (!r.List?.length || page * (r.PageSize || 200) >= r.TotalCount) break;
    }
  }
  return out.sort((a, b) => (b.soldDate || '').localeCompare(a.soldDate || ''));
});

// Questions: every unanswered question, plus full Q&A threads for your current listings.
const mapQuestion = (q) => ({
  id: q.ListingQuestionId,
  listingId: q.ListingId,
  comment: q.Comment || '',
  commentDate: tmDate(q.CommentDate),
  answer: q.Answer || '',
  answerDate: q.Answer ? tmDate(q.AnswerDate) : null,
  isSellerComment: !!q.IsSellerComment,
  asker: q.AskingMember ? { nickname: q.AskingMember.Nickname || 'Member', feedback: q.AskingMember.FeedbackCount ?? null, photo: q.AskingMember.Photo || '' } : null,
});
handle('questions:list', async (accountId) => {
  const acc = account(accountId);
  const listings = new Map(); // listingId → { listingId, title, picture, url, questions: Map }
  const ensure = (id, info = {}) => {
    if (!listings.has(id)) listings.set(id, { listingId: id, title: '', picture: '', url: tm.listingUrl(acc.env, id), endDate: null, questions: new Map() });
    return Object.assign(listings.get(id), Object.fromEntries(Object.entries(info).filter(([, v]) => v)));
  };

  // Current listings (titles, photos) — capped so a big store doesn't hammer the API.
  for (let page = 1; page <= 5; page++) {
    const r = await tm.api(acc, 'GET', `/v1/MyTradeMe/SellingItems/All.json?page=${page}&rows=100&photo_size=List`);
    for (const i of r.List || []) ensure(i.ListingId, { title: i.Title, picture: i.PictureHref, endDate: tmDate(i.EndDate) });
    if (!r.List?.length || page * (r.PageSize || 100) >= r.TotalCount) break;
  }

  const unanswered = await tm.api(acc, 'GET', '/v1/Listings/Questions/UnansweredQuestions.json');
  for (const q of unanswered.List || []) ensure(q.ListingId).questions.set(q.ListingQuestionId, mapQuestion(q));

  // Full threads (answered + unanswered) for current listings, 5 at a time.
  const ids = [...listings.keys()].slice(0, 150);
  for (let i = 0; i < ids.length; i += 5) {
    await Promise.all(
      ids.slice(i, i + 5).map(async (id) => {
        const r = await tm.api(acc, 'GET', `/v1/Listings/${id}/Questions.json?rows=100`).catch(() => null);
        for (const q of r?.List || []) listings.get(id).questions.set(q.ListingQuestionId, mapQuestion(q));
      }),
    );
  }

  // Every API-visible listing, including ones with no questions yet (the "All" filter shows them).
  const withQuestions = [...listings.values()].map((l) => ({
    ...l,
    questions: [...l.questions.values()].sort((a, b) => (a.commentDate || '').localeCompare(b.commentDate || '')),
  }));

  // Listings on Trade Me's newer "Koru" platform (ListingPlatform 2) don't show up in the selling or
  // questions APIs at all. Find them through public search by seller; the app shows their Q&A by
  // embedding Trade Me's own listing page.
  const koru = [];
  for (let page = 1; page <= 5; page++) {
    const r = await tm.api(acc, 'GET', `/v1/Search/General.json?member_listing=${acc.memberId}&page=${page}&rows=100&photo_size=List`).catch(() => null);
    for (const i of r?.List || []) {
      if (i.ListingPlatform !== 2 || listings.has(i.ListingId)) continue;
      koru.push({ listingId: i.ListingId, title: i.Title, picture: i.PictureHref || '', url: tm.listingUrl(acc.env, i.ListingId), endDate: tmDate(i.EndDate), koru: true, questions: [] });
    }
    if (!r?.List?.length || page * (r.PageSize || 100) >= r.TotalCount) break;
  }
  return [...withQuestions, ...koru];
});
handle('questions:answer', async ({ accountId, listingId, questionId, answer, meta = {} }) => {
  const acc = account(accountId);
  const r = await tm.api(acc, 'POST', `/v1/Listings/${listingId}/Questions/${questionId}/AnswerQuestion.json`, { answer: String(answer).slice(0, 500) });
  logAction(acc, 'answered', { listingId, title: meta.title, thumb: meta.picture, detail: String(answer).slice(0, 140) });
  return mapQuestion({ ...r, ListingId: r.ListingId || listingId });
});

handle('open:external', (url) => /^https:\/\//.test(url) && shell.openExternal(url));

// Links that open a new window from an embedded Trade Me page go to the real browser instead.
app.on('web-contents-created', (_e, wc) => {
  if (wc.getType() !== 'webview') return;
  wc.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
});

// Own taskbar identity on Windows so the taskbar shows our icon, not Electron's.
if (process.platform === 'win32') app.setAppUserModelId('nz.lister.trademe');
app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
