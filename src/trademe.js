// Trade Me API client: OAuth 1.0a (PLAINTEXT over HTTPS) + selling endpoints.
// Docs: https://developer.trademe.co.nz
const { BrowserWindow } = require('electron');
const crypto = require('crypto');
const store = require('./store');

const HOSTS = {
  production: { api: 'https://api.trademe.co.nz', www: 'https://www.trademe.co.nz' },
  sandbox: { api: 'https://api.tmsandbox.co.nz', www: 'https://www.tmsandbox.co.nz' },
};
// Must match the callback registered for the app on Trade Me. The login popup intercepts it; it is never loaded.
const CALLBACK = 'https://localhost/trademe-callback';
const SCOPE = 'MyTradeMeRead,MyTradeMeWrite';

const pct = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());

function authHeader(env, { token = '', tokenSecret = '', extra = {} } = {}) {
  const c = store.consumer(env);
  if (!c.key || !c.secret) throw new Error(`No ${env} consumer key/secret. Add them in Settings → Trade Me API.`);
  const params = {
    ...extra,
    oauth_consumer_key: c.key,
    ...(token && { oauth_token: token }),
    oauth_signature_method: 'PLAINTEXT',
    oauth_signature: `${pct(c.secret)}&${pct(tokenSecret)}`,
  };
  return 'OAuth ' + Object.entries(params).map(([k, v]) => `${k}=${pct(v)}`).join(', ');
}

async function oauthPost(env, path, opts) {
  const res = await fetch(HOSTS[env].api + path, { method: 'POST', headers: { Authorization: authHeader(env, opts) } });
  const text = await res.text();
  if (!res.ok) throw new Error(`Trade Me OAuth ${res.status}: ${text.slice(0, 300)}`);
  return Object.fromEntries(new URLSearchParams(text));
}

// Opens Trade Me's own login/authorize page in a Chromium popup.
// Each login uses a fresh in-memory session so you can add several different accounts.
async function login(env, parent) {
  const req = await oauthPost(env, `/Oauth/RequestToken?scope=${SCOPE}`, { extra: { oauth_callback: CALLBACK } });
  // A fresh but persistent session: the website login made here is kept and reused by the
  // embedded Trade Me pages (Sold, Questions) for this account.
  const partition = 'persist:tm-web-' + crypto.randomUUID();

  const verifier = await new Promise((resolve, reject) => {
    const win = new BrowserWindow({
      width: 520,
      height: 760,
      parent,
      modal: true,
      title: 'Log in to Trade Me',
      autoHideMenuBar: true,
      webPreferences: { partition },
    });
    let done = false;
    const check = (url) => {
      if (!url.startsWith(CALLBACK)) return false;
      const v = new URL(url).searchParams.get('oauth_verifier');
      done = true;
      win.destroy();
      v ? resolve(v) : reject(new Error('Login was cancelled or denied.'));
      return true;
    };
    win.webContents.session.webRequest.onBeforeRequest({ urls: [CALLBACK + '*'] }, (d, cb) => {
      cb({ cancel: true });
      check(d.url);
    });
    win.webContents.on('will-redirect', (e, url) => check(url) && e.preventDefault());
    win.webContents.on('will-navigate', (e, url) => check(url) && e.preventDefault());
    win.on('closed', () => !done && reject(new Error('Login window closed.')));
    win.loadURL(`${HOSTS[env].www}/Oauth/Authorize?oauth_token=${pct(req.oauth_token)}`);
  });

  const acc = await oauthPost(env, '/Oauth/AccessToken', {
    token: req.oauth_token,
    tokenSecret: req.oauth_token_secret,
    extra: { oauth_verifier: verifier },
  });

  const account = { env, token: acc.oauth_token, secret: acc.oauth_token_secret };
  const me = await api(account, 'GET', '/v1/MyTradeMe/Summary.json');
  const saved = {
    id: crypto.randomUUID(),
    env,
    nickname: me.Nickname,
    memberId: me.MemberId,
    token: acc.oauth_token,
    secret: acc.oauth_token_secret,
    webPartition: partition,
    addedAt: new Date().toISOString(),
  };
  store.addAccount(saved);
  return { nickname: saved.nickname, memberId: saved.memberId };
}

async function api(account, method, path, body) {
  const headers = { Authorization: authHeader(account.env, { token: account.token, tokenSecret: account.secret }) };
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(HOSTS[account.env].api + path, { method, headers, body: body && JSON.stringify(body) });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = null; }
  if (!res.ok) {
    const msg = json?.ErrorDescription || json?.Description || json?.Message || text.slice(0, 400);
    throw new Error(`Trade Me ${res.status}: ${msg}`);
  }
  return json;
}

// Public catalogue calls (no auth needed).
const catCache = {};
async function categoryTree(env) {
  if (catCache[env]) return catCache[env];
  const res = await fetch(`${HOSTS[env].api}/v1/Categories.json`);
  const root = await res.json();
  const flat = [];
  const walk = (c, trail) => {
    const p = c.Name && c.Name !== 'Root' ? [...trail, c.Name] : trail;
    if (c.Number && !c.Subcategories?.length) flat.push({ number: c.Number, path: p.join(' › ') });
    (c.Subcategories || []).forEach((s) => walk(s, p));
  };
  walk(root, []);
  return (catCache[env] = flat);
}

async function searchCategories(env, q) {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  return (await categoryTree(env)).filter((c) => words.every((w) => c.path.toLowerCase().includes(w))).slice(0, 40);
}

async function categoryDetails(env, number) {
  const res = await fetch(`${HOSTS[env].api}/v1/Categories/${encodeURIComponent(number)}/Details.json`);
  if (!res.ok) throw new Error(`Category ${number} not found (${res.status})`);
  return res.json();
}

async function uploadPhoto(account, { buffer, fileType, fileName }) {
  const r = await api(account, 'POST', '/v1/Photos/Add.json', {
    PhotoData: buffer.toString('base64'),
    FileName: fileName,
    FileType: fileType,
  });
  if (r.Status !== 1 && r.Status !== 'Success') throw new Error(`Photo upload failed (status ${r.Status})`);
  return r.PhotoId;
}

const validate = (account, listing) => api(account, 'POST', '/v1/Selling/Validate.json', listing);
const list = (account, listing) => api(account, 'POST', '/v1/Selling.json', listing);
const listingUrl = (env, id) => `${HOSTS[env].www}/Browse/Listing.aspx?id=${id}`;

module.exports = { login, api, searchCategories, categoryDetails, uploadPhoto, validate, list, listingUrl };
