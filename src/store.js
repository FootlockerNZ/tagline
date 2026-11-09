// Settings + accounts persisted as JSON in the app's userData folder.
// Token secrets are encrypted with the OS keychain (safeStorage) when available.
const { app, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');

const file = () => path.join(app.getPath('userData'), 'settings.json');

const DEFAULTS = {
  env: 'production', // 'production' | 'sandbox'
  consumer: {
    production: { key: '', secret: '' },
    sandbox: { key: '', secret: '' },
  },
  accounts: [], // { id, env, nickname, memberId, token, secret (encrypted), addedAt }
  defaultAccountId: null,
  payment: { ping: true, afterpay: true, cash: false },
  shipping: [
    { method: 'Nationwide courier', price: 8 },
    { method: 'Rural delivery', price: 13 },
  ],
  pickup: 1, // 1 Allow, 2 Demand, 3 Forbid
  duration: 7,
  listingType: 'buynow', // 'buynow' | 'auction'
  isBrandNew: true,
  allowOffers: false, // Trade Me "Make an Offer"
  category: { number: '', path: '' },
  titleTemplate: '{brand} {name} {sku} US{size}',
  descriptionTemplate:
    '{brand} {name}\r\nStyle code: {sku}\r\nSize: US {size}\r\nCondition: {condition}\r\n\r\n100% authentic. Ships next business day.\r\nShipping: $8 nationwide, $13 rural.',
  history: [], // { listingId, title, sku, accountNickname, env, price, at }
  // Listing sections: each has its own category + defaults. Seeded from the fields above on first run.
  profiles: [],
  accountProfiles: {}, // accountId → its own sections (falls back to `profiles`)
  lastProfileId: null,
  trace: { token: '' }, // Trace (jointrace.co) bearer token for product lookup, encrypted
};

const PROFILE_KEYS = ['category', 'listingType', 'duration', 'isBrandNew', 'allowOffers', 'pickup', 'payment', 'shipping', 'titleTemplate', 'descriptionTemplate'];

function seedProfiles(s) {
  const base = Object.fromEntries(PROFILE_KEYS.map((k) => [k, structuredClone(s[k])]));
  return [
    { ...base, id: 'mens', name: "Men's sneakers", category: s.category.number ? s.category : { number: '0153-0438-0168-', path: 'Clothing & Fashion › Men › Shoes' } },
    { ...base, id: 'womens', name: "Women's sneakers", category: { number: '0153-0439-0762-', path: 'Clothing & Fashion › Women › Shoes' } },
    {
      ...base,
      id: 'collectables',
      name: 'Collectables',
      category: { number: '', path: '' },
      titleTemplate: '{brand} {name} {sku}',
      descriptionTemplate: '{brand} {name}\r\nCondition: {condition}\r\n\r\n100% authentic. Ships next business day.\r\nShipping: $8 nationwide, $13 rural.',
    },
  ];
}

function deepMerge(base, over) {
  if (Array.isArray(base) || typeof base !== 'object' || base === null) return over ?? base;
  const out = { ...base };
  for (const k of Object.keys(over || {})) out[k] = deepMerge(base[k], over[k]);
  return out;
}

let cache;
function load() {
  if (cache) return cache;
  try {
    cache = deepMerge(DEFAULTS, JSON.parse(fs.readFileSync(file(), 'utf8')));
  } catch {
    cache = structuredClone(DEFAULTS);
  }
  if (!cache.profiles?.length) cache.profiles = seedProfiles(cache);
  return cache;
}

function save(next) {
  cache = next;
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(next, null, 2));
  return next;
}

const enc = (s) =>
  safeStorage.isEncryptionAvailable() ? 'enc:' + safeStorage.encryptString(s).toString('base64') : s;
const dec = (s) =>
  s?.startsWith('enc:') ? safeStorage.decryptString(Buffer.from(s.slice(4), 'base64')) : s;

// What the renderer sees: no secrets.
function publicSettings() {
  const s = load();
  return {
    ...s,
    consumer: {
      production: { key: s.consumer.production.key, hasSecret: !!s.consumer.production.secret },
      sandbox: { key: s.consumer.sandbox.key, hasSecret: !!s.consumer.sandbox.secret },
    },
    accounts: s.accounts.map(({ token, secret, ...a }) => a),
    trace: { hasToken: !!s.trace.token },
  };
}

function updateSettings(patch) {
  const s = load();
  const next = deepMerge(s, patch);
  // Arrays are replaced wholesale; never let the renderer overwrite accounts/history.
  next.accounts = s.accounts;
  next.history = s.history;
  // Only overwrite consumer secrets when a new one is supplied.
  for (const env of ['production', 'sandbox']) {
    const c = patch.consumer?.[env];
    next.consumer[env] = {
      key: c?.key ?? s.consumer[env].key,
      secret: c?.secret ? enc(c.secret) : s.consumer[env].secret,
    };
  }
  // Trace token: '' clears it, undefined leaves it alone.
  const t = patch.trace?.token;
  next.trace = { token: t === undefined ? s.trace.token : t ? enc(t.replace(/^Bearer\s+/i, '').trim()) : '' };
  return save(next);
}

const traceToken = () => dec(load().trace.token) || '';

const consumer = (env) => {
  const c = load().consumer[env];
  return { key: c.key, secret: dec(c.secret) || '' };
};

function addAccount(acc) {
  const s = load();
  const accounts = s.accounts.filter((a) => !(a.env === acc.env && a.memberId === acc.memberId));
  accounts.push({ ...acc, secret: enc(acc.secret) });
  save({ ...s, accounts, defaultAccountId: s.defaultAccountId || acc.id });
}

function removeAccount(id) {
  const s = load();
  const accounts = s.accounts.filter((a) => a.id !== id);
  save({ ...s, accounts, defaultAccountId: s.defaultAccountId === id ? accounts[0]?.id || null : s.defaultAccountId });
}

function getAccount(id) {
  const a = load().accounts.find((x) => x.id === id);
  return a && { ...a, secret: dec(a.secret) };
}

function addHistory(entry) {
  const s = load();
  save({ ...s, history: [entry, ...s.history].slice(0, 500) });
}

module.exports = { load, publicSettings, updateSettings, consumer, traceToken, addAccount, removeAccount, getAccount, addHistory };
