/* global api */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const view = $('#view');

const BRAND_LABELS = { nike: 'Nike', adidas: 'Adidas', newbalance: 'New Balance', asics: 'ASICS', puma: 'Puma', hoka: 'Hoka', birkenstock: 'Birkenstock', other: 'Other' };
const DURATIONS = [2, 3, 4, 5, 6, 7, 10, 14, 21, 28];

let S; // public settings
let current = 'new';

/* ---------- helpers ---------- */
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove('show'), 2200);
}
let modalOnClose = null;
function modal(html) {
  modalOnClose = null;
  $('#modalCard').innerHTML = html;
  $('#modal').classList.remove('hidden');
  return $('#modalCard');
}
const closeModal = () => {
  $('#modal').classList.add('hidden');
  const f = modalOnClose;
  modalOnClose = null;
  f?.();
};
// Character counter: "12/80" normally; over the limit it turns into a red bubble and the field goes red. Returns true when over.
function overCount(counter, field, n, max) {
  if (!counter) return false;
  const over = n > max;
  counter.textContent = over ? `Too long: ${n}/${max}` : `${n}/${max}`;
  counter.classList.toggle('over', over);
  field?.classList.toggle('too-long', over);
  return over;
}
// In-app replacement for confirm(): resolves true on the action button, false on Cancel, Esc or a click outside.
function ask({ title, body = '', ok = 'OK', danger = false }) {
  return new Promise((resolve) => {
    const card = modal(`
      <h3>${esc(title)}</h3>
      ${body ? `<p class="hint" style="font-size:14px;margin:0">${esc(body)}</p>` : ''}
      <div class="actions"><button class="btn ghost" id="cancel">Cancel</button><button class="btn ${danger ? 'danger' : 'primary'}" id="go">${esc(ok)}</button></div>`);
    modalOnClose = () => resolve(false);
    $('#cancel', card).onclick = closeModal;
    $('#go', card).onclick = () => ((modalOnClose = () => resolve(true)), closeModal());
    // Enter shouldn't delete things by accident: destructive asks focus Cancel.
    $(danger ? '#cancel' : '#go', card).focus();
  });
}
document.addEventListener('keydown', (e) => e.key === 'Escape' && !$('#modal').classList.contains('hidden') && !$('#go:disabled') && closeModal());
const debounce = (fn, ms) => {
  let h;
  return (...a) => (clearTimeout(h), (h = setTimeout(() => fn(...a), ms)));
};
// Shipping options as placeholders: {shippingName1} "Nationwide courier", {shippingValue1} "$8".
const shipOptions = (shipping) => (shipping || []).filter((s) => s.method && s.price !== '' && s.price != null);
const shipMoney = (v) => '$' + (Number.isInteger(+v) ? +v : (+v).toFixed(2));
const shipVars = (shipping) =>
  Object.fromEntries(shipOptions(shipping).flatMap((s, i) => [[`shippingName${i + 1}`, s.method], [`shippingValue${i + 1}`, shipMoney(s.price)]]));
// Templates that point at a shipping option the section doesn't have, e.g. {shippingName3} with only 2.
function shipRefError(p) {
  const have = shipOptions(p.shipping).length;
  const bad = [];
  for (const [where, tpl] of [['title', p.titleTemplate], ['description', p.descriptionTemplate]])
    for (const m of String(tpl || '').matchAll(/\{(shipping(?:Name|Value)(\d+))\}/g)) if (+m[2] > have || +m[2] < 1) bad.push(`{${m[1]}} in the ${where}`);
  if (!bad.length) return '';
  return `${[...new Set(bad)].join(', ')} refers to a shipping option that doesn't exist. This section has ${have} shipping option${have === 1 ? '' : 's'}.`;
}
// Empty placeholders take their attached text with them, so "US{size}" vanishes until a size is entered.
// Line by line: an empty placeholder takes its attached text with it ("[{afterpay}]", "US{size}"),
// stray separators left at a line's ends are trimmed, and a line that was only placeholders disappears.
const fill = (tpl, vars) =>
  String(tpl || '')
    .split(/\r?\n/)
    .map((line) => {
      const keys = [...line.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
      const had = keys.length > 0;
      // A line whose placeholders are all empty ("Size: US {size}") is dropped entirely.
      if (had && keys.every((k) => !vars[k])) return null;
      const out = line
        // An empty placeholder also takes the separator in front of it: "Name - US{size}" → "Name".
        // …and a short unit label right before it: "US 10C / EU {eu}" → "US 10C" when there's no EU.
        .replace(/(\s+[-|·\/])?(\s+(?:EU|US|UK|CM))?(\s*)([^\s{}]*\{(\w+)\}[^\s{}]*)/g, (m, _sep, _unit, _sp, _tok, k) => (vars[k] ? m : ''))
        .replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '')
        .replace(/[ \t]{2,}/g, ' ')
        .trim()
        .replace(/^[-|·]\s*|\s*[-|·]$/g, '')
        .trim();
      return had && !out ? null : out;
    })
    .filter((l) => l !== null)
    .join('\n')
    .trim();
const envAccounts = () => S.accounts.filter((a) => a.env === S.env);

// Normalise any image (webp, png, …) to a white-backed JPEG Trade Me accepts.
function toJpeg(src, max = 2000) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k);
      c.height = Math.round(img.height * k);
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL('image/jpeg', 0.92));
    };
    img.onerror = () => reject(new Error('Could not decode image'));
    img.src = src;
  });
}

function renderNav() {
  $$('.nav > button').forEach((b) => b.classList.toggle('active', b.dataset.view === current));
  $('#envTag').textContent = S.env === 'sandbox' ? 'Sandbox mode' : 'Resale desk';
  const n = envAccounts().length;
  $('#navAccount').textContent = n ? `${n} account${n > 1 ? 's' : ''} connected` : 'No account connected';
}

function go(v) {
  current = v;
  renderNav();
  ({ new: renderNew, live: renderLive, relist: renderRelist, sold: renderSold, questions: renderQuestions, history: renderHistory, defaults: renderDefaults, settings: renderSettings })[v]();
  // A page whose data changed while you were elsewhere reloads in the background on open.
  if (STALE.delete(v)) refreshView(v);
}

// Keeping list pages fresh. Pages already loaded keep showing their rows while they reload.
const STALE = new Set();
const LOADED = { live: () => LIVE.items, sold: () => SOLD.items, relist: () => R.items, questions: () => Q.data };
const LOADERS = { live: () => loadLive(), sold: () => loadSold(), relist: () => loadRelist(), questions: () => loadQuestions() };
function refreshView(v) {
  // A page never opened loads itself on first visit.
  if (LOADED[v]?.()) LOADERS[v]();
}
// Call after anything that changes listings on Trade Me: reloads the open page now, others on next visit.
function dataChanged(...views) {
  views.forEach((v) => (v === current ? refreshView(v) : STALE.add(v)));
}
// While Live, Sold or Questions is open, re-check Trade Me every 2 minutes and when the window comes back.
// Relist is left alone: reloading it would clear your ticked selection.
const POLLED = new Set(['live', 'sold', 'questions']);
const pollNow = () =>
  !document.hidden &&
  POLLED.has(current) &&
  $('#modal').classList.contains('hidden') &&
  !(current === 'live' && LIVE.running) &&
  // Don't re-render under you mid-typing (search box, question answer).
  !document.activeElement?.matches('input, textarea, select') &&
  refreshView(current);
setInterval(pollNow, 120000);
document.addEventListener('visibilitychange', pollNow);

/* ---------- category picker (shared) ---------- */
function categoryPicker(root, initial, onPick) {
  root.innerHTML = `
    <label class="f">Category <input class="cat-q" placeholder="Search e.g. mens sneakers" /></label>
    <p class="hint cat-cur">${initial?.number ? `Selected: <b>${esc(initial.path)}</b> <code>${esc(initial.number)}</code>` : 'No category selected'}</p>
    <div class="results hidden"></div>`;
  const out = $('.results', root);
  $('.cat-q', root).addEventListener(
    'input',
    debounce(async (e) => {
      const q = e.target.value.trim();
      if (q.length < 2) return out.classList.add('hidden');
      out.classList.remove('hidden');
      out.innerHTML = '<div><small>Searching…</small></div>';
      try {
        const r = await api.searchCategories(S.env, q);
        out.innerHTML = r.length
          ? r.map((c) => `<div data-n="${esc(c.number)}" data-p="${esc(c.path)}">${esc(c.path)}<small>${esc(c.number)}</small></div>`).join('')
          : '<div><small>No matches</small></div>';
      } catch (err) {
        out.innerHTML = `<div><small>${esc(err.message)}</small></div>`;
      }
    }, 300),
  );
  out.addEventListener('click', (e) => {
    const d = e.target.closest('[data-n]');
    if (!d) return;
    const cat = { number: d.dataset.n, path: d.dataset.p };
    $('.cat-cur', root).innerHTML = `Selected: <b>${esc(cat.path)}</b> <code>${esc(cat.number)}</code>`;
    out.classList.add('hidden');
    $('.cat-q', root).value = '';
    onPick(cat);
  });
}

/* ---------- NEW LISTING ---------- */
let F; // form state, survives tab switches
// Listing defaults are per account. An account without its own yet uses the shared set
// (S.profiles) until its defaults are first edited, which gives it its own copy.
const profList = (accId) => (accId && S.accountProfiles?.[accId]?.length ? S.accountProfiles[accId] : S.profiles);
const prof = (id, accId = F?.accountId) => profList(accId).find((p) => p.id === id) || profList(accId)[0];
function storeProfiles(accId, list) {
  S.accountProfiles = { ...(S.accountProfiles || {}), [accId]: structuredClone(list) };
  saveSettings({ accountProfiles: { [accId]: list } });
}
const P = () => prof(F.profileId);
// This listing's shipping: starts as a copy of the section's defaults, editable per listing.
const shipFrom = (p) => ({ shipping: structuredClone(p.shipping || []), pickup: +p.pickup || 1, shipPer: p.shipPer === 'item' ? 'item' : 'order' });
const SH = () => F.ship || (F.ship = shipFrom(P()));
// Optional paid extras. promotionId 1 = Basic (free).
const EXTRA_DEFAULTS = { promotionId: 1, customEnd: false, endTime: '20:00', subtitle: '' };
const extrasOf = (p) => ({ ...EXTRA_DEFAULTS, ...(p.extras || {}) });
// Default custom end: `days` from today at the section's chosen time, as a datetime-local value.
function defaultEndAt(days, time) {
  const d = new Date(Date.now() + days * 86400000);
  const [h, m] = String(time || '20:00').split(':');
  d.setHours(+h || 0, +m || 0, 0, 0);
  // Never go past the duration limit (e.g. 10 days from now at 8pm when it's already 3pm).
  if (d.getTime() > Date.now() + days * 86400000) d.setDate(d.getDate() - 1);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
const money = (n) => (n ? '$' + Number(n).toFixed(2) : 'Free');
const dollars = (n) => '$' + Number(n || 0).toFixed(2);

// Trade Me's payment processing fees for sellers (as of March 2026), deducted from what the buyer pays.
// Both are charged on the total including shipping.
const PAY_FEES = { ping: 2.19, afterpay: 4.95 };
const PAY_LABELS = { ping: 'Ping', afterpay: 'Afterpay', cash: 'Cash' };
// `avail` = what the selected account has set up; Afterpay is hidden when it isn't.
const payChipsHtml = (pay, avail) =>
  Object.entries(PAY_LABELS)
    .filter(([k]) => !(k === 'afterpay' && avail && !avail.afterpay))
    .map(
      ([k, l]) =>
        `<label class="chip ${pay[k] ? 'on' : ''}"><input type="checkbox" data-pay="${k}" ${pay[k] ? 'checked' : ''}/>${l}${PAY_FEES[k] ? ` <span class="fee">${PAY_FEES[k]}%</span>` : ''}</label>`,
    )
    .join('') +
  `<p class="hint" style="width:100%;margin:6px 0 0">Ping ${PAY_FEES.ping}% and Afterpay ${PAY_FEES.afterpay}% are taken from what the buyer pays, shipping included. Cash has no fee.${
    avail && !avail.afterpay ? ' Afterpay isn\'t set up on this account, so it\'s not offered.' : ''
  }</p>`;

// Per-account payment setup, cached for the session.
const acctPay = {};
async function applyAccountPayments() {
  const id = F?.accountId;
  if (!id) return;
  if (!acctPay[id]) acctPay[id] = await api.accountPayments(id).catch(() => null);
  if (!F || F.accountId !== id) return;
  const avail = acctPay[id];
  if (avail && !avail.afterpay && F.payment.afterpay) {
    F.payment.afterpay = false;
    F.afterpayForcedOff = true;
  } else if (avail?.afterpay && F.afterpayForcedOff) {
    // Switched back to an account with Afterpay: restore what the section wanted.
    F.payment.afterpay = !!P().payment.afterpay;
    F.afterpayForcedOff = false;
  }
  const box = $('#payChips');
  if (box) box.innerHTML = payChipsHtml(F.payment, avail);
  refreshText();
  costsSoon();
}

// Fields that come from the selected section.
const profileFields = (p) => ({
  profileId: p.id,
  condition: p.isBrandNew ? 'new' : 'used',
  type: p.listingType,
  duration: p.duration,
  payment: { ...p.payment },
  allowOffers: !!p.allowOffers, // Trade Me's "Make an Offer"
  category: { ...p.category },
  quantity: Math.max(1, +p.quantity || 1),
  ship: shipFrom(p),
  shipEditing: false,
  extras: { ...extrasOf(p), endAt: defaultEndAt(p.duration, extrasOf(p).endTime) },
  catInfo: null, // { promotions, fees, durations } for the category
  costs: null,
  attrs: [],
  attrValues: {},
  titleDirty: false,
  descDirty: false,
});
const freshForm = (profileId = S.lastProfileId, accountId = S.defaultAccountId) => ({
  accountId,
  query: '', // what's typed in the SKU box: a SKU or a product name
  sku: '', // resolved SKU (typed code, or the chosen Trace product's when searching by name)
  candidates: [],
  brandFrom: '', // 'trace' | 'pattern' | ''
  byName: false,
  brand: '', // '' = auto-detected
  detected: 'other',
  customBrand: '', // brand text used in titles: auto-filled from detection, editable
  brandTextDirty: false, // true once you've typed in the brand text box
  traceBrand: '', // brand exactly as Trace names it, e.g. "Jordan"
  name: '',
  size: '',
  price: '',
  start: '',
  buyNow: '',
  reserve: '',
  quantity: 1,
  colour: '',
  trace: [], // Trace search results
  traceIdx: 0,
  traceState: '', // '' | 'loading' | 'none' | error message
  title: '',
  desc: '',
  images: [], // { id, src, auto, status, label, error }
  ...profileFields(prof(profileId, accountId)),
});

const brandName = () => {
  const b = F.brand || F.detected;
  return String(F.customBrand || '').trim() || (b === 'other' ? '' : BRAND_LABELS[b]);
};
// US → EU shoe sizes per brand. A "W" in the size (8W, W8) means women's. Brands vary a little,
// so treat EU as a guide. Unknown brands (and Jordan) use Nike's chart.
const EU_MEN = { 3.5: 35.5, 4: 36, 4.5: 36.5, 5: 37.5, 5.5: 38, 6: 38.5, 6.5: 39, 7: 40, 7.5: 40.5, 8: 41, 8.5: 42, 9: 42.5, 9.5: 43, 10: 44, 10.5: 44.5, 11: 45, 11.5: 45.5, 12: 46, 12.5: 47, 13: 47.5, 14: 48.5, 15: 49.5 };
const EU_WOMEN = { 5: 35.5, 5.5: 36, 6: 36.5, 6.5: 37.5, 7: 38, 7.5: 38.5, 8: 39, 8.5: 40, 9: 40.5, 9.5: 41, 10: 42, 10.5: 42.5, 11: 43, 11.5: 44, 12: 44.5 };
// Adidas and Hoka share the French thirds chart; women's = men's size + 1 (Hoka W10 = M9 = 42 2/3).
const EU_THIRDS_MEN = { 4: 36, 4.5: '36 2/3', 5: '37 1/3', 5.5: 38, 6: '38 2/3', 6.5: '39 1/3', 7: 40, 7.5: '40 2/3', 8: '41 1/3', 8.5: 42, 9: '42 2/3', 9.5: '43 1/3', 10: 44, 10.5: '44 2/3', 11: '45 1/3', 11.5: 46, 12: '46 2/3', 12.5: '47 1/3', 13: 48, 14: '49 1/3', 15: '50 2/3' };
const shiftChart = (chart, by) => Object.fromEntries(Object.entries(chart).map(([us, eu]) => [+us + by, eu]));
const EU_THIRDS_WOMEN = shiftChart(EU_THIRDS_MEN, 1);
const EU_CHARTS = {
  adidas: { men: EU_THIRDS_MEN, women: EU_THIRDS_WOMEN },
  hoka: { men: EU_THIRDS_MEN, women: EU_THIRDS_WOMEN },
  asics: {
    men: { 4: 36, 4.5: 37, 5: 37.5, 5.5: 38, 6: 39, 6.5: 39.5, 7: 40, 7.5: 40.5, 8: 41.5, 8.5: 42, 9: 42.5, 9.5: 43.5, 10: 44, 10.5: 44.5, 11: 45, 11.5: 46, 12: 46.5, 12.5: 47, 13: 48, 14: 49, 15: 50.5 },
    women: { 5: 35.5, 5.5: 36, 6: 37, 6.5: 37.5, 7: 38, 7.5: 39, 8: 39.5, 8.5: 40, 9: 40.5, 9.5: 41.5, 10: 42, 10.5: 42.5, 11: 43.5, 11.5: 44, 12: 44.5 },
  },
  newbalance: {
    men: { 4: 36, 4.5: 37, 5: 37.5, 5.5: 38, 6: 38.5, 6.5: 39.5, 7: 40, 7.5: 40.5, 8: 41.5, 8.5: 42, 9: 42.5, 9.5: 43, 10: 44, 10.5: 44.5, 11: 45, 11.5: 45.5, 12: 46.5, 12.5: 47, 13: 47.5, 14: 49, 15: 50 },
    women: { 5: 35, 5.5: 36, 6: 36.5, 6.5: 37, 7: 37.5, 7.5: 38, 8: 39, 8.5: 40, 9: 40.5, 9.5: 41, 10: 41.5, 10.5: 42, 11: 42.5, 11.5: 43, 12: 44 },
  },
  puma: {
    men: { 4: 36, 4.5: 36.5, 5: 37, 5.5: 37.5, 6: 38, 6.5: 38.5, 7: 39, 7.5: 40, 8: 40.5, 8.5: 41, 9: 42, 9.5: 42.5, 10: 43, 10.5: 44, 11: 44.5, 11.5: 45, 12: 46, 12.5: 46.5, 13: 47, 14: 48.5, 15: 49.5 },
    women: { 5.5: 35.5, 6: 36, 6.5: 36.5, 7: 37, 7.5: 37.5, 8: 38, 8.5: 38.5, 9: 39, 9.5: 40, 10: 41, 10.5: 42, 11: 42.5 },
  },
  // Birkenstock is sized in whole EU numbers: EU 38 = women's US 7 = men's US 5.
  birkenstock: {
    men: Object.fromEntries([3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14].map((us) => [us, us + 33])),
    women: Object.fromEntries([4, 5, 6, 7, 8, 9, 10, 11, 12].map((us) => [us, us + 31])),
  },
};
// "42 2/3" → 42.667, 41.5 → 41.5
const euNum = (v) => {
  const m = String(v).match(/(\d+(?:\.\d+)?)(?:\s+(\d)\/(\d))?/);
  return m ? +m[1] + (m[2] ? +m[2] / +m[3] : 0) : NaN;
};
// Suffix letters are kept as typed in titles: W women's, Y youth/GS, C little kids/toddler.
function parseSize(raw) {
  const s = String(raw || '').trim();
  const n = euNum(s);
  const kid = /\d\s*c\b|\bc\s*\d|\btd\b/i.test(s);
  const youth = !kid && /\d\s*y\b|\by\s*\d|\bgs\b/i.test(s);
  return { n: isNaN(n) ? null : n, women: /w/i.test(s), youth, kid, suffix: /w/i.test(s) ? 'W' : youth ? 'Y' : kid ? 'C' : '' };
}
// Full picture for a typed size. Over 20 means it was typed in EU, so work out the US size from it.
function sizeInfo(raw, brandKey) {
  const { n, women, youth, kid, suffix } = parseSize(raw);
  const extra = { youth, kid, suffix };
  if (n == null) return { us: null, eu: '', women, fromEU: false, ...extra };
  // Little kids' sizes use a different chart; just carry the size through without EU.
  if (kid) return { us: n, eu: '', women, fromEU: false, ...extra };
  const charts = EU_CHARTS[brandKey] || { men: EU_MEN, women: EU_WOMEN };
  const chart = women ? charts.women : charts.men;
  if (n > 20) {
    let best = null;
    for (const [us, eu] of Object.entries(chart)) {
      const d = Math.abs(euNum(eu) - n);
      if (d < 0.4 && (!best || d < best.d)) best = { us: +us, d };
    }
    return { us: best ? best.us : null, eu: String(raw).replace(/^\D*|\s*[wy]\s*$/gi, '').trim(), women, fromEU: true, ...extra };
  }
  // Youth (GS) sizes sit on the same EU chart as men's for the numbers they share.
  return { us: n, eu: String(chart[n] ?? ''), women, fromEU: false, ...extra };
}
const euSize = (raw, brandKey) => sizeInfo(raw, brandKey).eu;

// Size as it appears in titles, keeping the type letter: "8W" women's, "6Y" youth, "10C" kids
// (whether typed "W8", "6y" or "6 Y").
const sizeText = (raw) => {
  const i = sizeInfo(raw, F?.brand || F?.detected);
  return i.us == null ? (i.fromEU ? '' : String(raw || '').trim()) : `${i.us}${i.suffix || ''}`;
};

const vars = () => ({
  eu: euSize(F.size, F.brand || F.detected),
  brand: brandName(),
  name: F.name,
  sku: F.sku,
  size: sizeText(F.size),
  colour: F.colour,
  // Per-section wording; blank falls back to the original text.
  afterpay: F.payment.afterpay ? (P().afterpayText ?? 'AfterPay Available').trim() : '',
  condition: F.condition === 'new' ? 'Brand new' : 'Used',
  ...shipVars(P().shipping),
});

function renderNew() {
  F ||= freshForm();
  if (!envAccounts().some((a) => a.id === F.accountId)) F.accountId = envAccounts()[0]?.id || null;
  const accs = envAccounts();
  view.innerHTML = `
  <h1>New listing</h1>
  <div class="top-picks">
    <div class="seg wrap-seg" id="profileSeg">
      ${profList(F.accountId).map((p) => `<button data-p="${esc(p.id)}" class="${p.id === F.profileId ? 'on' : ''}">${esc(p.name)}</button>`).join('')}
    </div>
    <div class="acct-pick">
      <span>List as</span>
      ${
        accs.length
          ? `<select id="accountSel">${accs.map((a) => `<option value="${a.id}" ${a.id === F.accountId ? 'selected' : ''}>${esc(a.nickname)}</option>`).join('')}</select>`
          : '<a href="#" data-goto="settings">Connect an account</a>'
      }
    </div>
  </div>
  <div class="grid">
    <div>
      <div class="card">
        <h2>Product</h2>
        <div class="sku-wrap" style="margin-bottom:12px">
          <input id="sku" placeholder="SKU or product name, e.g. DD1391-100 or Dunk Low Panda" value="${esc(F.query ?? F.sku)}" spellcheck="false" autofocus />
          <span id="brandBadge" class="badge other">Enter a SKU</span>
        </div>
        <div id="traceBox" style="margin-bottom:12px"></div>
        <div class="row">
          <label class="f">Brand
            <select id="brand">
              <option value="">Auto-detect</option>
              ${Object.entries(BRAND_LABELS).map(([k, v]) => `<option value="${k}" ${F.brand === k ? 'selected' : ''}>${v}</option>`).join('')}
            </select>
          </label>
          <label class="f" id="customBrandWrap">Brand name (used in title) <input id="customBrand" value="${esc(F.customBrand)}" placeholder="e.g. Jordan" /></label>
        </div>
        <div class="row">
          <label class="f">Model / name <input id="name" value="${esc(F.name)}" placeholder="e.g. Dunk Low Panda" /></label>
        </div>
        <div class="row">
          <label class="f"><span>Size (US) <span class="counter" id="euHint"></span></span><input id="size" value="${esc(F.size)}" placeholder="10, 8W or EU 44" /></label>
          <label class="f">Condition
            <select id="condition"><option value="new">Brand new</option><option value="used">Used</option></select>
          </label>
        </div>
      </div>

      <div class="card">
        <h2>Listing</h2>
        <label class="f" style="margin-bottom:12px">Title <span class="counter" id="titleCount"></span>
          <input id="title" value="${esc(F.title)}" />
        </label>
        <label class="f">Description <span class="counter" id="descCount"></span>
          <textarea id="desc" rows="8">${esc(F.desc)}</textarea>
        </label>
        <p class="hint">Title and description fill from your templates until you edit them. <a href="#" id="resetText">Reset to template</a></p>
      </div>

      <div class="card">
        <h2>Price</h2>
        <div class="seg" id="typeSeg" style="margin-bottom:14px">
          <button data-v="buynow">Buy Now only</button><button data-v="auction">Auction</button>
        </div>
        <div class="row" id="priceRow"></div>
        <div id="suggest"></div>
        <div class="row">
          <label class="f">Duration <select id="duration"></select></label>
        </div>
        <details class="extras" id="extrasBox" ${F.extras.promotionId > 1 || F.extras.customEnd || F.extras.subtitle ? 'open' : ''}>
          <summary>Extras <span id="extrasSum"></span></summary>
          <div id="extras"></div>
        </details>
      </div>

      <div class="card">
        <h2>Category & details</h2>
        <div id="catPicker"></div>
        <div id="attrs" style="margin-top:14px"></div>
      </div>
    </div>

    <div>
      <div class="card">
        <h2>Photos <span style="float:right;text-transform:none;letter-spacing:0" id="imgCount"></span></h2>
        <div class="images" id="images"></div>
        <div class="row" style="margin-top:12px">
          <input id="imgUrl" placeholder="Paste an image URL and press Enter" />
        </div>
        <input type="file" id="file" accept="image/*" multiple hidden />
        <p class="hint">First photo is the main one. Drag in your own photos too.</p>
      </div>
      <div class="card">
        <h2>Payment</h2>
        <div class="chips" id="payChips">
          ${payChipsHtml(F.payment, acctPay[F.accountId])}
        </div>
        <div class="seg" id="offerSeg" style="margin-top:12px">
          <button data-v="0" class="${F.allowOffers ? '' : 'on'}">No offers</button>
          <button data-v="1" class="${F.allowOffers ? 'on' : ''}">Allow offers</button>
        </div>
        <p class="hint">Allow offers turns on Trade Me's Make an Offer, so buyers can offer under your price.</p>
      </div>
      <div class="card">
        <h2>Shipping <a href="#" id="shipEdit" style="float:right;text-transform:none;letter-spacing:0;font-weight:400"></a></h2>
        <div id="shipBody"></div>
      </div>
      <div class="card cost-card">
        <h2>Costs</h2>
        <div id="costs"></div>
      </div>
    </div>
  </div>
  <div class="bar">
    <div class="msg" id="msg"></div>
    <button class="btn ghost" id="clear">Clear</button>
    <button class="btn" id="check">Check listing</button>
    <button class="btn primary" id="listBtn">List on Trade Me</button>
  </div>`;

  $('#condition').value = F.condition;
  // Switching section keeps the product + photos, re-applies that section's category and defaults.
  const switchSection = (id) => {
    if (id === F.profileId) return;
    Object.assign(F, profileFields(prof(id)));
    // Remember the choice quietly — no "Saved" toast for just switching tabs.
    S.lastProfileId = F.profileId;
    api.updateSettings({ lastProfileId: F.profileId }).catch(() => {});
    renderNew();
  };
  $$('#profileSeg button').forEach((b) => (b.onclick = () => ((F.autoWomenFrom = null), switchSection(b.dataset.p))));
  // A "W" in the size (8W, W8) switches to the women's section; taking it out switches back,
  // but only if it was the W that switched you there.
  const womenSection = () => profList(F.accountId).find((p) => p.id === 'womens') || profList(F.accountId).find((p) => /women/i.test(p.name));
  const sizeSection = () => {
    const ws = womenSection();
    if (!ws) return;
    const women = parseSize(F.size).women;
    let to = null;
    if (women && F.profileId !== ws.id) (F.autoWomenFrom = F.profileId), (to = ws.id);
    else if (!women && F.autoWomenFrom && F.profileId === ws.id) (to = F.autoWomenFrom), (F.autoWomenFrom = null);
    if (!to) return;
    const from = F.autoWomenFrom;
    const caret = $('#size').selectionStart;
    switchSection(to);
    F.autoWomenFrom = from; // profileFields doesn't touch it, but keep it explicit
    const el = $('#size');
    el.focus();
    el.setSelectionRange(caret, caret);
    toast(`Switched to ${prof(to).name}`);
  };
  const bind = (id, key, after) =>
    $('#' + id).addEventListener('input', (e) => {
      F[key] = e.target.value;
      after?.();
    });

  bind('name', 'name', () => ((F.nameAuto = false), refreshText()));
  bind('size', 'size', () => (sizeSection(), refreshText(), prefillAttrs()));
  // Typing in the brand box overrides auto-detect; clearing it hands control back.
  bind('customBrand', 'customBrand', () => ((F.brandTextDirty = F.customBrand.trim() !== ''), refreshText()));
  bind('condition', 'condition', refreshText);
  bind('duration', 'duration');
  // Switching account brings in that account's defaults for this section (product + photos stay).
  $('#accountSel')?.addEventListener('change', (e) => {
    F.accountId = e.target.value;
    Object.assign(F, profileFields(prof(F.profileId)), { afterpayForcedOff: false });
    renderNew();
  });
  $('#title').addEventListener('input', (e) => ((F.title = e.target.value), (F.titleDirty = true), counts()));
  $('#desc').addEventListener('input', (e) => ((F.desc = e.target.value), (F.descDirty = true), counts()));
  $('#resetText').addEventListener('click', (e) => (e.preventDefault(), (F.titleDirty = F.descDirty = false), refreshText()));
  $('#sku').addEventListener('input', debounce((e) => (newQuery(e.target.value), lookup()), 450));
  $('#sku').addEventListener('keydown', (e) => e.key === 'Enter' && (newQuery(e.target.value), lookup()));
  $('#brand').addEventListener('change', (e) => ((F.brand = e.target.value), (F.brandTextDirty = false), lookup()));
  $$('#offerSeg button').forEach(
    (b) =>
      (b.onclick = () => {
        F.allowOffers = b.dataset.v === '1';
        $$('#offerSeg button').forEach((x) => x.classList.toggle('on', x === b));
      }),
  );

  $$('#typeSeg button').forEach((b) =>
    b.addEventListener('click', () => {
      F.type = b.dataset.v;
      renderPrice();
      costsSoon();
    }),
  );
  // Any change in the form may change the fees; re-price shortly after typing stops.
  $('.grid').addEventListener('input', () => costsSoon());
  $('.grid').addEventListener('change', () => costsSoon());
  $('#payChips').addEventListener('change', (e) => {
    const k = e.target.dataset.pay;
    F.payment[k] = e.target.checked;
    e.target.closest('.chip').classList.toggle('on', e.target.checked);
    refreshText(); // {afterpay} follows the Afterpay chip
  });

  $('#imgUrl').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || !e.target.value.trim()) return;
    addRemoteImage(e.target.value.trim(), false);
    e.target.value = '';
  });
  $('#file').addEventListener('change', (e) => addFiles(e.target.files));

  $('#clear').addEventListener('click', () => {
    F = freshForm(F.profileId, F.accountId);
    renderNew();
  });
  $('#check').addEventListener('click', () => check());
  $('#listBtn').addEventListener('click', () => confirmList());

  categoryPicker($('#catPicker'), F.category, (cat) => {
    F.category = cat;
    loadAttrs();
  });

  $('#shipEdit').addEventListener('click', (e) => (e.preventDefault(), (F.shipEditing = !F.shipEditing), renderShipCard()));

  renderShipCard();
  renderPrice();
  renderBrand();
  renderTrace();
  renderImages();
  renderAttrs();
  refreshText();
  renderDurations();
  renderExtras();
  renderCosts();
  renderSuggest();
  applyAccountPayments();
  if (F.category.number && !F.catInfo) loadAttrs();
  else costsSoon();
}

/* durations + extras + costs */
// Duration options, marking ones that cost extra or aren't allowed in the category.
function durationOptions(current, info) {
  return DURATIONS.map((d) => {
    const allowed = !info?.durations?.length || info.durations.includes(d);
    const fee = d === 10 && info?.fees?.TenDays ? ` (+${money(info.fees.TenDays)})` : '';
    return `<option value="${d}" ${+current === d ? 'selected' : ''} ${allowed ? '' : 'disabled'}>${d} days${fee}${allowed ? '' : ' — not allowed'}</option>`;
  }).join('');
}
function renderDurations() {
  const sel = $('#duration');
  if (sel) sel.innerHTML = durationOptions(F.duration, F.catInfo);
}

// Shared extras controls (listing page + settings). `x` is the extras object being edited.
function extrasHtml(x, info, { perListing }) {
  const fees = info?.fees || {};
  const promos = info?.promotions?.length ? info.promotions : [{ id: 1, name: 'Basic', price: 0 }];
  return `
    <div class="row">
      <label class="f">Promotion
        <select data-x="promotionId">${promos.map((p) => `<option value="${p.id}" ${+x.promotionId === p.id ? 'selected' : ''}>${esc(p.name)} — ${money(p.price)}${p.recommended ? ' · recommended' : ''}</option>`).join('')}</select>
      </label>
      <label class="f"><span>Subtitle ${fees.Subtitle ? `<span class="fee">+${money(fees.Subtitle)}</span>` : ''}</span>
        <input data-x="subtitle" maxlength="50" value="${esc(x.subtitle)}" placeholder="Optional, shown under the title" />
      </label>
    </div>
    <div class="row">
      <label class="chip ${x.customEnd ? 'on' : ''}" style="align-self:end;justify-content:center">
        <input type="checkbox" data-x="customEnd" ${x.customEnd ? 'checked' : ''}/>Custom closing time ${fees.EndDate ? `<span class="fee">+${money(fees.EndDate)}</span>` : ''}
      </label>
      ${
        perListing
          ? `<label class="f">Closes at <input type="datetime-local" data-x="endAt" value="${esc(x.endAt)}" ${x.customEnd ? '' : 'disabled'} /></label>`
          : `<label class="f">Close at time of day <input type="time" data-x="endTime" value="${esc(x.endTime)}" ${x.customEnd ? '' : 'disabled'} /></label>`
      }
    </div>
    ${info ? '' : '<p class="hint">Pick a category to see its promotions and prices.</p>'}`;
}
function bindExtras(root, x, onChange) {
  $$('[data-x]', root).forEach((el) =>
    el.addEventListener(el.type === 'checkbox' ? 'change' : 'input', () => {
      const k = el.dataset.x;
      x[k] = el.type === 'checkbox' ? el.checked : k === 'promotionId' ? +el.value : el.value;
      if (k === 'customEnd') {
        el.closest('.chip').classList.toggle('on', el.checked);
        $$('[data-x="endAt"],[data-x="endTime"]', root).forEach((i) => (i.disabled = !el.checked));
      }
      onChange();
    }),
  );
}
const extrasSummary = (x, info) => {
  const promo = info?.promotions?.find((p) => p.id === +x.promotionId);
  return [promo && promo.id !== 1 && promo.name, x.subtitle && 'subtitle', x.customEnd && 'custom close'].filter(Boolean).join(' · ');
};
function renderExtras() {
  const box = $('#extras');
  if (!box) return;
  box.innerHTML = extrasHtml(F.extras, F.catInfo, { perListing: true });
  const sum = () => ($('#extrasSum').textContent = extrasSummary(F.extras, F.catInfo));
  bindExtras(box, F.extras, sum);
  sum();
}

let costSeq = 0;
const costsSoon = debounce(() => loadCosts(), 600);
async function loadCosts() {
  if (!F || current !== 'new') return;
  const seq = ++costSeq;
  if (!F.accountId || !F.category.number) return (F.costs = null), renderCosts();
  if (!(+(F.type === 'buynow' ? F.price : F.start) > 0)) return (F.costs = { needPrice: true }), renderCosts();
  F.costs = { loading: true, ...(F.costs?.items ? { items: F.costs.items, total: F.costs.total, successFee: F.costs.successFee } : {}) };
  renderCosts();
  const { listing } = buildListing();
  const salePrice = F.type === 'buynow' ? +F.price : +F.buyNow || +F.reserve || +F.start;
  try {
    const r = await api.fees({ accountId: F.accountId, listing, salePrice });
    if (seq !== costSeq) return;
    F.costs = { ...r, salePrice };
  } catch (err) {
    if (seq !== costSeq) return;
    F.costs = { error: err.message };
  }
  renderCosts();
}
// Payout calculator: what you take home per payment method ticked for this listing.
// Ping/Afterpay: buyer pays price + shipping (first option), processing % comes off that total.
// Cash: assumed paid on pickup, so no shipping and no processing fee.
// Success fee and listing fees come off every method.
function payoutHtml(c) {
  const price = c.salePrice;
  if (!(price > 0)) return '';
  const methods = Object.keys(PAY_LABELS).filter((k) => F.payment[k]);
  if (!methods.length) return '';
  const shipOpt = SH().shipping.find((s) => s.method && s.price !== '');
  const ship = +shipOpt?.price || 0;
  const tmFees = (c.successFee || 0) + (c.total || 0);
  const tiles = methods.map((k) => {
    const gross = k === 'cash' ? price : price + ship;
    const processing = PAY_FEES[k] ? Math.round(gross * PAY_FEES[k]) / 100 : 0;
    const net = gross - processing - tmFees;
    const lines = [
      [k === 'cash' ? 'Price' : 'Price + shipping', money(gross)],
      processing ? [`${PAY_LABELS[k]} ${PAY_FEES[k]}%`, '−' + money(processing)] : null,
      c.successFee ? ['Success fee', '−' + money(c.successFee)] : null,
      c.total ? ['Listing fees', '−' + money(c.total)] : null,
    ].filter(Boolean);
    return `<div class="payout">
      <span class="payout-label">${PAY_LABELS[k]}</span>
      <b>${money(Math.max(0, net))}</b>
      <div class="payout-lines">${lines.map(([a, b]) => `<div><span>${a}</span><span>${b}</span></div>`).join('')}</div>
    </div>`;
  });
  return `<h3 class="payout-title">You'd get</h3><div class="payouts">${tiles.join('')}</div>
    ${ship && methods.some((k) => k !== 'cash') ? `<p class="hint" style="margin-top:8px">Ping and Afterpay assume ${money(ship)} ${esc(shipOpt.method.toLowerCase())}. Cash assumes pickup.</p>` : ''}`;
}

function renderCosts() {
  const box = $('#costs');
  if (!box) return;
  const c = F.costs;
  if (!F.accountId) return (box.innerHTML = '<p class="hint" style="margin:0">Connect an account to see fees.</p>');
  if (!F.category.number) return (box.innerHTML = '<p class="hint" style="margin:0">Pick a category to see fees.</p>');
  if (c?.needPrice) return (box.innerHTML = '<p class="hint" style="margin:0">Enter a price to see fees and your payout.</p>');
  if (!c || (c.loading && !c.items)) return (box.innerHTML = '<p class="hint" style="margin:0">Checking fees…</p>');
  if (c.error) return (box.innerHTML = `<p class="hint" style="margin:0;color:var(--red)">${esc(c.error)}</p>`);
  box.innerHTML = `
    <div class="cost-total ${c.total ? 'paid' : 'free'}">
      <span>To list</span><b>${c.total ? money(c.total) : 'Free'}</b>
    </div>
    ${c.items.length ? `<div class="summary" style="margin-top:12px">${c.items.map((i) => `<div>${esc(i.label)} <b>${money(i.amount)}</b></div>`).join('')}</div>` : ''}
    ${c.successFee != null && c.salePrice ? `<p class="hint">If it sells for ${money(c.salePrice)}, Trade Me's success fee is <b style="color:var(--text)">${money(c.successFee)}</b>.</p>` : ''}
    ${payoutHtml(c)}
    ${c.insufficient ? '<p class="hint" style="color:var(--red)">Your Trade Me balance is too low to cover these fees.</p>' : ''}
    ${c.loading ? '<p class="hint">Updating…</p>' : ''}`;
}

function renderPrice() {
  $$('#typeSeg button').forEach((b) => b.classList.toggle('on', b.dataset.v === F.type));
  const field = (key, label, ph, req) =>
    `<label class="f"><span>${label}${req ? ' <span class="req">*</span>' : ''}</span><input type="number" min="0" step="0.01" data-k="${key}" value="${esc(F[key])}" placeholder="${ph}" /></label>`;
  $('#priceRow').innerHTML =
    F.type === 'buynow'
      ? field('price', 'Buy Now price ($)', '250', true) + field('quantity', 'Quantity', '1', true)
      : field('start', 'Start price ($)', '1', true) + field('buyNow', 'Buy Now ($)', 'optional') + field('reserve', 'Reserve ($)', 'optional');
  $$('#priceRow input').forEach((i) => i.addEventListener('input', (e) => ((F[e.target.dataset.k] = e.target.value), updateShipOnce())));
  updateShipOnce();
}
const updateShipOnce = () => {
  const el = $('#shipOnce');
  if (el) el.hidden = !(F.type === 'buynow' && +F.quantity > 1);
};

// Shipping card on the listing page: a summary, or an editor for this listing only.
const PICKUP_LABELS = { 1: 'Allowed', 2: 'Required', 3: 'No pickups' };
function renderShipCard() {
  const box = $('#shipBody');
  if (!box) return;
  const sh = SH();
  const multi = F.type === 'buynow' && +F.quantity > 1;
  $('#shipEdit').textContent = F.shipEditing ? 'Done' : 'Edit';
  if (!F.shipEditing) {
    box.innerHTML = `<div class="summary">
      ${sh.shipping.filter((s) => s.method).map((s) => `<div>${esc(s.method)} <b>${dollars(s.price)}</b></div>`).join('') || '<div>No shipping options set</div>'}
      <div>Pickup <b>${PICKUP_LABELS[sh.pickup]}</b></div>
      <div id="shipOnce" ${multi ? '' : 'hidden'}>Multiple bought
        <span class="seg seg-sm" id="lShipPer"><button data-v="order" class="${sh.shipPer !== 'item' ? 'on' : ''}">Once per order</button><button data-v="item" class="${sh.shipPer === 'item' ? 'on' : ''}">Per item</button></span>
      </div>
    </div>`;
    $$('#lShipPer button', box).forEach(
      (b) => (b.onclick = () => ((sh.shipPer = b.dataset.v), $$('#lShipPer button', box).forEach((x) => x.classList.toggle('on', x === b)))),
    );
    return;
  }
  box.innerHTML = `
    <div id="lShip">${sh.shipping
      .map(
        (s, i) => `<div class="ship-row"><input data-i="${i}" data-k="method" value="${esc(s.method)}" placeholder="Method e.g. Nationwide courier"/>
        <input data-i="${i}" data-k="price" type="number" step="0.01" value="${esc(s.price)}" placeholder="$"/>
        <button class="btn small danger" data-rm="${i}">×</button></div>`,
      )
      .join('')}</div>
    <button class="btn small" id="lAddShip">＋ Add option</button>
    <div class="row" style="margin-top:14px">
      <label class="f">Pickup <select id="lPickup">${Object.entries({ 1: 'Allow pickup', 2: 'Must pick up', 3: 'No pickups' })
        .map(([v, l]) => `<option value="${v}" ${+v === sh.pickup ? 'selected' : ''}>${l}</option>`)
        .join('')}</select></label>
    </div>
    <div id="shipOnce" ${multi ? '' : 'hidden'} style="margin-top:12px">
      <label class="f" style="margin-bottom:8px">When someone buys more than one</label>
      <div class="seg" id="lShipPer">
        <button data-v="order" class="${sh.shipPer !== 'item' ? 'on' : ''}">Once per order</button>
        <button data-v="item" class="${sh.shipPer === 'item' ? 'on' : ''}">Per item</button>
      </div>
    </div>
    <p class="hint">Changes apply to this listing only. <a href="#" id="lShipReset">Reset to defaults</a> · <a href="#" data-goto="defaults" data-subtab="shipping">Edit defaults</a></p>`;
  $$('#lShip input', box).forEach((el) => (el.oninput = () => ((sh.shipping[el.dataset.i][el.dataset.k] = el.value), costsSoon())));
  $$('#lShip [data-rm]', box).forEach((b) => (b.onclick = () => (sh.shipping.splice(+b.dataset.rm, 1), renderShipCard(), costsSoon())));
  $('#lAddShip').onclick = () => (sh.shipping.push({ method: '', price: '' }), renderShipCard());
  $('#lPickup').onchange = (e) => (sh.pickup = +e.target.value);
  $$('#lShipPer button', box).forEach(
    (b) => (b.onclick = () => ((sh.shipPer = b.dataset.v), $$('#lShipPer button', box).forEach((x) => x.classList.toggle('on', x === b)))),
  );
  $('#lShipReset').onclick = (e) => (e.preventDefault(), (F.ship = shipFrom(P())), renderShipCard(), costsSoon());
}

function renderBrand() {
  const b = F.brand || F.detected;
  const badge = $('#brandBadge');
  badge.className = 'badge ' + b;
  const found = F.brandFrom === 'trace' && F.traceBrand ? F.traceBrand : F.detected !== 'other' ? BRAND_LABELS[F.detected] : '';
  const ambiguous = !F.brandFrom && (F.candidates || []).length > 1;
  badge.textContent = !F.query
    ? 'SKU or name'
    : F.brand
      ? `${BRAND_LABELS[b]} (manual)`
      : found
        ? `${found}${F.brandFrom === 'pattern' ? ' SKU' : ''}`
        : ambiguous
          ? `${F.candidates.map((c) => BRAND_LABELS[c]).join(' or ')}?`
          : F.byName
            ? 'Name search'
            : 'Unknown brand';
  // The brand text box always shows; auto-detect fills it until you type in it.
  if (!F.brandTextDirty) {
    const auto = F.brand && F.brand !== 'other' ? BRAND_LABELS[F.brand] : found;
    F.customBrand = auto || (F.brand === 'other' ? F.customBrand : '');
    const input = $('#customBrand');
    if (input && document.activeElement !== input) input.value = F.customBrand;
  }
  // The Brand name box beside it always shows the detected brand, so the dropdown just says "Auto-detect".
  const auto = $('#brand option[value=""]');
  if (auto) auto.textContent = 'Auto-detect';
}

function refreshText() {
  if (!F.titleDirty) F.title = fill(P().titleTemplate, vars());
  // Descriptions have their own Afterpay wording (no brackets by default).
  if (!F.descDirty)
    F.desc = fill(P().descriptionTemplate, { ...vars(), afterpay: F.payment.afterpay ? (P().afterpayDescText ?? 'AfterPay Available').trim() : '' });
  if ($('#title') && document.activeElement !== $('#title')) $('#title').value = F.title;
  if ($('#desc') && document.activeElement !== $('#desc')) $('#desc').value = F.desc;
  counts();
  const eu = $('#euHint');
  if (eu) {
    const i = sizeInfo(F.size, F.brand || F.detected);
    const who = i.women ? "women's" : i.youth ? 'youth' : i.kid ? 'kids' : "men's";
    eu.textContent = i.fromEU ? (i.us != null ? `= US ${sizeText(F.size)} · ${who}` : 'EU size, no US match') : i.eu ? `EU ${i.eu} · ${who}` : i.kid ? 'kids · no EU' : '';
  }
  suggestSoon(); // product name/SKU/condition may have changed
}

/* suggested price from similar live listings */
const suggestSoon = debounce(() => loadSuggest(), 600);
async function loadSuggest() {
  if (!F || current !== 'new' || !F.accountId) return;
  const skuNow = String(F.sku || '').trim().toUpperCase();
  const key = [F.accountId, skuNow, F.name, F.condition].join('|');
  if (!skuNow && !F.name) return (F.suggest = null), renderSuggest();
  if (F.suggest?.key === key) return;
  F.suggest = { key, loading: true };
  renderSuggest();
  try {
    const r = await api.priceComps({ accountId: F.accountId, sku: skuNow, name: F.name, brand: brandName(), isNew: F.condition === 'new' });
    if (F?.suggest?.key !== key) return;
    F.suggest = { key, ...r };
  } catch (err) {
    if (F?.suggest?.key !== key) return;
    F.suggest = { key, error: err.message };
  }
  renderSuggest();
}
function renderSuggest() {
  const box = $('#suggest');
  if (!box) return;
  const s = F.suggest;
  if (!s) return (box.innerHTML = '');
  if (s.loading) return (box.innerHTML = '<p class="hint">Checking similar listings on Trade Me…</p>');
  if (s.error) return (box.innerHTML = `<p class="hint" style="color:var(--red)">${esc(s.error)}</p>`);
  if (!s.count) return (box.innerHTML = '<p class="hint">No similar brand-new listings on Trade Me to compare against.</p>');
  const suggested = s.suggested;
  const why =
    s.basis === 'exact'
      ? `$10 under the cheapest exact match (${money(s.exactLow)}) · ${s.exactCount} exact-SKU listing${s.exactCount > 1 ? 's' : ''}`
      : `Average of ${s.count} similar listing${s.count > 1 ? 's' : ''}${s.count > 1 ? ` (${money(s.low)}–${money(s.high)})` : ''} · no exact SKU match`;
  box.innerHTML = `
    <div class="suggest">
      <div class="suggest-main">
        <span>Suggested</span>
        <b>$${suggested}</b>
        <small>${why} · brand new, any size</small>
      </div>
      <div class="suggest-actions">
        <button class="btn small primary" data-use="${suggested}">Use $${suggested}</button>
      </div>
    </div>
    <details class="extras comps">
      <summary>Compared listings</summary>
      <div class="list">${s.comps
        .map(
          (c) => `<a href="#" class="comp" data-url="${esc(c.url)}">
            ${c.picture ? `<img src="${esc(c.picture)}" alt=""/>` : '<span class="rl-noimg"></span>'}
            <span class="comp-title">${esc(c.title)}${c.exact ? '' : ' <i class="pay-tag">name match</i>'}</span>
            ${c.size ? `<i class="size-tag">${esc(c.size)}</i>` : ''}
            <b>${money(c.price)}</b>
          </a>`,
        )
        .join('')}</div>
    </details>`;
  $$('[data-use]', box).forEach(
    (b) =>
      (b.onclick = () => {
        const key = F.type === 'buynow' ? 'price' : 'buyNow';
        F[key] = b.dataset.use;
        const input = $(`#priceRow [data-k="${key}"]`);
        if (input) input.value = b.dataset.use;
        costsSoon();
      }),
  );
  $$('.comp', box).forEach((a) => (a.onclick = (e) => (e.preventDefault(), api.openExternal(a.dataset.url))));
}
function counts() {
  const tc = $('#titleCount');
  if (!tc) return;
  overCount(tc, $('#title'), F.title.length, 80);
  overCount($('#descCount'), $('#desc'), F.desc.length, 2048);
}

// A different SKU/name in the box is a different product: drop what the last one filled in
// (Trace's name and colour, hand edits to title/description) so nothing stale carries over.
// A name you typed yourself is kept.
function newQuery(q) {
  if (q.trim() === String(F.query || '').trim()) return;
  F.query = q;
  F.brandTextDirty = false;
  F.titleDirty = F.descDirty = false;
  F.colour = '';
  if (F.nameAuto) {
    F.name = '';
    F.nameAuto = false;
    const el = $('#name');
    if (el) el.value = '';
  }
}

let lookupSeq = 0;
// How well a Trace result matches a typed product name: share of the words found in its title or
// StockX handle, plus a bonus for the exact phrase, minus a little for extra words.
// Trace already ranks well, so its order counts most; words found in the title/handle and an exact
// phrase match only nudge it.
function nameScore(query, p, rank) {
  const words = (s) => String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const q = words(query);
  const hay = words(`${p.title} ${String(p.handle || '').replace(/-/g, ' ')}`);
  const hits = q.filter((w) => hay.some((h) => h === w || h.startsWith(w))).length;
  const phrase = hay.join(' ').includes(q.join(' ')) ? 0.04 : 0;
  return hits / (q.length || 1) + phrase - rank * 0.05;
}
// Puma codes are typed as 39372801 but stored on Trace as 393728-01.
const traceQuery = (code) => (/^\d{8}$/.test(code) ? `${code.slice(0, 6)}-${code.slice(6)}` : code);

// The box takes a SKU or a product name. A space means a name: search Trace by name and rank by
// title/handle. Otherwise it's a code: guess the brand from its pattern (backup only) and put exact
// SKU matches first. Either way, the brand Trace returns wins.
async function lookup() {
  const seq = ++lookupSeq;
  const form = F; // a lookup that finishes after Clear/List another must not touch the new form
  const stale = () => seq !== lookupSeq || F !== form;
  const q = String(F.query || '').trim();
  F.byName = /\s/.test(q);
  F.trace = [];
  F.traceState = '';
  F.brandFrom = '';
  F.traceBrand = '';
  if (F.byName || !q) {
    F.sku = '';
    F.detected = 'other';
    F.candidates = [];
  } else {
    const r = await api.lookupSku(q, F.brand).catch(() => null);
    if (!r || stale()) return;
    F.sku = r.sku;
    F.candidates = r.candidates || [];
    // Ambiguous pattern (Hoka vs Birkenstock): don't guess, let Trace or you decide.
    F.detected = F.candidates.length === 1 ? F.candidates[0] : 'other';
    if (F.candidates.length === 1) F.brandFrom = 'pattern';
  }
  renderBrand();
  refreshText();

  if (S.trace.hasToken && q) {
    F.traceState = 'loading';
    renderTrace();
    try {
      const tq = traceQuery(F.sku);
      const results = (await api.traceSearch(F.byName ? q : tq)) || [];
      if (stale()) return;
      F.traceExact = true;
      if (F.byName) {
        F.trace = results.map((p, i) => ({ p, i, s: nameScore(q, p, i) })).sort((a, b) => b.s - a.s || a.i - b.i).map((x) => x.p);
      } else {
        // Exact SKU matches first (Trace SKUs can be "M990GL3/M990GY3"); a bare Hoka style number
        // (1127895) also matches its colourways (1127895-BBLC).
        const codes = [F.sku, tq];
        const exact = (p) => String(p.sku || '').toUpperCase().split(/[\/,\s]+/).some((c) => codes.some((k) => c === k || c.startsWith(k + '-')));
        const ex = results.filter(exact);
        F.trace = [...ex, ...results.filter((p) => !exact(p))];
        // No exact match: Trace's results are other products, so offer them without auto-filling.
        F.traceExact = ex.length > 0;
      }
      F.traceState = F.trace.length ? '' : 'none';
    } catch (err) {
      if (stale()) return;
      F.traceState = err.message;
    }
    F.traceIdx = F.trace.length && F.traceExact ? 0 : -1;
    renderTrace();
    if (F.traceIdx === 0) return applyTrace(0);
  }
  // No Trace match: clear the previous product's photo; add your own.
  setAutoImages([], seq);
  prefillAttrs();
}

// Swap out previously auto-fetched images, keep the user's own.
function setAutoImages(urls, seq = lookupSeq) {
  F.images = F.images.filter((i) => !i.auto);
  [...urls].reverse().forEach((u) => addRemoteImage(u, true, seq));
  renderImages();
}

const BRAND_KEYS = {
  nike: 'nike', jordan: 'nike', 'air jordan': 'nike', adidas: 'adidas', 'new balance': 'newbalance',
  hoka: 'hoka', 'hoka one one': 'hoka', puma: 'puma', asics: 'asics', birkenstock: 'birkenstock',
};
function applyTrace(i) {
  F.traceIdx = i;
  const p = F.trace[i];
  const key = BRAND_KEYS[String(p.brand || '').toLowerCase()];
  // Trace's brand beats the SKU-pattern guess.
  if (!F.brand && p.brand) {
    F.detected = key || 'other';
    // Keep Trace's specific name ("Jordan"), but tidy long forms ("Hoka One One" → "Hoka").
    F.traceBrand = key === 'hoka' ? 'Hoka' : p.brand;
    F.brandFrom = 'trace';
  }
  // Searched by name: the chosen product supplies the SKU.
  if (F.byName) F.sku = String(p.sku || '').toUpperCase().split(/[\/,\s]+/)[0] || '';
  const brandRe = new RegExp('^' + String(p.brand || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s+', 'i');
  F.name = p.title.replace(brandRe, '');
  F.nameAuto = true;
  F.colour = p.colour;
  $('#name') && ($('#name').value = F.name);
  renderBrand();
  renderTrace();
  refreshText();
  prefillAttrs();
  setAutoImages(p.image ? [p.image] : []);
}

function renderTrace() {
  const box = $('#traceBox');
  if (!box) return;
  const row = (p, i, cls = '') =>
    `<div class="tr-row ${cls}" data-i="${i}">
      <img src="${esc(p.thumb)}" alt="" loading="lazy"/>
      <span class="tr-title">${esc(p.title)}</span><span class="tr-sku">${esc(p.sku)}</span>
    </div>`;
  if (F.traceState === 'loading') return (box.innerHTML = '<div class="tr-pick"><div class="tr-row"><div class="spinner" style="width:16px;height:16px"></div><span class="tr-title" style="color:var(--muted)">Looking up on Trace…</span></div></div>');
  if (F.traceState === 'none') return (box.innerHTML = '<p class="hint">No Trace match — add the name and photos yourself.</p>');
  if (F.traceState) return (box.innerHTML = `<p class="hint" style="color:var(--red)">${esc(F.traceState)}</p>`);
  if (!F.trace.length) return (box.innerHTML = '');
  // traceIdx -1: a SKU with no exact match. Show the closest products to pick from, nothing filled in yet.
  const current =
    F.traceIdx >= 0
      ? row(F.trace[F.traceIdx], F.traceIdx, 'tr-current')
      : `<div class="tr-row tr-current"><span class="tr-title" style="color:var(--muted)">No exact match for ${esc(F.sku)} — pick a similar product</span></div>`;
  box.innerHTML = `
    <div class="tr-pick" id="trPick">
      ${current}
      <span class="tr-count">${F.traceIdx >= 0 ? `${F.traceIdx + 1}/` : ''}${F.trace.length} ▾</span>
      <div class="tr-list hidden">${F.trace.map((p, i) => row(p, i, i === F.traceIdx ? 'on' : '')).join('')}</div>
    </div>`;
  const list = $('.tr-list', box);
  $('.tr-current', box).onclick = $('.tr-count', box).onclick = (e) => {
    e.stopPropagation();
    list.classList.toggle('hidden');
    list.querySelector('.on')?.scrollIntoView({ block: 'nearest' });
  };
  list.onclick = (e) => {
    const r = e.target.closest('[data-i]');
    if (r) applyTrace(+r.dataset.i);
  };
}
document.addEventListener('click', (e) => !e.target.closest('#trPick') && $('.tr-list')?.classList.add('hidden'));

/* images */
let imgId = 0;
async function addRemoteImage(url, auto, seq) {
  const img = { id: ++imgId, auto, status: 'loading', label: auto ? 'auto' : 'url' };
  auto ? F.images.unshift(img) : F.images.push(img);
  renderImages();
  try {
    const raw = await api.fetchImage(url);
    img.src = await toJpeg(raw);
    img.status = 'ok';
  } catch (err) {
    img.status = 'error';
    img.error = err.message;
  }
  if (seq && seq !== lookupSeq) return;
  renderImages();
}
async function addFiles(files) {
  for (const f of files) {
    if (!f.type.startsWith('image/')) continue;
    const img = { id: ++imgId, status: 'loading', label: 'photo' };
    F.images.push(img);
    renderImages();
    const raw = await new Promise((res) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.readAsDataURL(f);
    });
    try {
      img.src = await toJpeg(raw);
      img.status = 'ok';
    } catch (err) {
      img.status = 'error';
      img.error = err.message;
    }
    renderImages();
  }
}
function renderImages() {
  const box = $('#images');
  if (!box) return;
  box.innerHTML =
    F.images
      .map((i, n) =>
        i.status === 'loading'
          ? `<div class="img loading"><div class="spinner"></div></div>`
          : i.status === 'error'
            ? `<div class="img error">${esc(i.error)}<button class="x" data-rm="${i.id}">×</button></div>`
            : `<div class="img" draggable="true" data-id="${i.id}"><img src="${i.src}" /><span class="tag">${n === 0 ? 'Main' : esc(i.label)}</span><button class="x" data-rm="${i.id}">×</button></div>`,
      )
      .join('') + `<div class="drop" id="drop">＋<br/>Add photos<br/><small>or drop here</small></div>`;
  const ok = F.images.filter((i) => i.status === 'ok').length;
  $('#imgCount').textContent = ok ? `${ok} ready` : '';

  $$('[data-rm]', box).forEach((b) =>
    b.addEventListener('click', () => {
      F.images = F.images.filter((i) => i.id !== +b.dataset.rm);
      renderImages();
    }),
  );
  const drop = $('#drop');
  drop.addEventListener('click', () => $('#file').click());
  // Drag files in, or drag tiles to reorder.
  box.ondragover = (e) => (e.preventDefault(), drop.classList.add('over'));
  box.ondragleave = () => drop.classList.remove('over');
  box.ondrop = (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    if (e.dataTransfer.files.length) return addFiles(e.dataTransfer.files);
    const from = +e.dataTransfer.getData('text/plain');
    const to = +e.target.closest('[data-id]')?.dataset.id;
    if (!from || !to || from === to) return;
    const a = F.images.findIndex((i) => i.id === from);
    const [moved] = F.images.splice(a, 1);
    F.images.splice(F.images.findIndex((i) => i.id === to), 0, moved);
    renderImages();
  };
  $$('[data-id]', box).forEach((t) => t.addEventListener('dragstart', (e) => e.dataTransfer.setData('text/plain', t.dataset.id)));
}

/* attributes */
async function loadAttrs() {
  if (!F.category.number) return;
  $('#attrs').innerHTML = '<p class="hint">Loading category details…</p>';
  try {
    const d = await api.categoryDetails(S.env, F.category.number);
    F.attrs = d.attributes;
    F.catInfo = { promotions: d.promotions, fees: d.fees, durations: d.durations };
    // Drop a promotion the new category doesn't offer.
    if (!d.promotions.some((p) => p.id === +F.extras.promotionId)) F.extras.promotionId = 1;
    renderDurations();
    renderExtras();
    costsSoon();
    F.attrValues = {};
    prefillAttrs(true);
  } catch (err) {
    F.attrs = [];
    $('#attrs').innerHTML = `<p class="hint" style="color:var(--red)">${esc(err.message)}</p>`;
    return;
  }
  renderAttrs();
}
// Best-effort: match size and brand into the category's own attribute options.
function prefillAttrs(silent) {
  // The size is taken as typed: only a "W" makes it women's, whatever section/category you're in.
  const usNow = sizeInfo(F.size, F.brand || F.detected).us;
  const want = { size: usNow != null ? String(usNow) : '', brand: brandName() };
  for (const a of F.attrs) {
    const key = /size/i.test(a.name + a.label) ? 'size' : /brand/i.test(a.name + a.label) ? 'brand' : null;
    if (!key || !want[key]) continue;
    const v = String(want[key]).toLowerCase();
    if (a.options.length) {
      const find = (v) =>
        a.options.find((o) => o.label.toLowerCase() === v || o.value.toLowerCase() === v) ||
        a.options.find((o) => new RegExp(`\\b(us\\s*)?${v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(o.label));
      // A typed brand Trade Me doesn't list (e.g. "Jordan") falls back to the detected brand ("Nike").
      const fallback = key === 'brand' && BRAND_LABELS[F.brand || F.detected];
      // Sizes past the ends of Trade Me's list land on its "5.5 & under" / "13 & over" style options.
      const edge = () => {
        const n = +want.size;
        return a.options.find((o) => {
          const m = o.label.match(/(\d+(?:\.\d+)?)\s*(?:&|and|or)?\s*(under|below|smaller|less|over|above|larger|bigger|more|\+)/i);
          return m && (/under|below|smaller|less/i.test(m[2]) ? n <= +m[1] : n >= +m[1]);
        });
      };
      const hit = find(v) || (key === 'size' ? edge() : fallback && fallback !== 'Other' ? find(fallback.toLowerCase()) : null);
      if (hit) F.attrValues[a.name] = hit.value;
    } else F.attrValues[a.name] = want[key];
  }
  if (!silent) renderAttrs();
}
function renderAttrs() {
  const box = $('#attrs');
  if (!box) return;
  if (!F.attrs.length) return (box.innerHTML = F.category.number ? '<p class="hint">This category has no extra details.</p>' : '');
  const sorted = [...F.attrs].sort((a, b) => b.required - a.required);
  box.innerHTML = `<div class="row">${sorted
    .map((a) => {
      const v = F.attrValues[a.name] ?? '';
      const lbl = `<span>${esc(a.label)}${a.required ? ' <span class="req">*</span>' : ''}</span>`;
      if (a.options.length)
        return `<label class="f">${lbl}<select data-attr="${esc(a.name)}"><option value="">—</option>${a.options.map((o) => `<option value="${esc(o.value)}" ${o.value === v ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select></label>`;
      if (a.type === 1)
        return `<label class="f">${lbl}<select data-attr="${esc(a.name)}"><option value="">—</option><option value="true" ${v === 'true' ? 'selected' : ''}>Yes</option><option value="false" ${v === 'false' ? 'selected' : ''}>No</option></select></label>`;
      return `<label class="f">${lbl}<input data-attr="${esc(a.name)}" value="${esc(v)}" /></label>`;
    })
    .join('')}</div>`;
  $$('[data-attr]', box).forEach((el) => el.addEventListener('input', (e) => (F.attrValues[el.dataset.attr] = e.target.value)));
}

/* build + submit */
function buildListing() {
  const errs = [];
  if (!F.accountId) errs.push('Connect a Trade Me account in Settings.');
  if (!F.category.number) errs.push('Pick a category.');
  if (!F.title.trim()) errs.push('Add a title.');
  if (F.title.trim().length > 80) errs.push(`Title is ${F.title.trim().length}/80 characters. Shorten it.`);
  if (F.desc.length > 2048) errs.push(`Description is ${F.desc.length}/2048 characters. Shorten it.`);
  if (!F.desc.trim()) errs.push('Add a description.');
  const shipErr = shipRefError(P());
  if (shipErr) errs.push(shipErr + ' Fix it under Defaults → Templates or Shipping.');
  const pay = [];
  if (F.payment.ping) pay.push(32);
  if (F.payment.afterpay) pay.push(64);
  if (F.payment.cash) pay.push(4);
  if (!pay.length) errs.push('Pick at least one payment method.');
  for (const a of F.attrs) if (a.required && !F.attrValues[a.name]) errs.push(`Fill in "${a.label}".`);

  const L = {
    Category: F.category.number,
    Title: F.title.trim(),
    Description: [F.desc.replace(/\r?\n/g, '\r\n')],
    Duration: +F.duration,
    Pickup: +SH().pickup,
    IsBrandNew: F.condition === 'new',
    ShippingOptions: SH().shipping.filter((s) => s.method && s.price !== '').map((s) => ({ Type: 4, Price: +s.price, Method: s.method })),
    PaymentMethods: pay,
    IsCounterOffersAllowed: !!F.allowOffers,
    Attributes: Object.entries(F.attrValues)
      .filter(([, v]) => v !== '' && v != null)
      .map(([Name, Value]) => ({ Name, Value: String(Value) })),
  };
  if (F.sku) L.SKU = L.ExternalReferenceId = F.sku.trim().toUpperCase().slice(0, 50);

  if (F.type === 'buynow') {
    if (!(+F.price > 0)) errs.push('Set a Buy Now price.');
    L.StartPrice = L.BuyNowPrice = +F.price;
    L.Quantity = Math.max(1, +F.quantity || 1);
    // Buyers taking several pay shipping once per order, not once per item.
    if (L.Quantity > 1) L.IsFlatShippingCharge = SH().shipPer !== 'item';
  } else {
    if (!(+F.start > 0)) errs.push('Set a start price.');
    L.StartPrice = +F.start;
    if (+F.buyNow) L.BuyNowPrice = +F.buyNow;
    if (+F.reserve) L.ReservePrice = +F.reserve;
  }

  // Paid extras
  const x = F.extras;
  if (+x.promotionId > 1) L.PromotionId = +x.promotionId;
  if (x.subtitle.trim()) L.Subtitle = x.subtitle.trim().slice(0, 50);
  if (x.customEnd) {
    const end = new Date(x.endAt);
    if (!(end > Date.now())) errs.push('Pick a closing time in the future.');
    else {
      L.Duration = 0;
      L.EndDateTime = end.toISOString();
    }
  }
  return { listing: L, errs };
}

function setMsg(text, kind = '') {
  const m = $('#msg');
  if (!m) return;
  m.textContent = text;
  m.className = 'msg ' + kind;
}

async function check(quiet) {
  const { listing, errs } = buildListing();
  if (errs.length) return setMsg(errs.join('\n'), 'err'), false;
  setMsg('Checking with Trade Me…');
  try {
    await api.validate({ accountId: F.accountId, listing });
    if (!quiet) setMsg('Looks good — Trade Me accepted the listing details.', 'ok');
    return listing;
  } catch (err) {
    setMsg(err.message, 'err');
    return false;
  }
}

async function confirmList() {
  if (F.images.some((i) => i.status === 'loading')) return setMsg('Wait for photos to finish loading.', 'err');
  const listing = await check(true);
  if (!listing) return;
  setMsg('');
  const photos = F.images.filter((i) => i.status === 'ok');
  const acc = S.accounts.find((a) => a.id === F.accountId);
  const price = F.type === 'buynow' ? `$${(+F.price).toFixed(2)} Buy Now` : `$${(+F.start).toFixed(2)} start`;
  // Re-price exactly what's about to be listed.
  setMsg('Checking fees…');
  const salePrice = F.type === 'buynow' ? +F.price : +F.buyNow || +F.reserve || +F.start;
  const fees = await api.fees({ accountId: F.accountId, listing, salePrice }).catch((err) => ({ error: err.message }));
  setMsg('');
  const feeRows = fees.error
    ? `<div>Listing fees <b style="color:var(--red)">Couldn't check</b></div>`
    : `${fees.items.map((i) => `<div>${esc(i.label)} <b>${money(i.amount)}</b></div>`).join('')}
       <div class="cost-line">Charged now <b class="${fees.total ? 'paid' : 'free'}">${fees.total ? money(fees.total) : 'Free'}</b></div>
       ${fees.successFee != null && salePrice ? `<div>Success fee if it sells <b>${money(fees.successFee)}</b></div>` : ''}`;
  const card = modal(`
    <h3>List this on Trade Me?</h3>
    <div class="hero">${photos[0] ? `<img src="${photos[0].src}" />` : ''}<div><b>${esc(listing.Title)}</b><br/><small style="color:var(--muted)">${esc(F.category.path)}</small></div></div>
    <div class="summary">
      <div>Account <b>${esc(acc?.nickname)}${S.env === 'sandbox' ? ' (sandbox)' : ''}</b></div>
      <div>Price <b>${price}${F.type === 'buynow' && +F.quantity > 1 ? ` × ${F.quantity}` : ''}</b></div>
      ${listing.Quantity > 1 ? `<div>Multiple bought <b>${listing.IsFlatShippingCharge ? 'Shipping charged once per order' : 'Shipping charged per item'}</b></div>` : ''}
      <div>${F.extras.customEnd ? 'Closes' : 'Duration'} <b>${F.extras.customEnd ? new Date(F.extras.endAt).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : F.duration + ' days'}</b></div>
      <div>Photos <b>${photos.length}</b></div>
      <div>Offers <b>${F.allowOffers ? 'Allowed' : 'Off'}</b></div>
      <div>Payment <b>${['ping', 'afterpay', 'cash'].filter((k) => F.payment[k]).map((k) => ({ ping: 'Ping', afterpay: 'Afterpay', cash: 'Cash' })[k]).join(', ')}</b></div>
      <div>Shipping <b>${listing.ShippingOptions.map((s) => `$${s.Price} ${esc(s.Method)}`).join(' · ')}</b></div>
    </div>
    <div class="summary cost-box">${feeRows}</div>
    <p class="hint" id="prog"></p>
    <div class="actions"><button class="btn ghost" id="cancel">Cancel</button><button class="btn primary" id="go">${fees.total ? `List now · ${money(fees.total)}` : 'List now'}</button></div>`);
  $('#cancel', card).onclick = closeModal;
  $('#go', card).onclick = async () => {
    $('#go', card).disabled = $('#cancel', card).disabled = true;
    try {
      const r = await api.submit({
        accountId: F.accountId,
        listing,
        photos: photos.map((p, n) => ({ base64: p.src.split(',')[1], fileName: `${F.sku || 'photo'}-${n + 1}.jpg` })),
        meta: { thumb: photos[0] ? await toJpeg(photos[0].src, 160) : null },
      });
      S = await api.getSettings();
      dataChanged('live');
      // Listed: clear the form straight away (same section, account, category and listing type)
      // so the page never shows a product that's already live.
      const keep = { accountId: F.accountId, category: F.category, attrs: F.attrs, catInfo: F.catInfo, type: F.type };
      F = { ...freshForm(F.profileId, F.accountId), ...keep };
      if (current === 'new') renderNew();
      modal(`
        <h3>Listed ✓</h3>
        <p>Listing <b>#${r.listingId}</b> is live.</p>
        <div class="actions"><button class="btn ghost" id="close">Close</button><button class="btn" id="open">Open on Trade Me</button><button class="btn primary" id="next">List another</button></div>`);
      $('#close').onclick = closeModal;
      $('#open').onclick = () => api.openExternal(r.url);
      $('#next').onclick = () => (closeModal(), $('#sku')?.focus());
    } catch (err) {
      $('#prog', card).textContent = err.message;
      $('#prog', card).style.color = 'var(--red)';
      $('#go', card).disabled = $('#cancel', card).disabled = false;
    }
  };
}
api.onProgress((m) => {
  const p = $('#prog');
  if (p) p.textContent = m;
});

/* ---------- RELIST ---------- */
const R = { days: 90, accountId: null, items: null, selected: new Set(), results: {}, loading: false, error: '', running: false };
const ago = (iso) => {
  const d = Math.round((Date.now() - new Date(iso)) / 86400000);
  return d <= 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`;
};

function renderRelist() {
  const accs = envAccounts();
  if (!accs.some((a) => a.id === R.accountId)) {
    R.accountId = S.defaultAccountId && accs.some((a) => a.id === S.defaultAccountId) ? S.defaultAccountId : accs[0]?.id || null;
    R.items = null;
  }
  const cutoff = Date.now() - R.days * 86400000;
  const archive = S.relistArchive || {};
  const acc = accs.find((a) => a.id === R.accountId);
  // Archived listings for this account, newest archive first (kept even after Trade Me drops them).
  const archived = Object.values(archive)
    .filter((x) => acc && x.env === acc.env && +x.memberId === +acc.memberId)
    .sort((a, b) => (b.archivedAt || '').localeCompare(a.archivedAt || ''));
  const arch = R.showArchived;
  const items = arch ? archived : (R.items || []).filter((i) => !archive[i.listingId] && (!i.endDate || new Date(i.endDate) >= cutoff));
  const pending = arch ? items : items.filter((i) => !R.results[i.listingId]?.ok);
  const sel = pending.filter((i) => R.selected.has(i.listingId));
  view.innerHTML = `
    <h1>Relist</h1>
    <div style="display:flex;gap:10px;align-items:center;margin-bottom:14px;flex-wrap:wrap">
      <select id="rlAcc" style="width:auto;min-width:200px">${accs.map((a) => `<option value="${a.id}" ${a.id === R.accountId ? 'selected' : ''}>${esc(a.nickname)}</option>`).join('') || '<option>No accounts</option>'}</select>
      <div class="seg" id="rlView"><button data-v="0" class="${arch ? '' : 'on'}">Unsold</button><button data-v="1" class="${arch ? 'on' : ''}">Archived (${archived.length})</button></div>
      <button class="btn" id="rlRefresh" ${R.loading || !R.accountId || arch ? 'disabled' : ''}>${R.loading ? 'Loading…' : 'Refresh'}</button>
      <span class="hint" style="margin:0">${arch ? `${items.length} archived · ${sel.length} selected` : R.items ? `${items.length} unsold · ${sel.length} selected` : ''}</span>
      <select id="rlDays" style="width:auto;margin-left:auto" title="Trade Me only keeps unsold listings for 45 days" ${arch ? 'hidden' : ''}>
        ${[7, 14, 30, 60, 90].map((d) => `<option value="${d}" ${R.days === d ? 'selected' : ''}>Ended in last ${d} days</option>`).join('')}
      </select>
    </div>
    ${
      R.error && !arch
        ? `<div class="empty" style="color:var(--red)">${esc(R.error)}</div>`
        : !R.items && !arch
          ? `<div class="empty">${R.loading ? '<div class="spinner" style="margin:auto"></div>' : 'Pick an account and hit Refresh.'}</div>`
          : !items.length
            ? `<div class="empty">${arch ? 'Nothing archived. Archive listings you never want relisted.' : 'Nothing to relist. Everything has sold or been relisted.'}</div>`
            : `<div class="rl-table">
                <label class="rl-row rl-head"><input type="checkbox" id="rlAll" ${pending.length && sel.length === pending.length ? 'checked' : ''}/><span></span><span>Listing</span><span>Price</span><span>Ended</span><span>Status</span></label>
                ${items
                  .map((i) => {
                    const res = R.results[i.listingId];
                    const status = res
                      ? res.ok
                        ? `<a href="#" data-url="${esc(res.url)}" class="rl-ok">Relisted #${res.newId}</a>`
                        : `<span class="rl-err" title="${esc(res.error)}">${esc(res.error)}</span>`
                      : R.running && R.selected.has(i.listingId)
                        ? '<span class="rl-wait">Queued</span>'
                        : '';
                    return `<label class="rl-row ${res?.ok ? 'done' : ''}">
                      <input type="checkbox" data-id="${i.listingId}" ${res?.ok ? 'disabled' : R.selected.has(i.listingId) ? 'checked' : ''}/>
                      ${i.picture ? `<img src="${esc(i.picture)}" alt=""/>` : '<span class="rl-noimg"></span>'}
                      <span class="rl-title"><b>${esc(i.title)}</b><a href="#" data-url="${esc(i.url)}">#${i.listingId}</a></span>
                      <span class="rl-num">$${Number(i.price || 0).toFixed(2)}</span>
                      <span class="rl-muted">${i.endDate ? ago(i.endDate) : ''}</span>
                      <span class="rl-status" id="st-${i.listingId}">${arch ? `<span class="rl-muted">Archived ${ago(i.archivedAt)}</span>` : status}</span>
                    </label>`;
                  })
                  .join('')}
              </div>`
    }
    <div class="bar">
      <div class="msg" id="rlMsg"></div>
      ${
        arch
          ? `<button class="btn" id="rlUnarch" ${sel.length ? '' : 'disabled'}>Unarchive selected (${sel.length})</button>`
          : `<button class="btn ghost" id="rlArch" ${sel.length && !R.running ? '' : 'disabled'}>Archive selected (${sel.length})</button>
      <button class="btn" id="rlSel" ${sel.length && !R.running ? '' : 'disabled'}>Relist selected (${sel.length})</button>
      <button class="btn primary" id="rlAllBtn" ${pending.length && !R.running ? '' : 'disabled'}>Relist all (${pending.length})</button>`
      }
    </div>`;

  $$('#rlView button').forEach(
    (b) =>
      (b.onclick = () => {
        R.showArchived = b.dataset.v === '1';
        R.selected.clear();
        renderRelist();
        if (!R.showArchived && !R.items && !R.loading && R.accountId) loadRelist();
      }),
  );
  const setArchived = async (rows, on) => {
    try {
      S = await api.relistArchive({ accountId: R.accountId, items: rows, archived: on });
      rows.forEach((i) => R.selected.delete(i.listingId));
      toast(`${rows.length} ${on ? 'archived' : 'unarchived'}`);
    } catch (err) {
      toast(err.message);
    }
    renderRelist();
  };
  $('#rlArch')?.addEventListener('click', () => setArchived(sel, true));
  $('#rlUnarch')?.addEventListener('click', () => setArchived(sel, false));

  $('#rlAcc').onchange = (e) => {
    R.accountId = e.target.value;
    R.items = null;
    R.selected.clear();
    R.results = {};
    loadRelist();
  };
  $('#rlRefresh').onclick = () => loadRelist();
  // Narrowing the range drops hidden rows from the selection so "Relist selected" matches what you see.
  $('#rlDays').onchange = (e) => {
    R.days = +e.target.value;
    const c = Date.now() - R.days * 86400000;
    (R.items || []).forEach((i) => i.endDate && new Date(i.endDate) < c && R.selected.delete(i.listingId));
    renderRelist();
  };
  $('#rlAll')?.addEventListener('change', (e) => {
    pending.forEach((i) => (e.target.checked ? R.selected.add(i.listingId) : R.selected.delete(i.listingId)));
    renderRelist();
  });
  $$('.rl-row input[data-id]').forEach(
    (c) =>
      (c.onchange = () => {
        c.checked ? R.selected.add(+c.dataset.id) : R.selected.delete(+c.dataset.id);
        renderRelist();
      }),
  );
  $$('[data-url]').forEach((a) => (a.onclick = (e) => (e.preventDefault(), e.stopPropagation(), api.openExternal(a.dataset.url))));
  $('#rlSel')?.addEventListener('click', () => confirmRelist(sel));
  $('#rlAllBtn')?.addEventListener('click', () => confirmRelist(pending));
  if (!R.items && !R.loading && !R.error && R.accountId) loadRelist();
}

async function loadRelist() {
  if (!R.accountId) return;
  R.loading = true;
  R.error = '';
  renderRelist();
  try {
    R.items = await api.relistList(R.accountId);
    R.results = {};
    R.selected = new Set();
  } catch (err) {
    R.error = err.message;
  }
  R.loading = false;
  if (current === 'relist') renderRelist();
}

function confirmRelist(list) {
  const acc = S.accounts.find((a) => a.id === R.accountId);
  const card = modal(`
    <h3>Relist ${list.length} listing${list.length > 1 ? 's' : ''}?</h3>
    <div class="summary">
      <div>Account <b>${esc(acc?.nickname)}</b></div>
      <div>Listings <b>${list.length}</b></div>
    </div>
    <p class="hint">Each one goes live again with its original details. Trade Me's normal listing fees apply.</p>
    <div class="actions"><button class="btn ghost" id="cancel">Cancel</button><button class="btn primary" id="go">Relist ${list.length}</button></div>`);
  $('#cancel', card).onclick = closeModal;
  $('#go', card).onclick = async () => {
    closeModal();
    R.running = true;
    R.selected = new Set(list.map((i) => i.listingId));
    renderRelist();
    try {
      const results = await api.relistRun({ accountId: R.accountId, ids: list.map((i) => i.listingId), meta: Object.fromEntries(list.map((i) => [i.listingId, { title: i.title, price: i.price, picture: i.picture }])) });
      results.forEach((r) => (R.results[r.id] = r));
      const ok = results.filter((r) => r.ok).length;
      toast(`${ok} relisted${results.length - ok ? `, ${results.length - ok} failed` : ''}`);
    } catch (err) {
      toast(err.message);
    }
    R.running = false;
    R.selected = new Set([...R.selected].filter((id) => !R.results[id]?.ok));
    if (current === 'relist') renderRelist();
    // Relist results stay on screen; the relist list itself refreshes next time you open it.
    if (Object.values(R.results).some((r) => r.ok)) (STALE.add('relist'), dataChanged('live'));
  };
}

api.onRelistProgress(({ id, n, total, result }) => {
  const m = $('#rlMsg');
  if (m) m.textContent = result ? '' : `Relisting ${n} of ${total}…`;
  if (result) R.results[id] = result;
  const st = $('#st-' + id);
  if (st)
    st.innerHTML = result
      ? result.ok
        ? `<span class="rl-ok">Relisted #${result.newId}</span>`
        : `<span class="rl-err" title="${esc(result.error)}">${esc(result.error)}</span>`
      : '<span class="rl-wait">Relisting…</span>';
});

/* ---------- LIVE ---------- */
const LIVE = { scope: null, items: null, loading: false, error: '', q: '', selected: new Set(), status: {}, running: false };
// Account pickers start on your default account (else "All accounts"), and fall back the same way
// if the picked account is gone or belongs to the other environment.
const pickScope = (scope) => {
  const accs = envAccounts();
  if (scope === 'all' || accs.some((a) => a.id === scope)) return scope;
  return accs.some((a) => a.id === S.defaultAccountId) ? S.defaultAccountId : 'all';
};
const endsIn = (iso) => {
  const ms = new Date(iso) - Date.now();
  if (ms <= 0) return 'ending';
  const h = Math.floor(ms / 3600000);
  return h < 24 ? `${h}h ${Math.floor((ms % 3600000) / 60000)}m` : `${Math.floor(h / 24)}d ${h % 24}h`;
};

async function loadLive() {
  LIVE.scope = pickScope(LIVE.scope);
  const ids = LIVE.scope === 'all' ? envAccounts().map((a) => a.id) : [LIVE.scope];
  if (!ids.length) return;
  LIVE.loading = true;
  LIVE.error = '';
  if (current === 'live') renderLive();
  try {
    LIVE.items = await api.live(ids);
    const stillLive = new Set(LIVE.items.map((i) => i.listingId));
    LIVE.selected = new Set([...LIVE.selected].filter((id) => stillLive.has(id)));
  } catch (err) {
    LIVE.error = err.message;
  }
  LIVE.loading = false;
  if (current === 'live') renderLive();
}

function renderLive() {
  const accs = envAccounts();
  LIVE.scope = pickScope(LIVE.scope);
  const fromApp = new Set((S.history || []).filter((h) => !h.action || h.action === 'listed' || h.action === 'relisted').map((h) => +h.listingId));
  const q = LIVE.q.trim().toLowerCase();
  const items = (LIVE.items || []).filter((i) => !q || `${i.title} ${i.sku} ${i.listingId}`.toLowerCase().includes(q));
  const showAcc = LIVE.scope === 'all' && accs.length > 1;
  const total = items.reduce((s, i) => s + (i.buyNow || i.maxBid || i.start) * (i.quantity || 1), 0);
  const sel = items.filter((i) => LIVE.selected.has(i.listingId));
  const st = (id) => {
    const x = LIVE.status[id];
    return x ? `<span class="${x.ok ? 'rl-ok' : x.err ? 'rl-err' : 'rl-wait'}" title="${esc(x.text)}">${esc(x.text)}</span>` : '';
  };

  view.innerHTML = `
    <h1>Live</h1>
    <div style="display:flex;gap:10px;align-items:center;margin-bottom:16px;flex-wrap:wrap">
      <select id="liveAcc" style="width:auto;min-width:200px">
        <option value="all" ${LIVE.scope === 'all' ? 'selected' : ''}>All accounts</option>
        ${accs.map((a) => `<option value="${a.id}" ${a.id === LIVE.scope ? 'selected' : ''}>${esc(a.nickname)}</option>`).join('')}
      </select>
      <button class="btn" id="liveRefresh" ${LIVE.loading ? 'disabled' : ''}>${LIVE.loading ? 'Loading…' : 'Refresh'}</button>
      <input id="liveQ" placeholder="Filter by title, SKU or #" value="${esc(LIVE.q)}" style="width:auto;min-width:220px;margin-left:auto" />
    </div>
    ${
      LIVE.error
        ? `<div class="empty" style="color:var(--red)">${esc(LIVE.error)}</div>`
        : !LIVE.items
          ? `<div class="empty">${accs.length ? '<div class="spinner" style="margin:auto"></div>' : 'Connect an account in Settings.'}</div>`
          : `<div class="sold-stats five">
              <div><span>Live listings</span><b>${items.length}</b></div>
              <div><span>From this app</span><b>${items.filter((i) => fromApp.has(+i.listingId)).length}</b></div>
              <div><span>Views</span><b>${items.reduce((s, i) => s + (i.views || 0), 0)}</b></div>
              <div><span>Watching</span><b>${items.reduce((s, i) => s + (i.watchers || 0), 0)}</b></div>
              <div><span>Total asking</span><b>${dollars(total)}</b></div>
            </div>
            ${
              !items.length
                ? `<div class="empty">${q ? 'Nothing matches that filter.' : 'Nothing for sale right now.'}</div>`
                : `<div class="rl-table sold-table live-table ${showAcc ? 'with-acc' : ''}">
                    <div class="sold-row rl-head"><input type="checkbox" id="liveAll" ${sel.length && sel.length === items.length ? 'checked' : ''} ${LIVE.running ? 'disabled' : ''}/><span></span><span>Listing</span>${showAcc ? '<span>Account</span>' : ''}<span>Source</span><span>Buy Now</span><span>Bids</span><span title="Views">Views</span><span title="Watchlists (bidders + watchers)">Watching</span><span>Ends in</span><span></span></div>
                    ${items
                      .map(
                        (i) => `<div class="sold-row">
                          <input type="checkbox" data-sel="${i.listingId}" ${LIVE.selected.has(i.listingId) ? 'checked' : ''} ${LIVE.running ? 'disabled' : ''}/>
                          ${i.picture ? `<img src="${esc(i.picture)}" alt=""/>` : '<span class="rl-noimg"></span>'}
                          <span class="rl-title"><b>${esc(i.title)}</b><a href="#" data-url="${esc(i.url)}">#${i.listingId}${i.sku ? ' · ' + esc(i.sku) : ''}${i.quantity > 1 ? ` · ${i.quantity} left` : ''}</a>${st(i.listingId)}</span>
                          ${showAcc ? `<span class="rl-muted">${esc(i.nickname)}</span>` : ''}
                          <span>${fromApp.has(+i.listingId) ? '<i class="pay-tag">App</i>' : '<i class="pay-tag" style="opacity:.6">Trade Me</i>'}</span>
                          <span class="rl-num">${i.buyNow ? dollars(i.buyNow) : '—'}</span>
                          <span class="rl-muted">${i.bids ? `${i.bids} · ${dollars(i.maxBid)}` : i.buyNow && !i.start ? '' : `from ${dollars(i.start)}`}</span>
                          <span class="rl-num ${i.views ? '' : 'rl-muted'}">${i.views ?? 0}</span>
                          <span class="rl-num ${i.watchers ? 'watch-num' : 'rl-muted'}">${i.watchers ?? 0}</span>
                          <span class="rl-muted">${i.endDate ? endsIn(i.endDate) : ''}</span>
                          <button class="dots-btn" data-menu="${i.listingId}" title="More">⋯</button>
                        </div>`,
                      )
                      .join('')}
                  </div>
                  <p class="hint">Listings on Trade Me's newer platform may not come through the API, same as Sold.</p>
                  <div class="bar">
                    <div class="msg" id="liveMsg">${sel.length ? `${sel.length} selected` : 'Tick listings to change them together.'}</div>
                    <button class="btn primary" id="dropBtn" ${sel.length && !LIVE.running ? '' : 'disabled'}>${LIVE.running ? 'Updating…' : `Drop price (${sel.length})`}</button>
                  </div>`
            }`
    }`;

  $('#liveAcc').onchange = (e) => ((LIVE.scope = e.target.value), loadLive());
  $('#liveRefresh').onclick = () => loadLive();
  $('#liveQ').oninput = debounce((e) => {
    LIVE.q = e.target.value;
    renderLive();
    const el = $('#liveQ');
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, 200);
  $$('[data-url]').forEach((a) => (a.onclick = (e) => (e.preventDefault(), api.openExternal(a.dataset.url))));
  $$('[data-menu]').forEach((b) => (b.onclick = (e) => (e.stopPropagation(), liveMenu(b, LIVE.items.find((i) => i.listingId === +b.dataset.menu)))));
  $('#liveAll')?.addEventListener('change', (e) => {
    items.forEach((i) => (e.target.checked ? LIVE.selected.add(i.listingId) : LIVE.selected.delete(i.listingId)));
    renderLive();
  });
  $$('[data-sel]').forEach(
    (c) =>
      (c.onchange = () => {
        c.checked ? LIVE.selected.add(+c.dataset.sel) : LIVE.selected.delete(+c.dataset.sel);
        renderLive();
      }),
  );
  $('#dropBtn')?.addEventListener('click', () => dropPrices(sel));
  if (!LIVE.items && !LIVE.loading && !LIVE.error && accs.length) loadLive();
}

// The price a drop applies to: Buy Now when there is one, else the auction start price.
const dropField = (i) => (i.buyNow ? 'BuyNowPrice' : 'StartPrice');
const currentPrice = (i) => i.buyNow || i.start || 0;
// Drop by pct. "none" keeps cents; the others give whole dollars (ending in 0: 185 → 180 down / 190 up).
function droppedPrice(price, pct, round) {
  const p = price * (1 - pct / 100);
  if (round === 'down') return Math.floor(p / 10) * 10;
  if (round === 'up') return Math.ceil(p / 10) * 10;
  if (round === 'nearest') return Math.round(p);
  return Math.round(p * 100) / 100; // none: exact, cents kept
}

function dropPrices(list) {
  let pct = 10;
  let round = 'none';
  const card = modal(`
    <h3>Drop price</h3>
    <p class="hint" style="margin-top:-6px">${list.length} listing${list.length > 1 ? 's' : ''} selected</p>
    <div class="dp-field">
      <span class="dp-label">Drop by</span>
      <div class="dp-pct">
        <div class="seg" id="dpQuick">${[5, 10, 15, 20, 25].map((n) => `<button data-p="${n}" class="${n === pct ? 'on' : ''}">${n}%</button>`).join('')}</div>
        <div class="dp-custom"><input id="dpPct" type="number" min="1" max="90" step="0.5" value="${pct}" /><span>%</span></div>
      </div>
    </div>
    <div class="dp-field">
      <span class="dp-label">Rounding</span>
      <div class="seg dp-round" id="dpRound">
        <button data-r="none" class="on">None</button>
        <button data-r="nearest">Nearest $1</button>
        <button data-r="down">Down to 0</button>
        <button data-r="up">Up to 0</button>
      </div>
      <span class="dp-eg" id="dpEg"></span>
    </div>
    <div class="dp-list" id="dpPreview"></div>
    <p class="hint">Click a new price to type your own. Listings with bids are locked by Trade Me and will show an error.</p>
    <div class="actions"><button class="btn ghost" id="cancel">Cancel</button><button class="btn primary" id="go">Update prices</button></div>`);
  // Prices typed straight into a row win over the % (any price, up or down). Changing the % or
  // rounding recalculates every row, typed ones included.
  let typed = {};
  const plan = () =>
    list.map((i) => {
      const from = currentPrice(i);
      const own = typed[i.listingId];
      const to = own != null ? Math.round(own * 100) / 100 : droppedPrice(from, pct, round);
      return { i, from, to, own: own != null, ok: to >= 0.5 && (own != null ? to !== from : to < from) };
    });
  const updateGo = () => {
    const rows = plan();
    rows.forEach((r) => {
      const row = $(`.dp-row[data-id="${r.i.listingId}"]`, card);
      row?.classList.toggle('skip', !r.ok);
      row?.classList.toggle('typed', r.own);
      // % change from the current price: red for a drop, green for a rise.
      const badge = $('.dp-pctchg', row);
      if (!badge) return;
      const chg = r.from && r.to >= 0.5 ? ((r.to - r.from) / r.from) * 100 : 0;
      const shown = Math.abs(chg) < 0.05 ? '0%' : `${chg > 0 ? '+' : '−'}${+Math.abs(chg).toFixed(1)}%`;
      badge.textContent = shown;
      badge.className = 'dp-pctchg ' + (chg < -0.05 ? 'down' : chg > 0.05 ? 'up' : '');
    });
    const n = rows.filter((r) => r.ok).length;
    $('#go', card).disabled = !n;
    $('#go', card).textContent = `Update ${n} price${n === 1 ? '' : 's'}`;
  };
  const preview = () => {
    typed = {};
    $('#dpPreview', card).innerHTML = plan()
      .map(
        (r) => `<div class="dp-row" data-id="${r.i.listingId}">
          ${r.i.picture ? `<img src="${esc(r.i.picture)}" alt=""/>` : '<span class="rl-noimg"></span>'}
          <span class="dp-title">${esc(r.i.title)}</span>
          <span class="dp-from">${dollars(r.from)}</span>
          <label class="dp-to"><span>$</span><input type="number" min="0.5" step="0.01" data-to="${r.i.listingId}" value="${r.to >= 0.5 ? (Number.isInteger(r.to) ? r.to : r.to.toFixed(2)) : ''}" title="Type your own price for this listing" /></label>
          <span class="dp-pctchg"></span>
        </div>`,
      )
      .join('');
    $$('[data-to]', card).forEach(
      (el) =>
        (el.oninput = () => {
          typed[+el.dataset.to] = el.value === '' ? 0 : +el.value;
          updateGo();
        }),
    );
    $('#dpEg', card).textContent = { none: 'Exact, cents kept, e.g. $185.90', nearest: 'e.g. $185.90 → $186', down: 'e.g. $185 → $180', up: 'e.g. $185 → $190' }[round];
    updateGo();
  };
  preview();
  $('#dpPct', card).oninput = (e) => {
    pct = Math.min(90, Math.max(0, +e.target.value || 0));
    $$('#dpQuick button', card).forEach((x) => x.classList.toggle('on', +x.dataset.p === pct));
    preview();
  };
  $$('#dpQuick button', card).forEach(
    (b) =>
      (b.onclick = () => {
        pct = +b.dataset.p;
        $('#dpPct', card).value = pct;
        $$('#dpQuick button', card).forEach((x) => x.classList.toggle('on', x === b));
        preview();
      }),
  );
  $$('#dpRound button', card).forEach(
    (b) =>
      (b.onclick = () => {
        round = b.dataset.r;
        $$('#dpRound button', card).forEach((x) => x.classList.toggle('on', x === b));
        preview();
      }),
  );
  $('#cancel', card).onclick = closeModal;
  $('#go', card).onclick = () => {
    closeModal();
    runPriceDrops(plan().filter((r) => r.ok));
  };
}

// One listing at a time: fetch Trade Me's current form, change the price, send it back.
async function runPriceDrops(rows) {
  LIVE.running = true;
  rows.forEach((r) => (LIVE.status[r.i.listingId] = { text: 'Queued' }));
  if (current === 'live') renderLive();
  let ok = 0;
  for (const [n, r] of rows.entries()) {
    const id = r.i.listingId;
    LIVE.status[id] = { text: `Updating ${n + 1} of ${rows.length}…` };
    if (current === 'live') renderLive();
    try {
      const L = await api.getListing({ accountId: r.i.accountId, listingId: id });
      const field = dropField(r.i);
      if ((L.ImmutableFields || []).some((f) => String(f).toLowerCase() === field.toLowerCase())) throw new Error('Trade Me has locked the price (it has bids).');
      const next = { ...L, [field]: r.to };
      // Buy Now can't sit under the start price, so a Buy Now-only listing moves both.
      if (field === 'BuyNowPrice' && L.StartPrice && L.StartPrice > r.to && !L.ReservePrice) next.StartPrice = r.to;
      await api.editListing({ accountId: r.i.accountId, listing: next, before: L, thumb: r.i.picture });
      r.i[field === 'BuyNowPrice' ? 'buyNow' : 'start'] = r.to;
      LIVE.status[id] = { ok: true, text: `${dollars(r.from)} → ${dollars(r.to)}` };
      LIVE.selected.delete(id);
      ok++;
    } catch (err) {
      LIVE.status[id] = { err: true, text: err.message };
    }
  }
  LIVE.running = false;
  toast(`${ok} price${ok === 1 ? '' : 's'} dropped${rows.length - ok ? `, ${rows.length - ok} failed` : ''}`);
  if (current === 'live') renderLive();
  if (ok) dataChanged('live');
}

// Small popover under a row's ⋯ button.
function liveMenu(btn, item) {
  $('#rowMenu')?.remove();
  const r = btn.getBoundingClientRect();
  const m = document.createElement('div');
  m.id = 'rowMenu';
  m.className = 'row-menu';
  m.style.top = `${r.bottom + 4}px`;
  m.style.right = `${window.innerWidth - r.right}px`;
  m.innerHTML = '<button data-a="edit">Edit listing</button><button data-a="open">Open on Trade Me</button><button data-a="withdraw" class="danger">Withdraw…</button>';
  document.body.append(m);
  const close = () => (m.remove(), document.removeEventListener('click', close));
  setTimeout(() => document.addEventListener('click', close));
  m.querySelector('[data-a=edit]').onclick = () => (close(), editListing(item));
  m.querySelector('[data-a=open]').onclick = () => (close(), api.openExternal(item.url));
  m.querySelector('[data-a=withdraw]').onclick = () => (close(), withdrawListing(item));
}

// Withdraw can't be undone, so it always asks first.
function withdrawListing(item) {
  const card = modal(`
    <h3>Withdraw this listing?</h3>
    <div class="hero">${item.picture ? `<img src="${esc(item.picture)}" />` : ''}<div><b>${esc(item.title)}</b><br/><small style="color:var(--muted)">#${item.listingId} · ${esc(item.nickname)}</small></div></div>
    <div class="seg" id="wdType" style="margin:12px 0"><button data-t="0" class="on">Didn't sell</button><button data-t="1">Sold elsewhere</button></div>
    <label class="f" id="wdReasonWrap">Reason (optional)<input id="wdReason" maxlength="255" placeholder="e.g. No longer available" /></label>
    <label class="f hidden" id="wdPriceWrap">Sale price $ (optional)<input id="wdPrice" type="number" min="0" step="0.01" /></label>
    <p class="hint">It comes off Trade Me straight away. This can't be undone.</p>
    <p class="hint" id="wdMsg" style="color:var(--red)"></p>
    <div class="actions"><button class="btn ghost" id="cancel">Cancel</button><button class="btn danger" id="go">Withdraw listing</button></div>`);
  let sold = false;
  $$('#wdType button', card).forEach(
    (b) =>
      (b.onclick = () => {
        sold = b.dataset.t === '1';
        $$('#wdType button', card).forEach((x) => x.classList.toggle('on', x === b));
        $('#wdReasonWrap', card).classList.toggle('hidden', sold);
        $('#wdPriceWrap', card).classList.toggle('hidden', !sold);
      }),
  );
  $('#cancel', card).onclick = closeModal;
  $('#go', card).onclick = async () => {
    $('#go', card).disabled = $('#cancel', card).disabled = true;
    $('#go', card).textContent = 'Withdrawing…';
    try {
      await api.withdrawListing({ accountId: item.accountId, listingId: item.listingId, sold, salePrice: +$('#wdPrice', card).value || 0, reason: $('#wdReason', card).value.trim(), meta: { title: item.title, price: item.buyNow || item.start || item.price, picture: item.picture } });
      closeModal();
      toast('Listing withdrawn');
      LIVE.items = (LIVE.items || []).filter((i) => i.listingId !== item.listingId);
      if (current === 'live') renderLive();
      dataChanged('live', 'relist', ...(sold ? ['sold'] : []));
    } catch (err) {
      $('#wdMsg', card).textContent = err.message;
      $('#go', card).disabled = $('#cancel', card).disabled = false;
      $('#go', card).textContent = 'Withdraw listing';
    }
  };
}

// Edit a live listing: fetch Trade Me's current form, change a few fields, send the whole form back.
async function editListing(item) {
  let card = modal(`<h3>Edit listing</h3><div class="empty"><div class="spinner" style="margin:auto"></div></div>`);
  let L;
  try {
    L = await api.getListing({ accountId: item.accountId, listingId: item.listingId });
  } catch (err) {
    card = modal(`<h3>Edit listing</h3><p style="color:var(--red)">${esc(err.message)}</p><div class="actions"><button class="btn" id="cancel">Close</button></div>`);
    $('#cancel', card).onclick = closeModal;
    return;
  }
  const locked = new Set((L.ImmutableFields || []).map((f) => String(f).toLowerCase()));
  const lock = (k) => (locked.has(k.toLowerCase()) ? 'disabled title="Trade Me won\'t let this change now (e.g. it has bids)"' : '');
  const desc = (L.Description || []).join('\r\n');
  // Trade Me's edit form has no Buy-Now-only flag: a Buy Now price with no start price is one.
  const isBuyNowOnly = !!L.BuyNowPrice && !L.StartPrice;
  const num = (k, label) =>
    `<label class="f">${label}<input id="ed${k}" type="number" step="0.01" min="0" value="${L[k] ?? ''}" ${lock(k)} /></label>`;
  card = modal(`
    <h3>Edit listing</h3>
    <p class="hint" style="margin-top:-6px">#${item.listingId} · ${esc(item.nickname)}</p>
    <label class="f"><span>Title <span class="counter" id="edTitleN"></span></span><input id="edTitle" value="${esc(L.Title || '')}" ${lock('Title')} /></label>
    <div class="row">
      ${num('BuyNowPrice', 'Buy Now ($)')}
      ${isBuyNowOnly ? '' : num('StartPrice', 'Start price ($)') + num('ReservePrice', 'Reserve ($)')}
      ${isBuyNowOnly ? `<label class="f">Quantity<input id="edQuantity" type="number" min="1" step="1" value="${L.Quantity ?? 1}" ${lock('Quantity')} /></label>` : ''}
    </div>
    <div class="row">
      <label class="f">SKU<input id="edSKU" value="${esc(L.SKU || '')}" ${lock('SKU')} /></label>
      <label class="f">Offers<select id="edOffers" ${lock('IsCounterOffersAllowed')}><option value="0">No offers</option><option value="1" ${L.IsCounterOffersAllowed ? 'selected' : ''}>Allow offers</option></select></label>
    </div>
    <label class="f"><span>Description <span class="counter" id="edDescN"></span></span><textarea id="edDesc" rows="9" ${lock('Description')}>${esc(desc)}</textarea></label>
    ${locked.size ? `<p class="hint">Locked by Trade Me right now: ${[...(L.ImmutableFields || [])].map(esc).join(', ')}</p>` : ''}
    <p class="hint" id="edMsg" style="color:var(--red)"></p>
    <div class="actions"><button class="btn ghost" id="cancel">Cancel</button><button class="btn primary" id="go">Save changes</button></div>`);
  const counts = () => {
    const over = overCount($('#edTitleN', card), $('#edTitle', card), $('#edTitle', card).value.trim().length, 80) | overCount($('#edDescN', card), $('#edDesc', card), $('#edDesc', card).value.length, 2048);
    $('#go', card).disabled = !!over;
  };
  counts();
  $('#edTitle', card).oninput = $('#edDesc', card).oninput = counts;
  $('#cancel', card).onclick = closeModal;
  $('#go', card).onclick = async () => {
    const val = (id) => $('#' + id, card)?.value;
    const next = { ...L };
    const setPrice = (id, k) => {
      const el = $('#' + id, card);
      if (!el || el.disabled) return;
      next[k] = el.value === '' ? null : Math.round(+el.value * 100) / 100;
    };
    if (!$('#edTitle', card).disabled) next.Title = val('edTitle').trim();
    if (!$('#edDesc', card).disabled) next.Description = [val('edDesc').replace(/\r?\n/g, '\r\n')];
    if (!$('#edSKU', card).disabled) next.SKU = val('edSKU').trim();
    if (!$('#edOffers', card).disabled) next.IsCounterOffersAllowed = val('edOffers') === '1';
    setPrice('edBuyNowPrice', 'BuyNowPrice');
    setPrice('edStartPrice', 'StartPrice');
    setPrice('edReservePrice', 'ReservePrice');
    if ($('#edQuantity', card) && !$('#edQuantity', card).disabled) next.Quantity = Math.max(1, Math.round(+val('edQuantity')));
    $('#go', card).disabled = $('#cancel', card).disabled = true;
    $('#go', card).textContent = 'Saving…';
    try {
      await api.editListing({ accountId: item.accountId, listing: next, before: L, thumb: item.picture });
      closeModal();
      toast('Listing updated');
      dataChanged('live');
    } catch (err) {
      $('#edMsg', card).textContent = err.message;
      $('#go', card).disabled = $('#cancel', card).disabled = false;
      $('#go', card).textContent = 'Save changes';
    }
  };
}

/* ---------- SOLD ---------- */
// Trade Me's sold-items API only goes back 45 days.
const SOLD = { scope: null, days: 30, items: null, loadedFor: '', loading: false, error: '', view: {} };
// The newer My Trade Me Sold page (the classic Sold.aspx one is broken for in-trade accounts).
const TM_SOLD_URL = 'https://www.trademe.co.nz/a/my-trade-me/sell/sold';
// Website session for an account's embedded Trade Me pages. Accounts added from now on reuse the
// login from Settings → "Log in with Trade Me"; older ones get their own session (log in once).
const webPartition = (accountId) => S.accounts.find((a) => a.id === accountId)?.webPartition || `persist:tm-${accountId}`;
const PAY_NAME = { 32: 'Ping', 64: 'Afterpay', 4: 'Cash', 2: 'Card', 16: 'Other' };

async function loadSold() {
  SOLD.scope = pickScope(SOLD.scope);
  const ids = SOLD.scope === 'all' ? envAccounts().map((a) => a.id) : [SOLD.scope];
  if (!ids.length) return;
  SOLD.loading = true;
  SOLD.error = '';
  if (current === 'sold') renderSold();
  try {
    SOLD.items = await api.sold(ids);
    SOLD.loadedFor = SOLD.scope;
  } catch (err) {
    SOLD.error = err.message;
  }
  SOLD.loading = false;
  if (current === 'sold') renderSold();
}

function renderSold() {
  const accs = envAccounts();
  SOLD.scope = pickScope(SOLD.scope);
  const cutoff = Date.now() - SOLD.days * 86400000;
  const items = (SOLD.items || []).filter((i) => !i.soldDate || new Date(i.soldDate) >= cutoff);
  const sum = (k) => items.reduce((s, i) => s + (i[k] || 0), 0);
  const fees = sum('processing') + sum('success');
  const showAcc = SOLD.scope === 'all' && accs.length > 1;
  const when = (iso) => new Date(iso).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' });
  // One account selected: choose between our sales list and Trade Me's own Sold page.
  // Accounts whose sales the API can't see (newer-platform listings) open on Trade Me's page.
  const single = SOLD.scope !== 'all';
  const loadedHere = SOLD.items && SOLD.loadedFor === SOLD.scope;
  const mode = single ? SOLD.view[SOLD.scope] || (loadedHere && !SOLD.items.length ? 'page' : 'list') : 'list';
  const silent = !single && SOLD.items ? accs.filter((a) => !SOLD.items.some((i) => i.accountId === a.id)) : [];

  view.innerHTML = `
    <h1>Sold</h1>
    <div style="display:flex;gap:10px;align-items:center;margin-bottom:16px;flex-wrap:wrap">
      <select id="soldAcc" style="width:auto;min-width:200px">
        <option value="all" ${SOLD.scope === 'all' ? 'selected' : ''}>All accounts</option>
        ${accs.map((a) => `<option value="${a.id}" ${a.id === SOLD.scope ? 'selected' : ''}>${esc(a.nickname)}</option>`).join('')}
      </select>
      <button class="btn" id="soldRefresh" ${SOLD.loading ? 'disabled' : ''}>${SOLD.loading ? 'Loading…' : 'Refresh'}</button>
      ${single ? `<div class="seg" id="soldMode"><button data-m="list" class="${mode === 'list' ? 'on' : ''}">Sales list</button><button data-m="page" class="${mode === 'page' ? 'on' : ''}">Trade Me page</button></div>` : ''}
      <div class="seg ${mode === 'page' ? 'hidden' : ''}" id="soldDays" style="margin-left:auto">
        ${[7, 14, 30, 45].map((d) => `<button data-d="${d}" class="${SOLD.days === d ? 'on' : ''}">${d} days</button>`).join('')}
      </div>
    </div>
    ${
      mode === 'page'
        ? `<div class="card" style="padding:16px">
            <div style="display:flex;gap:10px;align-items:center;margin-bottom:12px">
              <p class="hint" style="margin:0;flex:1">Trade Me's own Sold page for ${esc(accs.find((a) => a.id === SOLD.scope)?.nickname)}. It covers every sale, including newer-platform listings. Log in on it once (same login as Questions).</p>
              <button class="btn small" id="tmReload">Reload</button>
              <button class="btn small" id="tmOpen">Open in browser</button>
            </div>
            ${loginBarHtml(SOLD.scope)}
            <webview id="tmView" class="tm-view" src="${TM_SOLD_URL}" partition="${esc(webPartition(SOLD.scope))}"></webview>
          </div>`
        : SOLD.error
        ? `<div class="empty" style="color:var(--red)">${esc(SOLD.error)}</div>`
        : !SOLD.items
          ? `<div class="empty">${accs.length ? '<div class="spinner" style="margin:auto"></div>' : 'Connect an account in Settings.'}</div>`
          : `<div class="sold-stats">
              <div><span>Sales</span><b>${items.length}</b></div>
              <div><span>Buyers paid</span><b>${dollars(sum('total'))}</b></div>
              <div><span>Fees</span><b>${fees ? '−' + money(fees) : '$0.00'}</b></div>
              <div class="payout-stat"><span>Your payout</span><b>${dollars(sum('payout'))}</b></div>
            </div>
            ${
              !items.length
                ? `<div class="empty">No sales in the last ${SOLD.days} days.</div>`
                : `<div class="rl-table sold-table ${showAcc ? 'with-acc' : ''}">
                    <div class="sold-row rl-head"><span></span><span>Listing</span>${showAcc ? '<span>Account</span>' : ''}<span>Sold</span><span>Paid via</span><span>Total</span><span>Fees</span><span>Payout</span></div>
                    ${items
                      .map(
                        (i) => `<div class="sold-row">
                          ${i.picture ? `<img src="${esc(i.picture)}" alt=""/>` : '<span class="rl-noimg"></span>'}
                          <span class="rl-title"><b>${esc(i.title)}</b><a href="#" data-url="${esc(i.url)}">${i.qty > 1 ? `${i.qty} × ` : ''}to ${esc(i.buyer || 'buyer')}${i.status ? ' · ' + esc(i.status) : ''}</a></span>
                          ${showAcc ? `<span class="rl-muted">${esc(i.nickname)}</span>` : ''}
                          <span class="rl-muted">${i.soldDate ? when(i.soldDate) : ''}</span>
                          <span>${i.method ? `<i class="pay-tag p${i.method}">${PAY_NAME[i.method] || 'Other'}</i>` : `<i class="pay-tag">${i.pending ? 'Pending' : 'Unpaid'}</i>`}</span>
                          <span class="rl-num">${dollars(i.total)}</span>
                          <span class="rl-muted" title="${i.processing ? `${PAY_NAME[i.method] || 'Payment'} fee ${money(i.processing)}` : ''}${i.processing && i.success ? ' + ' : ''}${i.success ? `success fee ${money(i.success)}` : ''}">${i.processing + i.success ? '−' + money(i.processing + i.success) : '—'}</span>
                          <span class="rl-num payout-num">${dollars(i.payout)}</span>
                        </div>`,
                      )
                      .join('')}
                  </div>`
            }
            ${
              silent.length
                ? `<div class="sold-silent">No sales came through the API for ${silent.map((a) => `<b>${esc(a.nickname)}</b>`).join(', ')}. Their listings are probably on Trade Me's newer platform.
                    ${silent.map((a) => `<button class="btn small" data-tmsold="${a.id}">Open ${esc(a.nickname)}'s Trade Me Sold page</button>`).join('')}</div>`
                : single && mode === 'list'
                  ? '<p class="hint">Missing sales? Listings on Trade Me\'s newer platform don\'t come through the API. Switch to "Trade Me page" to see them.</p>'
                  : ''
            }`
    }`;

  $('#soldAcc').onchange = (e) => {
    SOLD.scope = e.target.value;
    loadSold();
  };
  $('#soldRefresh').onclick = () => loadSold();
  $$('#soldDays button').forEach((b) => (b.onclick = () => ((SOLD.days = +b.dataset.d), renderSold())));
  $$('#soldMode button').forEach((b) => (b.onclick = () => ((SOLD.view[SOLD.scope] = b.dataset.m), renderSold())));
  $$('[data-tmsold]').forEach(
    (b) =>
      (b.onclick = () => {
        SOLD.scope = b.dataset.tmsold;
        SOLD.view[SOLD.scope] = 'page';
        loadSold();
      }),
  );
  if (mode === 'page') {
    // After logging in, Trade Me lands on My Trade Me's home. Only then (never mid sign-in, which
    // hops through auth.trademe.co.nz) bring it back to the Sold page, once.
    const wv = $('#tmView');
    watchTmLogin(wv);
    let redirected = false;
    wv.addEventListener('did-navigate', (e) => {
      const u = new URL(e.url);
      const landedOnMyTradeMe = u.hostname === 'www.trademe.co.nz' && /^\/(a\/)?my-trade-me\/?$/i.test(u.pathname);
      if (landedOnMyTradeMe && !redirected) {
        redirected = true;
        wv.loadURL(TM_SOLD_URL);
      }
    });
    $('#tmReload').onclick = () => wv.reload();
    $('#tmOpen').onclick = () => api.openExternal(TM_SOLD_URL);
  }
  $$('[data-url]').forEach((a) => (a.onclick = (e) => (e.preventDefault(), api.openExternal(a.dataset.url))));
  if ((!SOLD.items || SOLD.loadedFor !== SOLD.scope) && !SOLD.loading && !SOLD.error && accs.length) loadSold();
}

/* ---------- QUESTIONS ---------- */
const Q = { accountId: null, data: null, loading: false, error: '', filter: 'unanswered', selected: null, drafts: {}, sending: {} };
const qTime = (iso) =>
  iso ? new Date(iso).toLocaleString('en-NZ', { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase() + ', ' + new Date(iso).toLocaleDateString('en-NZ', { weekday: 'short', day: 'numeric', month: 'short' }) : '';
const unansweredOf = (l) => l.questions.filter((q) => !q.answer && !q.isSellerComment).length;

function updateQBadge() {
  const n = (Q.data || []).reduce((s, l) => s + unansweredOf(l), 0);
  const b = $('#qBadge');
  b.hidden = !n;
  b.textContent = n;
}

async function loadQuestions() {
  if (!Q.accountId) return;
  Q.loading = true;
  Q.error = '';
  if (current === 'questions') renderQuestions();
  try {
    Q.data = await api.questions(Q.accountId);
  } catch (err) {
    Q.error = err.message;
  }
  Q.loading = false;
  updateQBadge();
  if (current === 'questions') renderQuestions();
}

function renderQuestions() {
  const accs = envAccounts();
  if (!accs.some((a) => a.id === Q.accountId)) {
    Q.accountId = accs.some((a) => a.id === S.defaultAccountId) ? S.defaultAccountId : accs[0]?.id || null;
    Q.data = null;
  }
  const all = Q.data || [];
  const totalUn = all.reduce((s, l) => s + unansweredOf(l), 0);
  // API listings first (filtered), then newer-platform listings whose Q&A only shows on Trade Me's page.
  const apiShown = all
    .filter((l) => !l.koru && (Q.filter === 'all' || unansweredOf(l)))
    .sort((a, b) => unansweredOf(b) - unansweredOf(a) || (b.questions.at(-1)?.commentDate || '').localeCompare(a.questions.at(-1)?.commentDate || ''));
  // Newer-platform listings: the app can't tell if they have unanswered questions, so they only
  // appear under "All" (Unanswered just mentions them).
  const koruAll = all.filter((l) => l.koru);
  const koruShown = Q.filter === 'all' ? koruAll.sort((a, b) => (b.qaCount || 0) - (a.qaCount || 0)) : [];
  const shown = [...apiShown, ...koruShown];
  const itemHtml = (l) => {
    const un = unansweredOf(l);
    const right = l.koru
      ? l.qaCount != null
        ? `<small class="q-total" data-qa="${l.listingId}">${l.qaCount}</small>`
        : `<small class="q-total" data-qa="${l.listingId}">↗</small>`
      : un
        ? `<i class="q-count">${un}</i>`
        : `<small class="q-total">${l.questions.length}</small>`;
    return `<button class="q-item ${l.listingId === Q.selected ? 'on' : ''}" data-l="${l.listingId}">
      ${l.picture ? `<img src="${esc(l.picture)}" alt=""/>` : '<span class="rl-noimg"></span>'}
      <span class="q-item-text"><b>${esc(l.title || 'Listing #' + l.listingId)}</b><small>${esc(l.koru ? 'Open to view questions' : l.questions.at(-1)?.comment || 'No questions yet')}</small></span>
      ${right}
    </button>`;
  };
  if (!shown.some((l) => l.listingId === Q.selected)) Q.selected = shown[0]?.listingId ?? null;
  const sel = shown.find((l) => l.listingId === Q.selected);
  const me = accs.find((a) => a.id === Q.accountId);

  view.innerHTML = `
    <h1>Questions</h1>
    <div style="display:flex;gap:10px;align-items:center;margin-bottom:14px;flex-wrap:wrap">
      <select id="qAcc" style="width:auto;min-width:200px">${accs.map((a) => `<option value="${a.id}" ${a.id === Q.accountId ? 'selected' : ''}>${esc(a.nickname)}</option>`).join('') || '<option>No accounts</option>'}</select>
      <button class="btn" id="qRefresh" ${Q.loading || !Q.accountId ? 'disabled' : ''}>${Q.loading ? 'Loading…' : 'Refresh'}</button>
      <div class="seg" id="qFilter" style="margin-left:auto">
        <button data-f="unanswered" class="${Q.filter === 'unanswered' ? 'on' : ''}">Unanswered${totalUn ? ` (${totalUn})` : ''}</button>
        <button data-f="all" class="${Q.filter === 'all' ? 'on' : ''}">All</button>
      </div>
    </div>
    ${
      Q.error
        ? `<div class="empty" style="color:var(--red)">${esc(Q.error)}</div>`
        : !Q.data
          ? `<div class="empty">${Q.loading || Q.accountId ? '<div class="spinner" style="margin:auto"></div>' : 'Connect an account in Settings.'}</div>`
          : !shown.length
            ? `<div class="empty">${Q.filter === 'unanswered' ? `All caught up — no unanswered questions.${koruAll.length ? `<br/><small>${koruAll.length} newer-platform listing${koruAll.length > 1 ? 's' : ''} can only be checked on Trade Me's page — see <a href="#" id="qSeeAll">All</a>.</small>` : ''}` : 'No questions on your current listings.'}</div>`
            : `<div class="q-layout">
                <div class="q-list">
                  ${apiShown.map(itemHtml).join('')}
                  ${Q.filter === 'unanswered' && koruAll.length ? `<div class="q-group">+ ${koruAll.length} newer-platform listing${koruAll.length > 1 ? 's' : ''} under <a href="#" id="qSeeAll">All</a></div>` : ''}
                  ${koruShown.length ? `<div class="q-group">Newer Trade Me listings <span title="These are on Trade Me's newer platform, which the API can't read questions from. They open Trade Me's own page instead.">ⓘ</span></div>${koruShown.map(itemHtml).join('')}` : ''}
                </div>
                <div class="q-thread card">${sel ? (sel.koru ? koruHtml(sel) : threadHtml(sel, me)) : ''}</div>
              </div>`
    }`;

  $('#qAcc').onchange = (e) => {
    Q.accountId = e.target.value;
    Q.data = null;
    loadQuestions();
  };
  $('#qRefresh').onclick = () => loadQuestions();
  $$('#qFilter button').forEach((b) => (b.onclick = () => ((Q.filter = b.dataset.f), renderQuestions())));
  $('#qSeeAll')?.addEventListener('click', (e) => (e.preventDefault(), (Q.filter = 'all'), renderQuestions()));
  $$('.q-item').forEach((b) => (b.onclick = () => ((Q.selected = +b.dataset.l), renderQuestions())));
  $$('[data-url]').forEach((a) => (a.onclick = (e) => (e.preventDefault(), api.openExternal(a.dataset.url))));
  $$('.q-reply textarea').forEach((t) => {
    t.oninput = () => (Q.drafts[t.dataset.q] = t.value);
    t.onkeydown = (e) => e.key === 'Enter' && (e.ctrlKey || e.metaKey) && sendAnswer(sel, +t.dataset.q);
  });
  $$('.q-reply button').forEach((b) => (b.onclick = () => sendAnswer(sel, +b.dataset.q)));
  if (sel?.koru) wireTmView(sel);
  if (!Q.data && !Q.loading && !Q.error && Q.accountId) loadQuestions();
}

// Trade Me's own listing page, logged in per account (the session is kept between launches).
function koruHtml(l) {
  return `
    <div class="q-head">
      ${l.picture ? `<img src="${esc(l.picture)}" alt=""/>` : ''}
      <div style="flex:1;min-width:0"><b>${esc(l.title)}</b><a href="#" data-url="${esc(l.url)}">#${l.listingId} · Open in browser</a></div>
      <button class="btn small" id="tmReload">Reload</button>
    </div>
    <p class="hint" style="margin:12px 0">Shown from Trade Me's own page. Log in on it once per account and you can read and reply to questions right here.</p>
    ${loginBarHtml(Q.accountId)}
    <webview id="tmView" class="tm-view" src="${esc(l.url)}" partition="${esc(webPartition(Q.accountId))}"></webview>`;
}

// "Not logged in" bar for embedded Trade Me pages: detected from the page's own "Log in" link.
const loginBarHtml = (accountId) =>
  `<div class="tm-login" id="tmLogin" hidden><span>This page isn't logged in as <b>${esc(S.accounts.find((a) => a.id === accountId)?.nickname || 'this account')}</b>, so you're seeing it as a buyer.</span><button class="btn small primary" id="tmLoginBtn">Log in</button></div>`;
function watchTmLogin(wv) {
  const bar = $('#tmLogin');
  if (!bar) return;
  const check = async () => {
    const loggedOut = await wv
      .executeJavaScript(`!location.pathname.includes('/login') && [...document.querySelectorAll('a,button')].some((e) => /^\\s*Log in\\s*$/i.test(e.textContent))`)
      .catch(() => false);
    bar.hidden = !loggedOut;
  };
  wv.addEventListener('did-stop-loading', check);
  $('#tmLoginBtn').onclick = () => {
    const back = wv.getURL();
    wv.loadURL('https://www.trademe.co.nz/a/login?redirect=' + encodeURIComponent(new URL(back).pathname));
    bar.hidden = true;
  };
}

// Scroll the embedded page to its Q&A and pick up the "Questions & Answers (N)" count for the list.
function wireTmView(l) {
  const wv = $('#tmView');
  if (!wv) return;
  watchTmLogin(wv);
  $('#tmReload').onclick = () => wv.reload();
  const find = `(() => {
    const h = [...document.querySelectorAll('h1,h2,h3,h4,h5,div,span')].find((e) => /^\\s*Questions\\s*&\\s*Answers/i.test(e.textContent) && e.textContent.length < 40);
    if (!h) return null;
    h.scrollIntoView({ block: 'start' });
    window.scrollBy(0, -20);
    const m = h.textContent.match(/\\((\\d+)\\)/);
    return m ? +m[1] : 0;
  })()`;
  let tries = 0;
  const seek = async () => {
    const n = await wv.executeJavaScript(find).catch(() => null);
    if (n == null) return ++tries < 15 && setTimeout(seek, 700);
    l.qaCount = n;
    const badge = $(`[data-qa="${l.listingId}"]`);
    if (badge) badge.textContent = n;
  };
  wv.addEventListener('did-stop-loading', () => ((tries = 0), seek()));
}

function threadHtml(l, me) {
  const sellerName = me?.nickname || 'You';
  const avatar = (who, photo) =>
    photo ? `<img class="q-av" src="${esc(photo)}" alt=""/>` : `<span class="q-av ${who}">${who === 'seller' ? esc(sellerName[0]?.toUpperCase() || 'S') : '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>'}</span>`;
  const sellerMsg = (text, date) => `
    <div class="q-msg seller">${avatar('seller')}<div class="q-bubble">${esc(text)}</div></div>
    <div class="q-meta">${esc(sellerName)} • ${qTime(date)}</div>`;
  return `
    <div class="q-head">
      ${l.picture ? `<img src="${esc(l.picture)}" alt=""/>` : ''}
      <div><b>${esc(l.title || 'Listing #' + l.listingId)}</b><a href="#" data-url="${esc(l.url)}">#${l.listingId} · Open on Trade Me</a></div>
    </div>
    <h3 class="q-title">Questions &amp; Answers (${l.questions.length})</h3>
    ${l.questions.length ? '' : '<p class="hint">No questions on this listing yet.</p>'}
    ${l.questions
      .map((q) => {
        if (q.isSellerComment) return `<div class="qa">${sellerMsg(q.comment, q.commentDate)}</div>`;
        const who = q.asker ? `${esc(q.asker.nickname)}${q.asker.feedback != null ? ` (${q.asker.feedback})` : ''}` : 'Member';
        return `<div class="qa">
          <div class="q-msg buyer"><div class="q-bubble">${esc(q.comment)}</div>${avatar('buyer', q.asker?.photo)}</div>
          <div class="q-meta right">${who} • ${qTime(q.commentDate)}</div>
          ${
            q.answer
              ? sellerMsg(q.answer, q.answerDate)
              : `<div class="q-reply">${avatar('seller')}
                  <div class="q-reply-box">
                    <textarea data-q="${q.id}" maxlength="500" rows="2" placeholder="Answer ${esc(q.asker?.nickname || 'this question')}…" ${Q.sending[q.id] ? 'disabled' : ''}>${esc(Q.drafts[q.id] || '')}</textarea>
                    <div class="q-reply-foot"><small>Ctrl+Enter to send</small><button class="btn small primary" data-q="${q.id}" ${Q.sending[q.id] ? 'disabled' : ''}>${Q.sending[q.id] ? 'Sending…' : 'Reply'}</button></div>
                  </div>
                </div>`
          }
        </div>`;
      })
      .join('')}`;
}

async function sendAnswer(listing, qid) {
  const text = (Q.drafts[qid] || '').trim();
  if (!text || Q.sending[qid]) return;
  Q.sending[qid] = true;
  renderQuestions();
  try {
    const updated = await api.answerQuestion({ accountId: Q.accountId, listingId: listing.listingId, questionId: qid, answer: text, meta: { title: listing.title, picture: listing.picture } });
    const q = listing.questions.find((x) => x.id === qid);
    Object.assign(q, { answer: updated.answer || text, answerDate: updated.answerDate || new Date().toISOString() });
    delete Q.drafts[qid];
    toast('Answer sent');
  } catch (err) {
    toast(err.message);
  }
  delete Q.sending[qid];
  updateQBadge();
  // Stay on this listing even if it's now fully answered and the filter would hide it.
  if (Q.filter === 'unanswered' && !unansweredOf(listing)) Q.filter = 'all';
  Q.selected = listing.listingId;
  if (current === 'questions') renderQuestions();
}

/* ---------- HISTORY ---------- */
// Every action taken from the app. Entries from before the activity log have no action: they were listings.
const H_ACTIONS = {
  listed: { label: 'Listed', group: 'listed', tone: 'green' },
  price: { label: 'Price change', group: 'price', tone: 'lav' },
  edited: { label: 'Edited', group: 'edited', tone: 'lav' },
  withdrawn: { label: 'Withdrawn', group: 'withdrawn', tone: 'red' },
  'sold-elsewhere': { label: 'Sold elsewhere', group: 'withdrawn', tone: 'sand' },
  relisted: { label: 'Relisted', group: 'relisted', tone: 'green' },
  'relist-failed': { label: 'Relist failed', group: 'relisted', tone: 'red' },
  archived: { label: 'Archived', group: 'archived', tone: '' },
  unarchived: { label: 'Unarchived', group: 'archived', tone: '' },
  answered: { label: 'Answered question', group: 'answered', tone: 'lav' },
  'account-added': { label: 'Account added', group: 'accounts', tone: '' },
  'account-removed': { label: 'Account removed', group: 'accounts', tone: 'red' },
};
const H_FILTERS = [['all', 'All'], ['listed', 'Listed'], ['price', 'Prices'], ['edited', 'Edits'], ['withdrawn', 'Withdrawn'], ['relisted', 'Relisted'], ['archived', 'Archived'], ['answered', 'Questions'], ['accounts', 'Accounts']];
const H = { filter: 'all', q: '' };
async function renderHistory() {
  try {
    S = await api.getSettings();
  } catch {}
  if (current !== 'history') return;
  const all = (S.history || []).map((h) => ({ ...h, action: h.action || 'listed' }));
  const q = H.q.trim().toLowerCase();
  const rows = all.filter(
    (h) => (H.filter === 'all' || H_ACTIONS[h.action]?.group === H.filter) && (!q || `${h.title} ${h.sku} ${h.listingId} ${h.accountNickname} ${h.detail}`.toLowerCase().includes(q)),
  );
  const day = (iso) => new Date(iso).toLocaleDateString('en-NZ', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const time = (iso) => new Date(iso).toLocaleTimeString('en-NZ', { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase();
  const what = (h) => {
    if (h.from != null && h.to != null && h.from !== h.to) return `${dollars(h.from)} → ${dollars(h.to)}`;
    if (h.detail) return esc(h.detail);
    return h.price ? dollars(h.price) : '';
  };
  let lastDay = '';
  const list = rows
    .map((h) => {
      const a = H_ACTIONS[h.action] || { label: h.action, tone: '' };
      const d = day(h.at);
      const head = d !== lastDay ? `<div class="h-day">${d}</div>` : '';
      lastDay = d;
      const isAccount = h.action.startsWith('account-');
      return `${head}<div class="item h-row">
        ${isAccount ? '<span class="rl-noimg"></span>' : h.thumb ? `<img src="${esc(h.thumb)}" alt=""/>` : '<span class="rl-noimg"></span>'}
        <div class="grow">
          <b>${isAccount ? esc(h.accountNickname) : esc(h.title || `Listing #${h.listingId}`)}</b>
          <small>${[what(h), !isAccount && h.listingId ? `#${h.listingId}` : '', !isAccount ? esc(h.accountNickname) : '', h.env === 'sandbox' ? 'sandbox' : ''].filter(Boolean).join(' · ')}</small>
        </div>
        <span class="h-tag ${a.tone}">${esc(a.label)}</span>
        <span class="h-time">${time(h.at)}</span>
        ${h.url && !isAccount ? `<button class="btn small" data-url="${esc(h.url)}">Open</button>` : '<span class="h-open-gap"></span>'}
      </div>`;
    })
    .join('');
  view.innerHTML = `
    <h1>History</h1>
    <div class="h-bar">
      <div class="seg" id="hFilter">${H_FILTERS.map(([k, l]) => `<button data-f="${k}" class="${H.filter === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      <input id="hSearch" placeholder="Search title, SKU, listing #" value="${esc(H.q)}" spellcheck="false" />
    </div>
    <div class="list">${list || `<div class="empty">${all.length ? 'Nothing matches.' : 'Nothing yet. Listings, price changes, withdrawals, relists and more show up here.'}</div>`}</div>`;
  $$('#hFilter button').forEach((b) => (b.onclick = () => ((H.filter = b.dataset.f), renderHistory())));
  const search = $('#hSearch');
  search.oninput = debounce(() => {
    H.q = search.value;
    renderHistory().then(() => {
      const s = $('#hSearch');
      s?.focus();
      s?.setSelectionRange(s.value.length, s.value.length);
    });
  }, 200);
  $$('[data-url]').forEach((b) => (b.onclick = () => api.openExternal(b.dataset.url)));
}

/* ---------- SETTINGS ---------- */
// Patches made in quick succession are merged into one save.
let pending = {};
const mergeInto = (a, b) => {
  for (const [k, v] of Object.entries(b))
    a[k] = v && typeof v === 'object' && !Array.isArray(v) ? mergeInto(a[k] || {}, v) : v;
  return a;
};
const saveSettings = (patch) => (mergeInto(pending, patch), flush());
const flush = debounce(async () => {
  const patch = pending;
  pending = {};
  try {
    S = await api.updateSettings(patch);
    renderNav();
    toast('Saved');
  } catch (err) {
    toast(err.message);
  }
}, 400);

function renderSettings() {
  const c = S.consumer[S.env];
  view.innerHTML = `
  <div class="settings">
    <h1>Settings</h1>

    <div class="card">
      <h2>Accounts</h2>
      <div class="list" id="accList"></div>
      <div style="margin-top:12px"><button class="btn primary" id="login">Log in with Trade Me</button></div>
      <p class="hint">Opens Trade Me's login in a popup. Log in and click Allow. Add as many accounts as you like.</p>
    </div>

    <div class="card">
      <h2>Trade Me API</h2>
      <div class="seg" id="envSeg" style="margin-bottom:14px"><button data-v="production">Production</button><button data-v="sandbox">Sandbox</button></div>
      <div class="row">
        <label class="f">Consumer key <input id="ck" value="${esc(c.key)}" spellcheck="false" /></label>
        <label class="f">Consumer secret <input id="cs" type="password" placeholder="${c.hasSecret ? '•••••••• saved' : 'paste secret'}" /></label>
      </div>
      <p class="hint">Register an app under My Trade Me → API applications (callback URL <code>https://localhost/trademe-callback</code>). Sandbox needs its own app on tmsandbox.co.nz.</p>
    </div>

    <div class="card">
      <h2>Product lookup (Trace)</h2>
      <div class="row">
        <label class="f">Auth token <input id="traceToken" type="password" spellcheck="false" placeholder="${S.trace.hasToken ? '•••••••• saved — paste to replace' : 'Paste the Bearer token'}" /></label>
      </div>
      <div style="display:flex;gap:8px;align-items:center">
        <button class="btn small" id="traceTest" ${S.trace.hasToken ? '' : 'disabled'}>Test</button>
        ${S.trace.hasToken ? '<button class="btn small danger" id="traceClear">Remove</button>' : ''}
        <span class="hint" id="traceStatus" style="margin:0">${S.trace.hasToken ? 'Token saved.' : 'Without a token, add photos yourself on each listing.'}</span>
      </div>
      <p class="hint">Looks up the SKU on Trace for the product name, colour and photo. "Bearer " is stripped automatically.</p>
    </div>

    <div class="card">
      <h2>Updates</h2>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <button class="btn small" id="updCheck">Check for updates</button>
        <button class="btn small primary hidden" id="updGo"></button>
        <span class="hint" id="updStatus" style="margin:0">Version <span id="appVer">…</span></span>
      </div>
      <p class="hint">Checks GitHub for a newer release, downloads it and restarts the app to install it. Your accounts and settings are kept.</p>
    </div>
  </div>`;

  api.appVersion().then((v) => $('#appVer') && ($('#appVer').textContent = v)).catch(() => {});
  $('#updCheck').onclick = async () => {
    const st = $('#updStatus');
    const go = $('#updGo');
    st.style.color = '';
    st.textContent = 'Checking…';
    go.classList.add('hidden');
    try {
      const r = await api.checkUpdate();
      if (r.dev) return (st.textContent = `Version ${r.current}. Running from source, so updates only work in the installed app.`);
      if (!r.available) {
        st.textContent = `You're up to date (version ${r.current}).`;
        st.style.color = 'var(--green)';
        return;
      }
      st.textContent = `Version ${r.latest} is available (you have ${r.current}).`;
      go.textContent = `Download ${r.latest}`;
      go.classList.remove('hidden');
      if (r.manual) {
        st.textContent += ' On Mac, download the new .dmg and drag Tagline into Applications to replace the old one.';
        go.onclick = () => api.openExternal(r.url);
        return;
      }
      go.onclick = async () => {
        go.disabled = true;
        go.textContent = 'Downloading… 0%';
        api.onUpdateProgress((p) => (go.textContent = p >= 100 ? 'Restarting…' : `Downloading… ${p}%`));
        try {
          await api.downloadUpdate();
          go.textContent = 'Restart to install';
          go.disabled = false;
          go.onclick = () => api.installUpdate();
        } catch (err) {
          st.textContent = err.message;
          st.style.color = 'var(--red)';
          go.disabled = false;
          go.textContent = `Download ${r.latest}`;
        }
      };
    } catch (err) {
      st.textContent = err.message;
      st.style.color = 'var(--red)';
    }
  };

  $$('#envSeg button').forEach((b) => {
    b.classList.toggle('on', b.dataset.v === S.env);
    b.onclick = async () => {
      S = await api.updateSettings({ env: b.dataset.v });
      F = null;
      renderNav();
      renderSettings();
    };
  });
  $('#ck').oninput = (e) => saveSettings({ consumer: { [S.env]: { key: e.target.value.trim() } } });
  $('#cs').onchange = (e) => e.target.value.trim() && saveSettings({ consumer: { [S.env]: { secret: e.target.value.trim() } } });

  const accList = () => {
    const accs = envAccounts();
    $('#accList').innerHTML =
      accs
        .map(
          (a) => `<div class="item"><div class="avatar">${esc(a.nickname[0]?.toUpperCase())}</div>
          <div class="grow"><b>${esc(a.nickname)} ${a.id === S.defaultAccountId ? '<span class="badge">Default</span>' : ''}</b><small>Member #${a.memberId} · added ${new Date(a.addedAt).toLocaleDateString()}</small></div>
          <div class="acc-bal" data-bal="${a.id}"><small>Balance…</small></div>
          ${a.id === S.defaultAccountId ? '' : `<button class="btn small" data-def="${a.id}">Make default</button>`}
          <button class="btn small danger" data-del="${a.id}">Remove</button></div>`,
        )
        .join('') || '<div class="empty">No accounts connected.</div>';
    // Balances load in the background; each row fills in when its call returns.
    accs.forEach((a) =>
      api
        .accountBalance(a.id)
        .then((b) => {
          const el = $(`[data-bal="${CSS.escape(a.id)}"]`);
          if (!el) return;
          el.innerHTML = `<b class="${b.balance < 0 ? 'neg' : ''}">${b.balance == null ? '—' : (b.balance < 0 ? '−' : '') + dollars(Math.abs(b.balance))}</b><small>Balance${b.ping != null ? ` · Ping ${dollars(b.ping)}` : ''}</small>`;
        })
        .catch(() => {
          const el = $(`[data-bal="${CSS.escape(a.id)}"]`);
          if (el) el.innerHTML = '<small>Balance unavailable</small>';
        }),
    );
    $$('[data-def]').forEach((b) => (b.onclick = async () => ((S = await api.updateSettings({ defaultAccountId: b.dataset.def })), accList())));
    $$('[data-del]').forEach(
      (b) =>
        (b.onclick = async () => {
          const acc = S.accounts.find((a) => a.id === b.dataset.del);
          if (!(await ask({ title: `Remove ${acc?.nickname || 'this account'}?`, body: 'It comes out of Tagline only. Your Trade Me account and listings are not touched, and you can log it back in any time.', ok: 'Remove account', danger: true }))) return;
          S = await api.removeAccount(b.dataset.del);
          renderNav();
          accList();
        }),
    );
  };
  accList();
  $('#login').onclick = async () => {
    const btn = $('#login');
    btn.disabled = true;
    btn.textContent = 'Waiting for Trade Me…';
    try {
      const r = await api.login(S.env);
      S = r.settings;
      toast(`Connected ${r.nickname}`);
      renderNav();
      accList();
    } catch (err) {
      toast(err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Log in with Trade Me';
    }
  };

  $('#traceToken').onchange = async (e) => {
    const token = e.target.value.trim();
    if (!token) return;
    S = await api.updateSettings({ trace: { token } });
    F = null;
    renderSettings();
    $('#traceTest').click();
  };
  $('#traceClear')?.addEventListener('click', async () => {
    S = await api.updateSettings({ trace: { token: '' } });
    renderSettings();
  });
  $('#traceTest').onclick = async () => {
    const st = $('#traceStatus');
    st.style.color = '';
    st.textContent = 'Testing…';
    try {
      const r = await api.traceSearch('DD1391-100');
      st.textContent = `Working — ${r.length} results for DD1391-100.`;
      st.style.color = 'var(--green)';
    } catch (err) {
      st.textContent = err.message;
      st.style.color = 'var(--red)';
    }
  };
}

/* ---------- settings: listing sections ---------- */
let defAcc = null; // account whose defaults are being edited
function renderDefaults() {
  const accs = envAccounts();
  if (!accs.some((a) => a.id === defAcc)) defAcc = F?.accountId && accs.some((a) => a.id === F.accountId) ? F.accountId : accs.some((a) => a.id === S.defaultAccountId) ? S.defaultAccountId : accs[0]?.id || null;
  const own = !!S.accountProfiles?.[defAcc]?.length;
  view.innerHTML = `
    <div class="settings">
      <div class="page-head">
        <div>
          <h1>Listing defaults</h1>
        </div>
        ${accs.length ? `<label class="acct-pick"><span>Account</span><select id="defAccSel">${accs.map((a) => `<option value="${a.id}" ${a.id === defAcc ? 'selected' : ''}>${esc(a.nickname)}</option>`).join('')}</select></label>` : ''}
      </div>
      ${defAcc && !own ? `<p class="hint" style="margin:-12px 0 16px">${esc(accs.find((a) => a.id === defAcc)?.nickname)} is using the shared defaults. Change anything and it gets its own copy.</p>` : ''}
      <div id="sections"></div>
    </div>`;
  $('#defAccSel')?.addEventListener('change', (e) => {
    defAcc = e.target.value;
    renderDefaults();
  });
  renderSections();
}

let editProfileId = null;
let subTab = 'general';

// Category promotions/fees, cached per environment + category.
const catInfoCache = {};
async function catInfoFor(number) {
  if (!number) return null;
  const key = S.env + number;
  if (!catInfoCache[key]) {
    catInfoCache[key] = api.categoryDetails(S.env, number).then((d) => ({ promotions: d.promotions, fees: d.fees, durations: d.durations }));
    catInfoCache[key].catch(() => delete catInfoCache[key]);
  }
  return catInfoCache[key];
}

// A $100 sample listing built purely from a section's defaults, for pricing them.
function defaultsListing(p) {
  const x = extrasOf(p);
  const pay = [p.payment.ping && 32, p.payment.afterpay && 64, p.payment.cash && 4].filter(Boolean);
  const L = {
    Category: p.category.number,
    Duration: +p.duration,
    Pickup: +p.pickup,
    IsBrandNew: !!p.isBrandNew,
    StartPrice: 100,
    ShippingOptions: p.shipping.filter((s) => s.method && s.price !== '').map((s) => ({ Type: 4, Price: +s.price, Method: s.method })),
    PaymentMethods: pay.length ? pay : [32],
  };
  if (p.listingType === 'buynow') {
    const q = Math.max(1, +p.quantity || 1);
    Object.assign(L, { BuyNowPrice: 100, Quantity: q }, q > 1 ? { IsFlatShippingCharge: p.shipPer !== 'item' } : {});
  }
  if (+x.promotionId > 1) L.PromotionId = +x.promotionId;
  if (x.subtitle.trim()) L.Subtitle = x.subtitle.trim();
  if (x.customEnd) Object.assign(L, { Duration: 0, EndDateTime: new Date(defaultEndAt(p.duration, x.endTime)).toISOString() });
  return L;
}

let secCostSeq = 0;
async function loadSecCosts(p) {
  const box = $('#secCost');
  if (!box) return;
  const seq = ++secCostSeq;
  const accountId = defAcc || envAccounts()[0]?.id;
  if (!p.category.number) return (box.innerHTML = '<span>Pick a category under General to see what these defaults cost.</span>');
  if (!accountId) return (box.innerHTML = '<span>Connect an account to check what these defaults cost.</span>');
  box.innerHTML = '<span>Checking what these defaults cost…</span>';
  try {
    const [r, info] = await Promise.all([api.fees({ accountId, listing: defaultsListing(p), salePrice: 0 }), catInfoFor(p.category.number).catch(() => null)]);
    if (seq !== secCostSeq || !$('#secCost')) return;
    const pct = Math.max(0, ...(info?.fees?.SuccessFeeTiers || []).map((t) => t.PercentageFee || 0));
    const success = pct ? ` Trade Me also takes a ${pct}% success fee when it sells.` : '';
    box.className = 'cost-strip ' + (r.total ? 'paid' : 'free');
    box.innerHTML = r.total
      ? `<b>${money(r.total)} per listing</b><span>${r.items.map((i) => `${esc(i.label)} ${money(i.amount)}`).join(' · ')}.${success}</span>`
      : `<b>Free to list</b><span>None of these defaults cost anything up front.${success}</span>`;
  } catch (err) {
    if (seq === secCostSeq) box.innerHTML = `<span style="color:var(--red)">${esc(err.message)}</span>`;
  }
}
const secCostsSoon = debounce((p) => loadSecCosts(p), 700);
function renderSections() {
  const profiles = structuredClone(profList(defAcc)); // local working copy for this account, saved wholesale
  editProfileId = profiles.some((p) => p.id === editProfileId) ? editProfileId : F?.profileId || profiles[0].id;
  const p = profiles.find((x) => x.id === editProfileId);
  p.extras = extrasOf(p);
  const persist = (list) => (defAcc ? storeProfiles(defAcc, list) : ((S.profiles = structuredClone(list)), saveSettings({ profiles: list })));
  const save = () => {
    persist(profiles);
    if (F?.accountId === defAcc && F?.profileId === p.id) F = null; // next new listing picks up the change
    secCostsSoon(p);
    showShipRefErr();
  };
  // Shown on every sub-tab, since fixing it may mean editing a template or adding a shipping option.
  const showShipRefErr = () => {
    const el = $('#shipRefErr');
    if (!el) return;
    const msg = shipRefError(p);
    el.textContent = msg;
    el.classList.toggle('hidden', !msg);
  };
  const box = $('#sections');
  box.innerHTML = `
    <div class="card">
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:16px">
        <div class="seg wrap-seg" id="secSeg">${profiles
          .map(
            (x) =>
              `<button data-s="${esc(x.id)}" class="sec-chip ${x.id === p.id ? 'on' : ''}"><span class="sec-name">${esc(x.name)}</span>${profiles.length > 1 ? `<i class="sec-x" data-del="${esc(x.id)}" title="Delete this section">×</i>` : ''}</button>`,
          )
          .join('')}</div>
        <button class="btn small" id="addSec">＋ Add section</button>
      </div>
      <div class="tabs" id="subTabs">
        ${[['general', 'General'], ['templates', 'Templates'], ['shipping', 'Shipping'], ['payment', 'Payment']].map(([k, l]) => `<button data-t="${k}">${l}</button>`).join('')}
      </div>
      <div class="cost-strip" id="secCost"></div>
      <div class="ship-ref-err hidden" id="shipRefErr"></div>
      <div data-panel="general">
      <div class="row">
        <label class="f">Section name <input id="secName" value="${esc(p.name)}" /></label>
        <label class="f">Listing type <select id="listingType"><option value="buynow">Buy Now only</option><option value="auction">Auction</option></select></label>
        <label class="f">Duration <select id="dur">${DURATIONS.map((d) => `<option value="${d}">${d} days</option>`).join('')}</select></label>
      </div>
      <div class="row">
        <label class="f">Condition <select id="cond"><option value="1">Brand new</option><option value="0">Used</option></select></label>
        <label class="f">Pickup <select id="pickup"><option value="1">Allow pickup</option><option value="2">Must pick up</option><option value="3">No pickups</option></select></label>
        <label class="f">Offers <select id="offers"><option value="0">No offers</option><option value="1">Allow offers</option></select></label>
        <label class="f" id="qtyWrap">Quantity <input id="qty" type="number" min="1" max="1000" step="1" value="${Math.max(1, +p.quantity || 1)}" /></label>
      </div>
      <p class="hint" id="qtyHint" style="margin:-4px 0 12px"></p>
        <div id="setCat"></div>
        <details class="extras" id="secExtras" ${p.extras.promotionId > 1 || p.extras.customEnd || p.extras.subtitle ? 'open' : ''}>
          <summary>Extras <span id="secExtrasSum"></span></summary>
          <div id="secExtrasBody"></div>
        </details>
        ${profiles.length > 1 ? `<div style="margin-top:18px"><button class="btn small danger" id="delSec">Delete "${esc(p.name)}" section</button></div>` : ''}
      </div>

      <div data-panel="payment">
        <div class="chips" id="setPay">
          ${payChipsHtml(p.payment)}
        </div>
        <p class="hint">Trade Me requires Ping on marketplace listings.</p>
      </div>

      <div data-panel="shipping">
        <div id="ship"></div>
        <button class="btn small" id="addShip">＋ Add option</button>
        <div style="margin-top:20px">
          <label class="f" style="margin-bottom:8px">When someone buys more than one</label>
          <div class="seg" id="shipPerSeg">
            <button data-v="order" class="${p.shipPer !== 'item' ? 'on' : ''}">Charge shipping once per order</button>
            <button data-v="item" class="${p.shipPer === 'item' ? 'on' : ''}">Charge per item</button>
          </div>
          <p class="hint">Only matters for Buy Now listings with a quantity over 1.</p>
        </div>
      </div>

      <div data-panel="templates">
        <label class="f" style="margin-bottom:12px">Title <input id="tTitle" value="${esc(p.titleTemplate)}" /></label>
        <label class="f" style="margin-bottom:12px">Description <textarea id="tDesc" rows="8">${esc(p.descriptionTemplate)}</textarea></label>
        <div class="row">
          <label class="f">Afterpay text (title) <input id="tAfterpay" value="${esc(p.afterpayText ?? 'AfterPay Available')}" placeholder="[AfterPay Available]" /></label>
          <label class="f">Afterpay text (description) <input id="tAfterpayDesc" value="${esc(p.afterpayDescText ?? 'AfterPay Available')}" placeholder="AfterPay Available" /></label>
        </div>
        <p class="hint">Placeholders: <code>{brand}</code> <code>{name}</code> <code>{sku}</code> <code>{size}</code> <code>{eu}</code> <code>{colour}</code> <code>{condition}</code> <code>{afterpay}</code> (shows the matching Afterpay text above exactly as typed, only when Afterpay is on)</p>
        <p class="hint">Shipping: <code>{shippingName1}</code> <code>{shippingValue1}</code>, <code>{shippingName2}</code> <code>{shippingValue2}</code>… numbered in the order of your options under Shipping (e.g. "Nationwide courier" and "$8").</p>
      </div>
    </div>`;

  // Sub-tabs within the selected section.
  const showPanel = () => {
    $$('#subTabs button').forEach((b) => b.classList.toggle('on', b.dataset.t === subTab));
    $$('[data-panel]', box).forEach((el) => el.classList.toggle('hidden', el.dataset.panel !== subTab));
  };
  $$('#subTabs button').forEach((b) => (b.onclick = () => ((subTab = b.dataset.t), showPanel())));
  showPanel();
  showShipRefErr();

  $$('#secSeg button').forEach((b) => (b.onclick = () => ((editProfileId = b.dataset.s), renderSections())));
  // × on a section chip deletes that section (after asking).
  $$('#secSeg [data-del]').forEach(
    (x) =>
      (x.onclick = async (e) => {
        e.stopPropagation();
        const target = profiles.find((s) => s.id === x.dataset.del);
        if (!target || !(await ask({ title: `Delete "${target.name}"?`, body: 'Its category, templates and defaults go with it. This can\'t be undone.', ok: 'Delete section', danger: true }))) return;
        const rest = profiles.filter((s) => s.id !== target.id);
        persist(rest);
        if (editProfileId === target.id) editProfileId = rest[0].id;
        if (F?.accountId === defAcc && F?.profileId === target.id) F = null;
        renderSections();
      }),
  );
  $('#addSec').onclick = () => {
    const copy = { ...structuredClone(p), id: 'sec-' + Date.now(), name: 'New section', category: { number: '', path: '' } };
    profiles.push(copy);
    editProfileId = copy.id;
    persist(profiles);
    renderSections();
    $('#secName').select();
  };
  $('#delSec')?.addEventListener('click', async () => {
    if (!(await ask({ title: `Delete "${p.name}"?`, body: 'Its category, templates and defaults go with it. This can\'t be undone.', ok: 'Delete section', danger: true }))) return;
    const rest = profiles.filter((x) => x.id !== p.id);
    persist(rest);
    editProfileId = rest[0].id;
    if (F?.accountId === defAcc && F?.profileId === p.id) F = null;
    renderSections();
  });

  $('#secName').oninput = (e) => {
    p.name = e.target.value || 'Untitled';
    $(`#secSeg [data-s="${CSS.escape(p.id)}"] .sec-name`).textContent = p.name;
    save();
  };
  $('#listingType').value = p.listingType;
  $('#cond').value = p.isBrandNew ? '1' : '0';
  $('#pickup').value = p.pickup;
  $('#offers').value = p.allowOffers ? '1' : '0';
  $('#offers').onchange = (e) => ((p.allowOffers = e.target.value === '1'), save());
  // Quantity only applies to Buy Now listings; over 1, shipping is charged once per order.
  const qtyUi = () => {
    const buyNow = p.listingType === 'buynow';
    $('#qty').disabled = !buyNow;
    $('#qtyHint').textContent = !buyNow
      ? 'Quantity only applies to Buy Now listings.'
      : +p.quantity > 1
        ? `Buyers can take several in one order. Shipping is charged ${p.shipPer === 'item' ? 'per item' : 'once per order'} (change under Shipping).`
        : '';
  };
  $('#qty').oninput = (e) => {
    p.quantity = Math.min(1000, Math.max(1, Math.floor(+e.target.value) || 1));
    qtyUi();
    save();
  };
  qtyUi();
  $$('#shipPerSeg button').forEach(
    (b) =>
      (b.onclick = () => {
        p.shipPer = b.dataset.v;
        $$('#shipPerSeg button').forEach((x) => x.classList.toggle('on', x === b));
        qtyUi();
        save();
      }),
  );
  $('#listingType').onchange = (e) => ((p.listingType = e.target.value), qtyUi(), save());
  $('#dur').onchange = (e) => ((p.duration = +e.target.value), save());
  $('#cond').onchange = (e) => ((p.isBrandNew = e.target.value === '1'), save());
  $('#pickup').onchange = (e) => ((p.pickup = +e.target.value), save());
  categoryPicker($('#setCat'), p.category, (cat) => {
    p.category = cat;
    save();
    loadSecInfo();
  });

  // Extras + duration labels need the category's promotions and fee table.
  const renderSecExtras = (info) => {
    $('#dur').innerHTML = durationOptions(p.duration, info);
    $('#secExtrasBody').innerHTML = extrasHtml(p.extras, info, { perListing: false });
    const sum = () => ($('#secExtrasSum').textContent = extrasSummary(p.extras, info));
    bindExtras($('#secExtrasBody'), p.extras, () => (sum(), save()));
    sum();
  };
  const loadSecInfo = async () => {
    const info = await catInfoFor(p.category.number).catch(() => null);
    if (editProfileId === p.id && $('#secExtrasBody')) renderSecExtras(info);
  };
  renderSecExtras(null);
  loadSecInfo();
  loadSecCosts(p);

  $('#setPay').onchange = (e) => {
    e.target.closest('.chip').classList.toggle('on', e.target.checked);
    p.payment[e.target.dataset.pay] = e.target.checked;
    save();
  };

  const renderShip = () => {
    $('#ship').innerHTML = p.shipping
      .map(
        (s, i) => `<div class="ship-row"><input data-i="${i}" data-k="method" value="${esc(s.method)}" placeholder="Method e.g. Nationwide courier"/>
        <input data-i="${i}" data-k="price" type="number" step="0.01" value="${esc(s.price)}" placeholder="$"/>
        <button class="btn small danger" data-rm="${i}">×</button></div>`,
      )
      .join('');
    $$('#ship input').forEach((el) => (el.oninput = () => ((p.shipping[el.dataset.i][el.dataset.k] = el.value), save())));
    $$('#ship [data-rm]').forEach((b) => (b.onclick = () => (p.shipping.splice(+b.dataset.rm, 1), renderShip(), save())));
  };
  renderShip();
  $('#addShip').onclick = () => (p.shipping.push({ method: '', price: '' }), renderShip());

  $('#tTitle').oninput = (e) => ((p.titleTemplate = e.target.value), save());
  $('#tDesc').oninput = (e) => ((p.descriptionTemplate = e.target.value), save());
  $('#tAfterpay').oninput = (e) => ((p.afterpayText = e.target.value), save());
  $('#tAfterpayDesc').oninput = (e) => ((p.afterpayDescText = e.target.value), save());
}

/* ---------- boot ---------- */
document.addEventListener('click', (e) => {
  const nav = e.target.closest('[data-view]');
  if (nav) go(nav.dataset.view);
  const g = e.target.closest('[data-goto]');
  if (g) (e.preventDefault(), F && (editProfileId = F.profileId), g.dataset.subtab && (subTab = g.dataset.subtab), go(g.dataset.goto));
});
$('#modal').addEventListener('click', (e) => e.target.id === 'modal' && !$('#go:disabled') && closeModal());

(async () => {
  S = await api.getSettings();
  go(S.accounts.some((a) => a.env === S.env) ? 'new' : 'settings');
})();
