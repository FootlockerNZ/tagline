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
function toast(msg, ms = 2200) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove("show"), ms);
}
let modalOnClose = null;
function modal(html) {
  modalOnClose = null;
  $('#modalCard').classList.remove('ai-wide');
  delete $('#modalCard').dataset.job;
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
    <button class="btn small" id="importBtn" title="Copy one of your Trade Me listings into this form to list it again">⇩ Import listing</button>
  </div>
  <div class="grid">
    <div>
      <div class="card">
        <h2>Product</h2>
        <div class="sku-wrap" style="margin-bottom:12px">
          <input id="sku" placeholder="SKU, product name or a Trade Me listing link to import" value="${esc(F.query ?? F.sku)}" spellcheck="false" autofocus />
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
        <div style="display:flex;gap:10px;align-items:center;margin-top:10px">
          <button class="btn small" id="aiPhotoBtn" title="Put the product into this section's reference photo with AI">✨ Make AI photo</button>
          <p class="hint" style="margin:0;flex:1">First photo is the main one. Drag in your own photos too.</p>
        </div>
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
  $('#title').addEventListener('input', (e) => ((F.title = e.target.value), (F.titleDirty = true), counts(), suggestSoon()));
  $('#desc').addEventListener('input', (e) => ((F.desc = e.target.value), (F.descDirty = true), counts()));
  $('#resetText').addEventListener('click', (e) => (e.preventDefault(), (F.titleDirty = F.descDirty = false), refreshText()));
  // A Trade Me listing link pasted here imports that listing instead of looking it up as a SKU.
  const skuOrImport = (v) => {
    if (/^\s*https?:\/\/(www\.)?(trademe|tmsandbox)\.co\.nz\/\S*\d{8,12}/i.test(v)) {
      $('#sku').value = '';
      return importListing(v.trim()).catch((err) => toast(err.message));
    }
    newQuery(v);
    lookup();
  };
  // (An import re-renders the form; a typing pause from the old box mustn't then clear the new one.)
  $('#sku').addEventListener('input', debounce((e) => e.target.isConnected && skuOrImport(e.target.value), 450));
  $('#sku').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') skuOrImport(e.target.value);
  });
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

  $('#aiPhotoBtn').onclick = () => makeAiPhoto();
  $('#importBtn').onclick = () => importListingDialog();
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
  const courier = +S.courierCost || 0; // what you pay the courier per parcel (Settings)
  const tmFees = (c.successFee || 0) + (c.total || 0);
  const tiles = methods.map((k) => {
    const gross = k === 'cash' ? price : price + ship;
    const processing = PAY_FEES[k] ? Math.round(gross * PAY_FEES[k]) / 100 : 0;
    const post = k === 'cash' ? 0 : courier;
    const net = gross - processing - tmFees - post;
    const lines = [
      [k === 'cash' ? 'Price' : 'Price + shipping', money(gross)],
      processing ? [`${PAY_LABELS[k]} ${PAY_FEES[k]}%`, '−' + money(processing)] : null,
      c.successFee ? ['Success fee', '−' + money(c.successFee)] : null,
      c.total ? ['Listing fees', '−' + money(c.total)] : null,
      post ? ['Courier (you pay)', '−' + money(post)] : null,
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
// Search words from a listing title: drops [bracketed] / (bracketed) tags, sizes (US10, 8W, EU 42,
// 6Y), the SKU and separators, e.g. "Nike Dunk Low Panda - US10 [AfterPay Available]" → "Nike Dunk Low Panda".
const compWords = (title, sku = F?.sku) =>
  String(title || '')
    .replace(/\[[^\]]*\]|\([^)]*\)/g, ' ')
    .replace(/\b(?:US|UK|EU|CM)\s?\d{1,2}(?:\.\d)?(?:\s?\d\/\d)?\s?[WYC]?\b/gi, ' ')
    .replace(/\b\d{1,2}(?:\.5)?[WYC]\b/gi, ' ')
    .replace(new RegExp(String(sku || '').trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') || '(?!)', 'gi'), ' ')
    .replace(/\s[-|·/]\s/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim() +
  // Keep kids' sizing as a hint so kids' comps still count ("… (GS) 6Y" → "… GS").
  (/\b(GS|PS|TD)\b|\b\d{1,2}(\.5)?\s?[YC]\b/i.test(String(title || '')) ? ' GS' : '');
const suggestSoon = debounce(() => loadSuggest(), 600);
async function loadSuggest() {
  if (!F || current !== 'new' || !F.accountId) return;
  const skuNow = String(F.sku || '').trim().toUpperCase();
  // Similar listings are searched by your listing title (minus size, [AfterPay…] tags and the SKU),
  // falling back to Model / name while the title is empty.
  const words = compWords(F.title) || F.name;
  const key = [F.accountId, skuNow, words, F.condition].join('|');
  if (!skuNow && !words) return (F.suggest = null), renderSuggest();
  if (F.suggest?.key === key) return;
  F.suggest = { key, loading: true };
  renderSuggest();
  try {
    const r = await api.priceComps({ accountId: F.accountId, sku: skuNow, name: words, brand: brandName(), isNew: F.condition === 'new' });
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
    ${matchHtml(s)}
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
  bindMatch(box, s);
}

/* lowest exact match (AI) */
// The AI checks the similar listings (titles + photos) and keeps only true matches of this product;
// the cheapest one is the price to beat. Options: same size only, and (when this listing offers
// Afterpay) whether to compare against Afterpay listings only.
const MATCH = { sameSize: true, afterpay: 'any' }; // afterpay: 'any' | 'only' | 'none'
function matchHtml(s) {
  const m = F.match?.key === s.key ? F.match : null;
  const size = sizeText(F.size);
  const opts = `
    <div class="match-opts">
      ${size ? `<label class="ai-auto" style="margin:0;padding:6px 10px"><input type="checkbox" id="mSize" ${MATCH.sameSize ? 'checked' : ''}/><span>Size ${esc(size)} only</span></label>` : ''}
      ${F.payment.afterpay ? `<div class="seg" id="mAp">${[['any', 'Any listing'], ['only', 'With Afterpay'], ['none', 'Without Afterpay']].map(([v, l]) => `<button data-v="${v}" class="${MATCH.afterpay === v ? 'on' : ''}">${l}</button>`).join('')}</div>` : ''}
      <button class="btn small" id="mGo" ${m?.loading ? 'disabled' : ''}>${m?.loading ? 'Checking with AI…' : m?.results ? '↻ Check again' : '🔎 Find lowest exact match'}</button>
    </div>`;
  if (!m || m.loading) return `<div class="match">${opts}${m?.loading ? '<p class="hint">Comparing titles and photos of ' + m.count + ' listings…</p>' : '<p class="hint" style="margin:6px 0 0">Uses AI (your OpenAI key, about 4c a check) to keep only listings that are exactly this product, then shows the cheapest.</p>'}</div>`;
  if (m.error) return `<div class="match">${opts}<p class="hint" style="color:var(--red)">${esc(m.error)}</p></div>`;
  const list = matchList(s, m);
  const best = list[0];
  const under = best ? Math.max(1, Math.round(best.price - 10)) : null;
  return `<div class="match">${opts}
    ${
      best
        ? `<div class="match-best">
            ${best.picture ? `<img src="${esc(best.picture)}" alt=""/>` : ''}
            <div><span>Lowest exact match</span><b>${money(best.price)}</b><small>${esc(best.title)}${best.size ? ` · ${esc(best.size)}` : ''} · ${best.afterpay ? 'Afterpay' : 'no Afterpay'}</small></div>
            <div class="match-acts"><button class="btn small primary" data-use="${under}">Use $${under}</button><a href="#" data-url="${esc(best.url)}">Open</a></div>
          </div>
          ${list.length > 1 ? `<details class="extras comps"><summary>${list.length} exact matches</summary><div class="list">${list.map((c) => `<a href="#" class="comp" data-url="${esc(c.url)}">${c.picture ? `<img src="${esc(c.picture)}" alt=""/>` : '<span class="rl-noimg"></span>'}<span class="comp-title">${esc(c.title)}${c.afterpay ? ' <i class="pay-tag p64">Afterpay</i>' : ''}</span>${c.size ? `<i class="size-tag">${esc(c.size)}</i>` : ''}<b>${money(c.price)}</b></a>`).join('')}</div></details>` : ''}`
        : `<p class="hint">No exact matches${MATCH.sameSize && size ? ` in size ${esc(size)}` : ''}${MATCH.afterpay === 'only' ? ' with Afterpay' : MATCH.afterpay === 'none' ? ' without Afterpay' : ''} among ${m.checked} similar listings.</p>`
    }
  </div>`;
}
// The AI's matches, filtered by your size/Afterpay choices, cheapest first.
function matchList(s, m) {
  const ok = new Map(m.results.filter((r) => r.match).map((r) => [r.id, r]));
  return s.comps
    .filter((c) => ok.has(c.id))
    .filter((c) => !(MATCH.sameSize && sizeText(F.size)) || ok.get(c.id).sameSize !== false)
    .filter((c) => !F.payment.afterpay || MATCH.afterpay === 'any' || (MATCH.afterpay === 'only' ? c.afterpay : !c.afterpay))
    .sort((a, b) => a.price - b.price);
}
function bindMatch(box, s) {
  $('#mSize', box)?.addEventListener('change', (e) => ((MATCH.sameSize = e.target.checked), renderSuggest()));
  $$('#mAp button', box).forEach((b) => (b.onclick = () => ((MATCH.afterpay = b.dataset.v), renderSuggest())));
  $$('.match [data-url]', box).forEach((a) => (a.onclick = (e) => (e.preventDefault(), api.openExternal(a.dataset.url))));
  $('#mGo', box)?.addEventListener('click', () => runMatch(s));
}
async function runMatch(s) {
  const form = F;
  // The 40 cheapest candidates are plenty for finding the lowest true match.
  const comps = [...s.comps].sort((a, b) => a.price - b.price).slice(0, 40);
  F.match = { key: s.key, loading: true, count: comps.length };
  renderSuggest();
  const photo = F.images.find((i) => i.status === 'ok' && !i.ai);
  try {
    const r = await api.findMatches({
      product: { title: F.title, brand: brandName(), name: F.name, sku: F.sku, colour: F.colour, size: sizeText(F.size), condition: F.condition === 'new' ? 'Brand new' : 'Used', image: photo ? await toJpeg(photo.src, 512) : '' },
      comps: comps.map((c) => ({ id: c.id, title: c.title, price: c.price, picture: c.picture, size: c.size })),
    });
    if (F !== form) return;
    F.match = { key: s.key, results: r.results, checked: comps.length };
  } catch (err) {
    if (F !== form) return;
    F.match = { key: s.key, error: err.message };
  }
  renderSuggest();
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
  box.ondragover = (e) => {
    e.preventDefault();
    if (!DRAG) drop.classList.add('over');
  };
  box.ondragleave = () => drop.classList.remove('over');
  box.ondrop = (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    if (!DRAG && e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
  };
  sortable(box, '[data-id]', (from, to, after) => {
    const idx = (el) => F.images.findIndex((i) => i.id === +el.dataset.id);
    moveItem(F.images, idx(from), idx(to), after);
    renderImages();
  });
}

// Drag photo tiles to reorder them. The tile being dragged is tracked here rather than in the drag
// data, so it's never mistaken for a photo file dropped in from outside (which adds a new photo).
let DRAG = null;
function sortable(box, sel, onMove) {
  const clear = () => $$('.drop-before, .drop-after', box).forEach((x) => x.classList.remove('drop-before', 'drop-after'));
  const isAfter = (t, e) => {
    const r = t.getBoundingClientRect();
    return e.clientX > r.left + r.width / 2;
  };
  $$(sel, box).forEach((t) => {
    t.draggable = true;
    $$('img', t).forEach((i) => (i.draggable = false));
    t.addEventListener('dragstart', (e) => {
      DRAG = { box, el: t };
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', '');
      requestAnimationFrame(() => t.classList.add('dragging'));
    });
    t.addEventListener('dragend', () => {
      DRAG = null;
      t.classList.remove('dragging');
      clear();
    });
    t.addEventListener('dragover', (e) => {
      if (DRAG?.box !== box) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      clear();
      if (t !== DRAG.el) t.classList.add(isAfter(t, e) ? 'drop-after' : 'drop-before');
    });
    t.addEventListener('drop', (e) => {
      if (DRAG?.box !== box) return;
      e.preventDefault();
      e.stopPropagation();
      const from = DRAG.el;
      DRAG = null;
      clear();
      if (from !== t) onMove(from, t, isAfter(t, e));
    });
  });
}
// Moves arr[from] to just before (or after) what is at arr[to].
function moveItem(arr, from, to, after) {
  if (from < 0 || to < 0 || from === to) return;
  const [m] = arr.splice(from, 1);
  arr.splice(to - (from < to ? 1 : 0) + (after ? 1 : 0), 0, m);
}

/* Photo viewer */
// Click a photo (AI review, Edit photos, New listing photos) to see it full screen. Click the photo to
// zoom to full size and drag/scroll around; ← → step through the set; Esc or the background closes.
function openViewer(srcs, start = 0) {
  let i = start;
  let zoom = false;
  const v = document.createElement('div');
  v.className = 'viewer';
  document.body.append(v);
  const draw = () => {
    v.classList.toggle('zoomed', zoom);
    v.innerHTML = `
      <div class="viewer-stage"><img src="${esc(srcs[i])}" alt="" draggable="false" /></div>
      <div class="viewer-bar">
        ${srcs.length > 1 ? `<button data-v="prev">‹</button><span>${i + 1} / ${srcs.length}</span><button data-v="next">›</button>` : ''}
        <span class="viewer-hint">${zoom ? 'Drag or scroll to look around · click to fit' : 'Click the photo to zoom'}</span>
        <button data-v="close">✕</button>
      </div>`;
    const stage = $('.viewer-stage', v);
    const img = $('img', v);
    img.onclick = (e) => {
      e.stopPropagation();
      if (dragged) return;
      // Zoom in around the clicked point.
      const r = img.getBoundingClientRect();
      const fx = (e.clientX - r.left) / r.width, fy = (e.clientY - r.top) / r.height;
      zoom = !zoom;
      draw();
      if (zoom) {
        const s = $('.viewer-stage', v), im = $('img', v);
        const go = () => {
          // At least 2.5× the fitted size, or the photo's real size if that's bigger (small photos still zoom).
          const w = Math.max(im.naturalWidth, r.width * 2.5);
          im.style.width = `${Math.round(w)}px`;
          s.scrollLeft = fx * im.offsetWidth - s.clientWidth / 2;
          s.scrollTop = fy * im.offsetHeight - s.clientHeight / 2;
        };
        im.complete ? go() : (im.onload = go);
      }
    };
    stage.onclick = (e) => e.target === stage && close();
    // Drag to pan when zoomed.
    let dragged = false;
    stage.onmousedown = (e) => {
      if (!zoom) return;
      dragged = false;
      const sx = e.clientX, sy = e.clientY, sl = stage.scrollLeft, stp = stage.scrollTop;
      const move = (m) => {
        if (Math.abs(m.clientX - sx) + Math.abs(m.clientY - sy) > 4) dragged = true;
        stage.scrollLeft = sl - (m.clientX - sx);
        stage.scrollTop = stp - (m.clientY - sy);
      };
      const up = () => (removeEventListener('mousemove', move), removeEventListener('mouseup', up), setTimeout(() => (dragged = false)));
      addEventListener('mousemove', move);
      addEventListener('mouseup', up);
    };
    $$('[data-v]', v).forEach((b) => (b.onclick = (e) => (e.stopPropagation(), act(b.dataset.v))));
  };
  const act = (a) => {
    if (a === 'close') return close();
    i = (i + (a === 'next' ? 1 : -1) + srcs.length) % srcs.length;
    zoom = false;
    draw();
  };
  const key = (e) => {
    if (e.key === 'Escape') (e.stopPropagation(), close());
    else if (e.key === 'ArrowRight' && srcs.length > 1) act('next');
    else if (e.key === 'ArrowLeft' && srcs.length > 1) act('prev');
  };
  const close = () => (v.remove(), removeEventListener('keydown', key, true));
  addEventListener('keydown', key, true);
  draw();
}
// Any photo inside these areas opens the viewer with its siblings (uses data-full when there's a bigger version).
document.addEventListener('click', (e) => {
  const img = e.target.closest('.ai-compare img, #lpImgs .img img, #images .img img, .ai-ref-img img');
  if (!img || e.target.closest('button')) return;
  const group = [...img.closest('.ai-compare, #lpImgs, #images, .ai-ref-img').querySelectorAll('.ai-compare img, .img img, .ai-ref-img img')].filter((x) => x.closest('.ai-compare, #lpImgs, #images, .ai-ref-img') === img.closest('.ai-compare, #lpImgs, #images, .ai-ref-img'));
  openViewer(group.map((x) => x.dataset.full || x.src), Math.max(0, group.indexOf(img)));
});

// Thumbnails in lists (Live, Sold, Relist, History, Questions, price comparisons…) open the viewer too,
// at Trade Me's full size. Runs before the row's own click (open link / tick checkbox).
const fullSize = (src) => String(src || '').replace(/\/photoserver\/(?:thumb|lv2|med|gv|tq|list|plus)\//, '/photoserver/full/');
const THUMBS = '.sold-row > img, .rl-row > img, .comp img, .match-best img, .q-head img, .hero img, .dp-row img, .h-row > img';
document.addEventListener(
  'click',
  (e) => {
    const img = e.target.closest?.(THUMBS);
    if (!img || !img.src) return;
    e.preventDefault();
    e.stopPropagation();
    const box = img.closest('.rl-table, .list, .match, .dp-list, .modal-card, #view') || document;
    const group = [...box.querySelectorAll(THUMBS)].filter((x) => x.src);
    openViewer(group.map((x) => fullSize(x.dataset.full || x.src)), Math.max(0, group.indexOf(img)));
  },
  true,
);

/* AI hero photo */
// Puts the listing's product photo (the first non-AI photo) into the section's reference scene,
// then shows it next to the original to approve before it becomes the main photo.
async function makeAiPhoto() {
  const sec = P();
  const product = F.images.find((i) => i.status === 'ok' && !i.ai);
  const problem = !S.openai?.hasKey
    ? 'Add your OpenAI API key in Settings → AI photos first.'
    : !sec.aiRef
      ? `The "${sec.name}" section has no reference photo yet. Add one under Defaults → ${sec.name} → AI photo.`
      : '';
  if (problem) return toast(problem);
  const form = F;
  const choices = F.images.filter((i) => i.status === 'ok' && !i.ai);
  const p = await pickAiSource(choices.map((i) => i.src));
  if (!p) return;
  const vars = aiVars(sec, { brand: brandName(), name: F.name, colour: F.colour, sku: F.sku });
  runAiPhoto(sec, p.src ?? choices[p.index].src, vars, {
    kind: 'new',
    afterpay: !!F.payment.afterpay,
    label: [brandName(), F.name].filter(Boolean).join(' ') || 'New listing',
    // Auto-approve only drops it into the form it was made for; otherwise it waits for review.
    autoUse: (dataUrl) => {
      if (F !== form) throw new Error("you'd moved on to another listing, so it wasn't added. Review it to add it to the one you're on now.");
      return addAiImage(dataUrl);
    },
  });
}
// Choose which photo the AI works from. srcs: the listing's photos. You can also add another photo
// (file, drag-in or URL) just for the AI: it's used as the source but never added to the listing.
// Resolves to { index } for a listing photo, { src } for an added one, or null if cancelled
// (onCancel runs then, e.g. to reopen the screen you came from).
function pickAiSource(srcs, { title = 'Which photo should the AI use?', go = 'Make AI photo', onCancel } = {}) {
  return new Promise((resolve) => {
    const extra = []; // photos added here, AI-only
    let pick = srcs.length ? { index: 0 } : null;
    const key = (p) => (p ? (p.src ? `x${extra.indexOf(p.src)}` : `l${p.index}`) : '');
    const card = modal('');
    card.classList.add('ai-wide');
    const draw = () => {
      card.innerHTML = `
        <h3>${esc(title)}</h3>
        <p class="hint" style="margin:-6px 0 14px">Pick the clearest product shot: the AI copies this item into your section's setup photo. Front-on, sharp and uncropped works best.</p>
        <div class="ai-pick" id="apGrid">
          ${srcs.map((s, i) => `<button class="${key(pick) === `l${i}` ? 'on' : ''}" data-k="l${i}"><img src="${esc(s)}" alt=""/></button>`).join('')}
          ${extra.map((s, i) => `<button class="${key(pick) === `x${i}` ? 'on' : ''}" data-k="x${i}"><img src="${esc(s)}" alt=""/><span class="ai-pick-tag">AI only</span></button>`).join('')}
          <button class="ai-pick-add" id="apAdd">＋<br/>Use another photo<br/><small>file or drop here</small></button>
        </div>
        <input type="file" id="apFile" accept="image/*" hidden />
        <div class="row" style="margin-top:10px"><input id="apUrl" placeholder="…or paste an image URL and press Enter" /></div>
        <p class="hint">Photos added here are only used to make the AI photo; they don't go on the listing.</p>
        <p class="hint" id="apMsg" style="color:var(--red)"></p>
        <div class="actions"><button class="btn ghost" id="cancel">Cancel</button><button class="btn primary" id="go" ${pick ? '' : 'disabled'}>${esc(go)}</button></div>`;
      const choose = (k) => (k[0] === 'l' ? { index: +k.slice(1) } : { src: extra[+k.slice(1)] });
      $$('[data-k]', card).forEach((b) => {
        b.onclick = () => ((pick = choose(b.dataset.k)), draw());
        b.ondblclick = () => resolve(choose(b.dataset.k));
      });
      const add = async (raw) => {
        try {
          extra.push(await toJpeg(raw));
          pick = { src: extra.at(-1) };
          draw();
        } catch (err) {
          $('#apMsg', card).textContent = `Couldn't use that image: ${err.message}`;
        }
      };
      const addFiles = (files) => {
        const f = [...files].find((x) => x.type.startsWith('image/'));
        if (!f) return;
        const r = new FileReader();
        r.onload = () => add(r.result);
        r.readAsDataURL(f);
      };
      $('#apAdd', card).onclick = () => $('#apFile', card).click();
      $('#apFile', card).onchange = (e) => addFiles(e.target.files);
      const grid = $('#apGrid', card);
      grid.ondragover = (e) => e.preventDefault();
      grid.ondrop = (e) => (e.preventDefault(), addFiles(e.dataTransfer.files));
      $('#apUrl', card).onkeydown = async (e) => {
        if (e.key !== 'Enter' || !e.target.value.trim()) return;
        $('#apMsg', card).textContent = 'Loading…';
        try {
          await add(await api.fetchImage(e.target.value.trim()));
        } catch (err) {
          $('#apMsg', card).textContent = `Couldn't load that URL: ${err.message}`;
        }
      };
      $('#cancel', card).onclick = () => (onCancel ? onCancel() : closeModal(), resolve(null));
      $('#go', card).onclick = () => pick && resolve(pick);
    };
    draw();
  });
}
// The AI photo pieces a listing needs, or why it can't have one: { sec, product } | { problem }.
function aiReady() {
  const sec = P();
  const product = F.images.find((i) => i.status === 'ok' && !i.ai);
  if (!S.openai?.hasKey) return { problem: 'Add your OpenAI API key in Settings → AI photos first.' };
  if (!sec.aiRef) return { problem: `The "${sec.name}" section has no reference photo yet (Defaults → ${sec.name} → AI photo).` };
  if (!product) return { problem: 'Add a product photo first; the AI photo is made from it.' };
  return { sec, product };
}
// Placeholder values for the AI prompt.
const aiVars = (sec, { brand = '', name = '', colour = '', sku = '' } = {}) => ({
  product: [brand, name].filter(Boolean).join(' ') || 'the product',
  brand: brand || '',
  name: name || '',
  colour: colour || '',
  sku: sku || '',
  category: sec.aiCategory?.trim() || String(sec.category?.path || '').split('›').pop().trim().toLowerCase() || 'item',
  section: sec.name || '',
});
// AI photo jobs. Each is generate → side-by-side review → use. You can watch one, or send it to the
// background (the AI photos tab in the sidebar) and review it later. Several can run at once.
// Jobs are saved to disk, so finished photos (and queued listings) are still there after a restart.
//
// kind says what "use" means, so it still works after a restart:
//   new   – add to the New listing form that's open
//   live  – save as the main photo of a live listing (payload: { accountId, listingId })
//   queue – list a new listing with this photo first (payload: { accountId, listing, photos, thumb })
// In-session callers can pass their own opts (onUse/autoUse/onBack) that override these.
const AI_JOBS = [];
const newJobId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const jobSnapshot = (j) => ({
  id: j.id, kind: j.kind, payload: j.payload, label: j.label, status: j.status, error: j.error, res: j.res, started: j.started,
  sec: j.sec && { id: j.sec.id, name: j.sec.name, aiRef: j.sec.aiRef, aiCategory: j.sec.aiCategory, category: j.sec.category },
  productSrc: j.productSrc, vars: j.vars, afterpay: j.afterpay,
});
const persistJob = (j) => api.aiJobSave(jobSnapshot(j)).catch(() => {});

function kindOpts(job) {
  if (job.kind === 'live')
    return {
      useLabel: 'Use as main photo (saves to Trade Me)',
      onUse: async (dataUrl) => {
        await saveAiToListing(job.payload, dataUrl);
        toast(`AI photo saved: ${job.label}`);
      },
    };
  if (job.kind === 'queue')
    return {
      useLabel: 'Use as main photo & list',
      altLabel: 'List without AI photo',
      onUse: (dataUrl) => listQueued(job, dataUrl),
      onAlt: () => listQueued(job, null),
    };
  return {
    useLabel: current === 'new' && F ? 'Add to current listing' : 'Use as main photo',
    onUse: (dataUrl) => {
      if (!F) F = freshForm();
      addAiImage(dataUrl);
      if (current !== 'new') toast('AI photo added to your new listing');
    },
  };
}

// Afterpay logo (Settings → AI photos): drawn onto the finished AI photo, centred in the empty space
// between the top of the photo and the top of the product. The product's top edge is the first row
// (3 in a row, to ignore specks) that differs from that row's own background at the left/right edges.
const loadImg = (src) =>
  new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => rej(new Error("Couldn't load the image."));
    i.src = src;
  });
const hasAfterpay = (methods) => [].concat(methods || []).some((m) => +m === 64);
async function addAfterpayLogo(dataUrl) {
  const [img, logo] = await Promise.all([loadImg(dataUrl), loadImg('afterpay-logo.png')]);
  const W = img.naturalWidth;
  const H = img.naturalHeight;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const px = ctx.getImageData(0, 0, W, H).data;
  const edge = Math.max(4, Math.round(W * 0.03));
  const rowHit = (y) => {
    let r = 0, g = 0, b = 0, n = 0;
    for (const x0 of [0, W - edge])
      for (let x = x0; x < x0 + edge; x++) {
        const k = (y * W + x) * 4;
        r += px[k], g += px[k + 1], b += px[k + 2], n++;
      }
    (r /= n), (g /= n), (b /= n);
    let diff = 0, seen = 0;
    for (let x = edge; x < W - edge; x += 2, seen++) {
      const k = (y * W + x) * 4;
      if (Math.abs(px[k] - r) + Math.abs(px[k + 1] - g) + Math.abs(px[k + 2] - b) > 60) diff++;
    }
    return diff > seen * 0.01;
  };
  let top = 0;
  for (let y = Math.round(H * 0.01); y < H * 0.7; y++) {
    if (rowHit(y) && rowHit(y + 1) && rowHit(y + 2)) {
      top = y;
      break;
    }
  }
  if (!top) top = Math.round(H * 0.22); // couldn't find the product's edge: use the top fifth
  const ratio = logo.naturalWidth / logo.naturalHeight;
  let lh = Math.min(top * 0.5, H * 0.085);
  if (lh * ratio > W * 0.42) lh = (W * 0.42) / ratio;
  lh = Math.max(lh, H * 0.04);
  const lw = lh * ratio;
  ctx.drawImage(logo, (W - lw) / 2, Math.max(H * 0.015, (top - lh) / 2), lw, lh);
  return /^data:image\/png/.test(dataUrl) ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.92);
}

function runAiPhoto(sec, productSrc, vars, opts = {}) {
  const job = {
    id: newJobId(), kind: opts.kind || 'new', payload: opts.payload || null, sec, productSrc, vars, afterpay: !!opts.afterpay,
    label: opts.label || vars.name || vars.product, status: 'running', started: Date.now(), bg: !!opts.background,
  };
  job.opts = { ...kindOpts(job), ...opts };
  AI_JOBS.push(job);
  persistJob(job);
  if (!opts.background) watchAiJob(job);
  renderAiTray();
  return generateJob(job);
}
// Resolves when the job has finished (made, failed, or auto-applied); used to pace bulk runs.
function generateJob(job) {
  const { opts } = job;
  return api
    .aiGenerate({ refFile: job.sec.aiRef, productDataUrl: job.productSrc, vars: job.vars })
    .then(async (res) => {
      if (job.afterpay && S.ai?.afterpayLogo) {
        try {
          res.dataUrl = await addAfterpayLogo(res.dataUrl);
        } catch (err) {
          console.warn('[afterpay logo]', err);
        }
      }
      job.status = 'done';
      job.res = res;
      api.getSettings().then((s) => (S = s)).catch(() => {}); // picks up the updated cost averages
    })
    .catch((err) => {
      job.status = 'error';
      job.error = err.message;
    })
    .finally(async () => {
      persistJob(job);
      // Auto-approve (Settings → AI photos): use it straight away, no review.
      const auto = opts.autoUse || (job.kind !== 'new' ? opts.onUse : null);
      if (job.status === 'done' && S.ai?.autoApprove && auto && !opts.stale?.()) {
        if (isWatching(job)) closeModal();
        try {
          await auto(job.res.dataUrl);
          dropAiJob(job);
          toast(job.kind === 'queue' ? `Listed with AI photo: ${job.payload?.listing?.Title || job.label}` : `AI photo added: ${job.label}`);
        } catch (err) {
          job.useError = err.message;
          job.bg = true;
          renderAiTray();
          toast(`AI photo made, but couldn't use it: ${err.message}`);
        }
        return;
      }
      if (isWatching(job)) return reviewAiJob(job);
      job.bg = true;
      renderAiTray();
      if (!opts.quiet) toast(job.status === 'done' ? `AI photo ready: ${job.label}` : `AI photo failed: ${job.label}`);
    });
}
const isWatching = (job) => !$('#modal').classList.contains('hidden') && $('#modalCard').dataset.job === String(job.id);
function watchAiJob(job) {
  const card = modal(`<h3>Making AI photo…</h3><p class="hint">${esc(job.label)} · using the "${esc(job.sec.name)}" reference photo. This takes about 45 seconds.</p><div class="empty"><div class="spinner" style="margin:auto"></div></div>
    <div class="actions"><button class="btn primary" id="bg">Run in background</button></div>`);
  card.classList.add('ai-wide');
  card.dataset.job = job.id;
  $('#bg').onclick = () => {
    job.bg = true;
    closeModal();
    renderAiTray();
  };
}
function dropAiJob(job) {
  const i = AI_JOBS.indexOf(job);
  if (i >= 0) AI_JOBS.splice(i, 1);
  api.aiJobDelete(job.id).catch(() => {});
  renderAiTray();
}
function retryAiJob(job) {
  job.status = 'running';
  job.error = job.res = job.useError = undefined;
  job.bg = false;
  persistJob(job);
  watchAiJob(job);
  renderAiTray();
  generateJob(job);
}
function reviewAiJob(job) {
  if (!job) return;
  if (job.status === 'running') return watchAiJob(job);
  const { opts } = job;
  // Reviewing from the tab: Discard just closes, rather than reopening the screen it came from.
  const back = () => (opts.onBack && !job.bg ? opts.onBack() : closeModal());
  if (job.status === 'error') {
    modal(`<h3>Couldn't make the AI photo</h3><p class="hint">${esc(job.label)}</p><p style="color:var(--red)">${esc(job.error)}</p>
      <div class="actions"><button class="btn ghost" id="cancel">Dismiss</button>${opts.onAlt ? `<button class="btn" id="alt">${esc(opts.altLabel)}</button>` : ''}${job.sec ? '<button class="btn primary" id="go">Try again</button>' : ''}</div>`);
    $('#cancel').onclick = () => (dropAiJob(job), back());
    $('#go')?.addEventListener('click', () => retryAiJob(job));
    $('#alt')?.addEventListener('click', () => useJob(job, opts.onAlt));
    return;
  }
  const blocked = opts.stale?.() ? opts.staleMsg || "This photo's listing isn't open any more." : '';
  const res = job.res;
  const card = modal(`
    <h3>${job.kind === 'queue' ? 'Use this AI photo and list?' : 'Use this AI photo?'}</h3>
    <p class="hint" style="margin-top:-6px">${esc(job.label)}</p>
    <div class="ai-compare">
      <figure><img src="${job.productSrc}" alt=""/><figcaption>Product photo</figcaption></figure>
      <figure><img src="${res.dataUrl}" alt=""/><figcaption>AI photo · ${esc(res.model)}${res.cost != null ? ` · cost about US$${res.cost.toFixed(3)}` : ''}</figcaption></figure>
    </div>
    <p class="hint">Check the details match the real item (logos, text, colours, which side things are printed on) before using it. Your product photo stays in the listing too.</p>
    ${job.useError ? `<p class="hint" style="color:var(--red)">Last try: ${esc(job.useError)}</p>` : ''}
    ${blocked ? `<p class="hint" style="color:var(--red)">${esc(blocked)}</p>` : ''}
    <p class="hint" id="useMsg" style="color:var(--red)"></p>
    <div class="actions"><button class="btn ghost" id="cancel">Discard</button><button class="btn ghost" id="later">Later</button><button class="btn" id="again">Try again</button>${opts.onAlt ? `<button class="btn" id="alt">${esc(opts.altLabel)}</button>` : ''}<button class="btn primary" id="go" ${blocked ? 'disabled' : ''}>${esc(opts.useLabel || 'Use as main photo')}</button></div>`);
  card.classList.add('ai-wide');
  $('#cancel').onclick = () => (dropAiJob(job), back());
  $('#later').onclick = () => (closeModal(), renderAiTray());
  $('#again').onclick = () => retryAiJob(job);
  $('#alt')?.addEventListener('click', () => useJob(job, opts.onAlt));
  $('#go').onclick = () => useJob(job, opts.onUse, res.dataUrl);
}
// Runs a use action; the job only leaves the queue once it worked.
async function useJob(job, fn, dataUrl) {
  $$('#modalCard .actions button').forEach((b) => (b.disabled = true));
  const go = $('#go');
  if (go) go.textContent = job.kind === 'queue' ? 'Listing…' : 'Saving…';
  try {
    await fn(dataUrl);
    dropAiJob(job);
    if (!$('#modal').classList.contains('hidden') && $('#modalCard').contains(go)) closeModal();
  } catch (err) {
    job.useError = err.message;
    if ($('#useMsg')) $('#useMsg').textContent = err.message;
    $$('#modalCard .actions button').forEach((b) => (b.disabled = false));
    if (go) go.textContent = job.opts.useLabel || 'Use as main photo';
  }
}
// Saves an AI photo in front of a live listing's current photos (re-read at save time).
async function saveAiToListing({ accountId, listingId }, dataUrl) {
  const fresh = await api.getListing({ accountId, listingId });
  const keep = (fresh.PhotoIds || []).slice(0, 19).map((id) => ({ id }));
  await api.saveListingPhotos({ accountId, listingId, photos: [{ base64: (await toJpeg(dataUrl)).split(',')[1] }, ...keep] });
  dataChanged('live');
}
// Lists a queued new listing: the AI photo (if any) first, then the photos it was queued with.
async function listQueued(job, dataUrl) {
  const p = job.payload;
  const photos = [...(dataUrl ? [await toJpeg(dataUrl)] : []), ...p.photos];
  const r = await api.submit({
    accountId: p.accountId,
    listing: p.listing,
    photos: photos.map((src, n) => ({ base64: src.split(',')[1], fileName: `${p.listing.SKU || 'photo'}-${n + 1}.jpg` })),
    meta: { thumb: await toJpeg(photos[0], 160) },
  });
  S = await api.getSettings();
  dataChanged('live');
  toast(`Listed #${r.listingId}: ${p.listing.Title}`);
}
// Brings back saved jobs after a restart. Ones that were still generating come back as interrupted.
async function restoreAiJobs() {
  const saved = await api.aiJobsLoad().catch(() => []);
  for (const j of saved) {
    if (AI_JOBS.some((x) => x.id === j.id)) continue;
    const job = { ...j, bg: true };
    if (job.status === 'running') {
      job.status = 'error';
      job.error = 'Interrupted: Tagline was closed while this was being made.';
      persistJob(job);
    }
    job.opts = kindOpts(job);
    AI_JOBS.push(job);
  }
  renderAiTray();
}
// "AI photos" tab at the bottom of the sidebar; click it for the list of jobs.
let aiTrayOpen = false;
function renderAiTray() {
  const tab = $('#aiTab');
  const running = AI_JOBS.filter((j) => j.status === 'running').length;
  api.aiRunning(running).catch(() => {}); // so closing the app can warn while photos are generating
  const ready = AI_JOBS.filter((j) => j.status === 'done').length;
  const failed = AI_JOBS.filter((j) => j.status === 'error').length;
  tab.hidden = !AI_JOBS.length;
  tab.classList.toggle('has-ready', !!ready);
  tab.innerHTML = `${running ? '<div class="spinner small"></div>' : '<span>✨</span>'}<div><b>AI photos</b><small>${[running && `${running} making`, ready && `${ready} ready`, failed && `${failed} failed`].filter(Boolean).join(' · ')}</small></div>`;
  tab.onclick = (e) => {
    e.stopPropagation();
    aiTrayOpen = !aiTrayOpen;
    renderAiTray();
  };
  let tray = $('#aiTray');
  if (!tray) {
    tray = document.createElement('div');
    tray.id = 'aiTray';
    tray.onclick = (e) => e.stopPropagation();
    document.body.append(tray);
    document.addEventListener('click', () => aiTrayOpen && ((aiTrayOpen = false), renderAiTray()));
  }
  if (!AI_JOBS.length) aiTrayOpen = false;
  tray.hidden = !aiTrayOpen;
  tray.innerHTML = AI_JOBS.map(
    (j) => `<div class="ai-job ${j.status}">
      ${j.status === 'running' ? '<div class="spinner small"></div>' : j.status === 'done' ? '<span class="ai-dot ok">✓</span>' : '<span class="ai-dot err">!</span>'}
      <div class="ai-job-text"><b>${esc(j.label)}</b><small>${j.status === 'running' ? 'Making AI photo…' : j.status === 'done' ? (j.useError ? "Made, but couldn't be used" : j.kind === 'queue' ? 'Ready: review to list' : 'Ready to review') : 'Failed'}</small></div>
      <button class="btn small ${j.status === 'done' ? 'primary' : ''}" data-job="${j.id}">${j.status === 'running' ? 'View' : j.status === 'done' ? 'Review' : 'Details'}</button>
    </div>`,
  ).join('');
  $$('#aiTray [data-job]').forEach(
    (b) =>
      (b.onclick = () => {
        aiTrayOpen = false;
        renderAiTray();
        reviewAiJob(AI_JOBS.find((j) => String(j.id) === b.dataset.job));
      }),
  );
}
async function addAiImage(dataUrl) {
  const img = { id: ++imgId, status: 'loading', label: 'AI', ai: true };
  F.images.unshift(img);
  renderImages();
  try {
    img.src = await toJpeg(dataUrl);
    img.status = 'ok';
  } catch (err) {
    img.status = 'error';
    img.error = err.message;
  }
  renderImages();
}

/* import a listing */
// Copies one of your Trade Me listings (live, ended, or made outside the app / on Trade Me's older
// system) into the New listing form: title, description, category, price, condition, quantity, SKU,
// category details and photos. Shipping, payment and extras come from the current section as usual.
function importListingDialog(ref = '') {
  const card = modal(`
    <h3>Import a listing</h3>
    <p class="hint modal-sub">Paste the listing number or its Trade Me link. It's copied into the New listing form so you can check it and list it again through Tagline.</p>
    <label class="f">Listing # or link <input id="impRef" value="${esc(ref)}" placeholder="e.g. 6217932906 or https://www.trademe.co.nz/a/listing/6217932906" /></label>
    <p class="hint" id="impMsg" style="color:var(--red)"></p>
    <div class="actions"><button class="btn ghost" id="cancel">Cancel</button><button class="btn primary" id="go">Import</button></div>`);
  const go = async () => {
    const v = $('#impRef', card).value.trim();
    if (!v) return;
    $('#go', card).disabled = true;
    $('#go', card).textContent = 'Importing…';
    try {
      await importListing(v);
      closeModal();
    } catch (err) {
      $('#impMsg', card).textContent = err.message;
      $('#go', card).disabled = false;
      $('#go', card).textContent = 'Import';
    }
  };
  // Braces matter: an on* handler that returns false cancels the key, which would block typing.
  $('#impRef', card).onkeydown = (e) => {
    if (e.key === 'Enter') go();
  };
  $('#cancel', card).onclick = closeModal;
  $('#go', card).onclick = go;
  setTimeout(() => $('#impRef', card)?.focus());
}
async function importListing(ref, accountId) {
  if (!F) F = freshForm();
  const d = await api.importListing({ accountId: accountId || F.accountId, ref });
  // A section whose category matches fits best (its templates/shipping/payment); otherwise stay put.
  const sec = profList(accountId || F.accountId).find((s) => s.category?.number === d.category.number);
  const keep = { accountId: accountId || F.accountId };
  F = { ...freshForm(sec?.id || F.profileId, keep.accountId), ...keep };
  Object.assign(F, {
    query: d.sku || '',
    sku: d.sku || '',
    name: d.title,
    title: d.title.slice(0, 80),
    titleDirty: true,
    desc: d.body,
    descDirty: true,
    condition: d.isNew ? 'new' : 'used',
    category: d.category.number ? d.category : F.category,
    type: d.buyNowOnly ? 'buynow' : 'auction',
    price: d.buyNowOnly ? String(d.buyNow) : '',
    start: d.buyNowOnly ? '' : String(d.start || ''),
    buyNow: d.buyNowOnly ? '' : String(d.buyNow || ''),
    reserve: d.reserve ? String(d.reserve) : '',
    quantity: d.quantity || 1,
    imported: { listingId: d.listingId, attributes: d.attributes },
  });
  if (d.subtitle) F.extras.subtitle = d.subtitle;
  go('new'); // loads the category's fields and fills them from F.imported.attributes
  d.photos.forEach((u) => addRemoteImage(u, false));
  toast(`Imported #${d.listingId}${d.mine ? '' : " (not one of this account's listings)"}. Check it, then list.`);
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
    // An imported listing's own category details win (same category only).
    for (const a of F.imported?.attributes || []) if (F.attrs.some((x) => x.name === a.name)) F.attrValues[a.name] = a.value;
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
  const ai = aiReady(); // { sec, product } when this listing can be queued for an AI photo
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
    ${ai.sec ? `<p class="hint">Or queue it: an AI hero photo is made from your first photo (about 45s) and the listing goes live ${S.ai?.autoApprove ? 'as soon as it\'s ready (auto-approve is on)' : 'once you review and OK the photo in the AI photos tab'}. You can carry on with the next listing meanwhile.</p>` : ''}
    <div class="actions"><button class="btn ghost" id="cancel">Cancel</button>${ai.sec ? `<button class="btn" id="queue">✨ List when AI photo is ready</button>` : ''}<button class="btn primary" id="go">${fees.total ? `List now · ${money(fees.total)}` : 'List now'}</button></div>`);
  $('#cancel', card).onclick = closeModal;
  // Queue: snapshot this listing, clear the form, and list it when the AI photo is used.
  $('#queue', card)?.addEventListener('click', async () => {
    const snap = {
      accountId: F.accountId,
      listing,
      photos: photos.filter((p) => !p.ai).map((p) => p.src),
    };
    const p = await pickAiSource(snap.photos, { go: 'Make AI photo & queue listing', onCancel: () => confirmList() });
    if (!p) return;
    const vars = aiVars(ai.sec, { brand: brandName(), name: F.name, colour: F.colour, sku: F.sku });
    runAiPhoto(ai.sec, p.src ?? snap.photos[p.index], vars, { kind: 'queue', payload: snap, label: `Listing: ${listing.Title}`, background: true, afterpay: hasAfterpay(listing.PaymentMethods) });
    const keep = { accountId: F.accountId, category: F.category, attrs: F.attrs, catInfo: F.catInfo, type: F.type };
    F = { ...freshForm(F.profileId, F.accountId), ...keep };
    closeModal();
    if (current === 'new') renderNew();
    toast('Queued: it lists when the AI photo is ready (see AI photos in the sidebar)');
  });
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

/* ---------- search boxes (Live, Relist, Sold) ---------- */
// Every word must appear somewhere in the row's text (title, SKU, listing #, buyer…), any order.
const searchHit = (q, ...fields) => {
  const words = String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = fields.filter((f) => f != null).join(' ').toLowerCase();
  return words.every((w) => hay.includes(w));
};
const searchBox = (id, value, placeholder) =>
  `<label class="search-box"><span>⌕</span><input id="${id}" type="search" placeholder="${esc(placeholder)}" value="${esc(value)}" spellcheck="false" /></label>`;
// Filters as you type; the page re-renders, so focus and caret go back into the box.
function bindSearch(id, set, render) {
  const box = $('#' + id);
  if (!box) return;
  box.oninput = debounce((e) => {
    set(e.target.value);
    render();
    const el = $('#' + id);
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, 200);
  // Esc clears it.
  box.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && box.value) {
      box.value = '';
      box.dispatchEvent(new Event('input'));
    }
  });
}

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
  const items = (arch ? archived : (R.items || []).filter((i) => !archive[i.listingId] && (!i.endDate || new Date(i.endDate) >= cutoff))).filter((i) =>
    searchHit(R.q, i.title, i.listingId, i.sku),
  );
  const pending = arch ? items : items.filter((i) => !R.results[i.listingId]?.ok);
  const sel = pending.filter((i) => R.selected.has(i.listingId));
  view.innerHTML = `
    <h1>Relist</h1>
    <div style="display:flex;gap:10px;align-items:center;margin-bottom:14px;flex-wrap:wrap">
      <select id="rlAcc" style="width:auto;min-width:200px">${accs.map((a) => `<option value="${a.id}" ${a.id === R.accountId ? 'selected' : ''}>${esc(a.nickname)}</option>`).join('') || '<option>No accounts</option>'}</select>
      <div class="seg" id="rlView"><button data-v="0" class="${arch ? '' : 'on'}">Unsold</button><button data-v="1" class="${arch ? 'on' : ''}">Archived (${archived.length})</button></div>
      <button class="btn" id="rlRefresh" ${R.loading || !R.accountId || arch ? 'disabled' : ''}>${R.loading ? 'Loading…' : 'Refresh'}</button>
      <span class="hint" style="margin:0">${arch ? `${items.length} archived · ${sel.length} selected` : R.items ? `${items.length} unsold · ${sel.length} selected` : ''}</span>
      ${searchBox('rlQ', R.q || '', 'Search title or #')}
      <select id="rlDays" style="width:auto" title="Trade Me only keeps unsold listings for 45 days" ${arch ? 'hidden' : ''}>
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

  bindSearch('rlQ', (v) => (R.q = v), renderRelist);
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
    verifyLowest(LIVE.items).catch(() => {});
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
  const items = (LIVE.items || []).filter((i) => searchHit(q, i.title, i.sku, i.listingId, i.nickname));
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
      ${searchBox('liveQ', LIVE.q, 'Search title, SKU or #')}
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
                    <div class="sold-row rl-head"><input type="checkbox" id="liveAll" ${sel.length && sel.length === items.length ? 'checked' : ''} ${LIVE.running ? 'disabled' : ''}/><span></span><span>Listing</span>${showAcc ? '<span>Account</span>' : ''}<span>Source</span><span>Buy Now</span><span title="Cheapest exact match on Trade Me (🔎 Lowest match)">Lowest</span><span>Bids</span><span title="Views">Views</span><span title="Watchlists (bidders + watchers)">Watching</span><span>Ends in</span><span></span></div>
                    ${items
                      .map(
                        (i) => `<div class="sold-row">
                          <input type="checkbox" data-sel="${i.listingId}" ${LIVE.selected.has(i.listingId) ? 'checked' : ''} ${LIVE.running ? 'disabled' : ''}/>
                          ${i.picture ? `<img src="${esc(i.picture)}" alt=""/>` : '<span class="rl-noimg"></span>'}
                          <span class="rl-title"><b>${esc(i.title)}</b><a href="#" data-url="${esc(i.url)}">#${i.listingId}${i.sku ? ' · ' + esc(i.sku) : ''}${i.quantity > 1 ? ` · ${i.quantity} left` : ''}</a>${st(i.listingId)}</span>
                          ${showAcc ? `<span class="rl-muted">${esc(i.nickname)}</span>` : ''}
                          <span>${fromApp.has(+i.listingId) ? '<i class="pay-tag">App</i>' : '<i class="pay-tag" style="opacity:.6">Trade Me</i>'}</span>
                          <span class="rl-num">${i.buyNow ? dollars(i.buyNow) : '—'}</span>
                          <span class="rl-num">${liveMatchCell(i)}</span>
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
                    <button class="btn" id="matchBtn" ${sel.length && !LIVE.running ? '' : 'disabled'}>🔎 Lowest match (${sel.length})</button>
                    <button class="btn" id="bulkAiBtn" ${sel.length && !LIVE.running ? '' : 'disabled'}>✨ AI hero photos (${sel.length})</button>
                    <button class="btn primary" id="dropBtn" ${sel.length && !LIVE.running ? '' : 'disabled'}>${LIVE.running ? 'Updating…' : `Edit price (${sel.length})`}</button>
                  </div>`
            }`
    }`;

  $('#liveAcc').onchange = (e) => ((LIVE.scope = e.target.value), loadLive());
  $('#liveRefresh').onclick = () => loadLive();
  bindSearch('liveQ', (v) => (LIVE.q = v), renderLive);
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
  $('#bulkAiBtn')?.addEventListener('click', () => bulkAiPhotos(sel));
  $('#matchBtn')?.addEventListener('click', () => liveMatchStart(sel));
  $$('[data-lm]').forEach((a) => (a.onclick = (e) => (e.preventDefault(), e.stopPropagation(), api.openExternal(a.dataset.lm))));
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
  // Listings with a lowest exact match (Live → 🔎 Lowest match) can be priced against it in one click.
  const lowest = (i) => LIVE.match?.[i.listingId]?.best?.price;
  const matched = list.filter((i) => lowest(i) > 0);
  const card = modal(`
    <h3>Edit price</h3>
    <p class="hint modal-sub">${list.length} listing${list.length > 1 ? 's' : ''} selected</p>
    <div class="dp-field">
      <span class="dp-label">Drop by</span>
      <div class="dp-pct">
        <div class="seg" id="dpQuick">${[5, 10, 15, 20, 25].map((n) => `<button data-p="${n}" class="${n === pct ? 'on' : ''}">${n}%</button>`).join('')}</div>
        <div class="dp-custom"><input id="dpPct" type="number" min="1" max="90" step="1" value="${pct}" /><span>%</span></div>
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
    ${
      matched.length
        ? `<div class="dp-field">
            <span class="dp-label">Match lowest exact match <span style="font-weight:400">(${matched.length} of ${list.length} have one, from 🔎 Lowest match)</span></span>
            <div class="seg" id="dpMatch">${[[0, 'Match it'], [1, '$1 under'], [5, '$5 under'], [10, '$10 under']].map(([u, l]) => `<button data-u="${u}">${l}</button>`).join('')}</div>
          </div>`
        : ''
    }
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
    $$('#dpMatch button', card).forEach((x) => x.classList.remove('on')); // a new % replaces matched prices
    $('#dpPreview', card).innerHTML = plan()
      .map(
        (r) => `<div class="dp-row" data-id="${r.i.listingId}">
          ${r.i.picture ? `<img src="${esc(r.i.picture)}" alt=""/>` : '<span class="rl-noimg"></span>'}
          <span class="dp-title">${esc(r.i.title)}</span>
          <span class="dp-from">${dollars(r.from)}</span>
          ${lowest(r.i) ? `<a href="#" class="dp-lowest ${lowest(r.i) < r.from ? 'under' : ''} ${lmOld(LIVE.match[r.i.listingId]) ? 'lm-old' : ''}" data-lm="${esc(LIVE.match[r.i.listingId].best.url)}" title="Cheapest exact match on Trade Me, checked ${agoShort(LIVE.match[r.i.listingId].at)} ago (click to open)">lowest ${dollars(lowest(r.i))} <small>${agoShort(LIVE.match[r.i.listingId].at)}</small></a>` : '<span class="dp-lowest none">—</span>'}
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
    $$('.dp-lowest[data-lm]', card).forEach((a) => (a.onclick = (e) => (e.preventDefault(), api.openExternal(a.dataset.lm))));
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
  // Match lowest: sets the rows that have a lowest match to that price (or $N under it); others stay
  // on the % drop. You can still type over any row afterwards.
  $$('#dpMatch button', card).forEach(
    (b) =>
      (b.onclick = () => {
        $$('#dpMatch button', card).forEach((x) => x.classList.toggle('on', x === b));
        for (const i of matched) {
          const to = Math.max(0.5, Math.round((lowest(i) - +b.dataset.u) * 100) / 100);
          typed[i.listingId] = to;
          const el = $(`[data-to="${i.listingId}"]`, card);
          if (el) el.value = Number.isInteger(to) ? to : to.toFixed(2);
        }
        updateGo();
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
  m.innerHTML = '<button data-a="edit">Edit listing</button><button data-a="copy">Copy to new listing</button><button data-a="photos">Edit photos</button><button data-a="ai">✨ AI hero photo</button><button data-a="open">Open on Trade Me</button><button data-a="withdraw" class="danger">Withdraw…</button>';
  document.body.append(m);
  const close = () => (m.remove(), document.removeEventListener('click', close));
  setTimeout(() => document.addEventListener('click', close));
  m.querySelector('[data-a=edit]').onclick = () => (close(), editListing(item));
  m.querySelector('[data-a=photos]').onclick = () => (close(), editLivePhotos(item));
  m.querySelector('[data-a=copy]').onclick = () => (close(), importListing(String(item.listingId), item.accountId).catch((e) => toast(e.message)));
  m.querySelector('[data-a=ai]').onclick = () => (close(), editLivePhotos(item, { ai: true }));
  m.querySelector('[data-a=open]').onclick = () => (close(), api.openExternal(item.url));
  m.querySelector('[data-a=withdraw]').onclick = () => (close(), withdrawListing(item));
}

// Lowest exact match for ticked live listings (same AI check as New listing), shown in the Lowest column.
// listingId → { loading } | { best, all, count, checked, at, gone } | { error }. `all` is every match,
// cheapest first; when the cheapest sells or is withdrawn the next one takes over (verifyLowest).
// Finished results are saved on this computer so they're still there after closing Tagline; they fade
// after Settings → General "old after" days and are dropped after "forget after" days.
const LM_KEY = 'tagline.lowestMatch';
LIVE.match = (() => {
  try {
    const saved = JSON.parse(localStorage.getItem(LM_KEY) || '{}');
    return Object.fromEntries(Object.entries(saved).filter(([, m]) => m && !m.loading && !m.error).map(([k, m]) => [k, { ...m, all: m.all || (m.best ? [m.best] : []) }]));
  } catch {
    return {};
  }
})();
const lmDays = (k, d) => Math.max(1, +S?.general?.[k] || d);
function pruneLiveMatch() {
  const cutoff = Date.now() - lmDays('lowestKeepDays', 30) * 86400000;
  for (const [k, m] of Object.entries(LIVE.match)) if (!m.loading && (m.at || 0) < cutoff) delete LIVE.match[k];
  saveLiveMatch();
}
const lmOld = (m) => m?.at && Date.now() - m.at > lmDays('lowestOldDays', 3) * 86400000;
const agoShort = (t) => {
  const mins = Math.max(0, Math.round((Date.now() - t) / 60000));
  return mins < 60 ? `${mins}m` : mins < 1440 ? `${Math.round(mins / 60)}h` : `${Math.round(mins / 1440)}d`;
};

// Re-check that each listing's cheapest match is still for sale (and still that price). If it sold or
// was withdrawn, drop it and move on to the next cheapest. No AI cost: just reads the listing.
// Runs when Live loads, at most once every 30 minutes per listing.
async function verifyLowest(items) {
  const due = items.filter((i) => {
    const m = LIVE.match[i.listingId];
    return m?.best && !m.loading && !m.verifying && Date.now() - (m.verifiedAt || 0) > 30 * 60000;
  });
  let changed = false;
  await runPool(due, 3, async (i) => {
    const m = LIVE.match[i.listingId];
    m.verifying = true;
    try {
      for (let n = 0; n < 8 && m.all.length; n++) {
        const best = m.all[0];
        const r = (await api.listingAlive({ accountId: i.accountId, ids: [best.id] }))[best.id];
        if (!r || r.error) return; // couldn't tell (offline…); leave it for next time
        if (!r.alive) {
          m.all.shift();
          m.gone = (m.gone || 0) + 1;
          changed = true;
          continue;
        }
        if (r.price && r.price !== best.price) {
          best.price = r.price;
          m.all.sort((a, b) => a.price - b.price);
          changed = true;
          if (m.all[0] !== best) continue; // its price went up: check the new cheapest
        }
        break;
      }
      m.best = m.all[0] || null;
      m.count = m.all.length;
      m.verifiedAt = Date.now();
    } finally {
      delete m.verifying;
    }
  });
  if (changed) {
    saveLiveMatch();
    if (current === 'live' && !LIVE.running) renderLive();
  }
}
const saveLiveMatch = () => {
  try {
    const done = Object.fromEntries(Object.entries(LIVE.match).filter(([, m]) => m && !m.loading && !m.error));
    localStorage.setItem(LM_KEY, JSON.stringify(done));
  } catch {}
};
const LM = { sameSize: true, afterpay: 'any' };
const sizeFromTitle = (t) => (String(t).match(/\bUS\s?(\d{1,2}(?:\.5)?\s?[WYC]?)\b/i) || String(t).match(/\b(\d{1,2}(?:\.5)?[WYC])\b/i) || [])[1]?.replace(/\s/g, '') || '';
// Lowest column: the cheapest match's price, linked to it. Red when it's under yours, green when you're
// the cheapest. Hover for details.
function liveMatchCell(i) {
  const m = LIVE.match[i.listingId];
  if (!m) return '<span class="rl-muted">—</span>';
  if (m.loading) return '<div class="spinner small" title="Finding lowest match…"></div>';
  if (m.error) return `<span class="lm-err" title="${esc(m.error)}">!</span>`;
  const old = lmOld(m);
  const age = `<small class="lm-age" title="Checked ${agoShort(m.at)} ago${old ? ' — tick it and run 🔎 Lowest again for a fresh price' : ''}">${agoShort(m.at)}</small>`;
  if (!m.best && m.gone)
    return `<span class="lm-cell ${old ? 'lm-old' : ''}"><span class="rl-muted" title="All ${m.gone} match${m.gone > 1 ? 'es have' : ' has'} sold or ended since the check. Run 🔎 Lowest again to look for new ones.">ended</span>${age}</span>`;
  if (!m.best) return `<span class="lm-cell ${old ? 'lm-old' : ''}"><span class="rl-muted" title="No exact match on Trade Me${m.filters ? ` (${esc(m.filters)})` : ''} · checked ${m.checked}">none</span>${age}</span>`;
  const mine = i.buyNow || i.start || 0;
  const diff = Math.round((mine - m.best.price) * 100) / 100;
  const tip = `${m.best.title}${m.best.size ? ` · ${m.best.size}` : ''}${m.best.afterpay ? ' · Afterpay' : ''} · ${diff > 0 ? `you're ${money(diff)} higher` : diff < 0 ? `you're ${money(-diff)} cheaper` : 'same price'}${m.count > 1 ? ` · ${m.count} matches` : ''}${m.gone ? ` · ${m.gone} cheaper match${m.gone > 1 ? 'es' : ''} sold or ended since` : ''}`;
  return `<span class="lm-cell ${old ? 'lm-old' : ''}"><a href="#" class="lm-link ${diff > 0 ? 'lm-err' : 'lm-ok'}" data-lm="${esc(m.best.url)}" title="${esc(tip)}">${dollars(m.best.price)}</a>${age}</span>`;
}
function liveMatchStart(list) {
  if (!S.openai?.hasKey) return toast('Add your OpenAI API key in Settings → AI photos first.');
  modal(`
    <h3>Lowest exact match</h3>
    <p class="hint" style="margin-top:-6px">${list.length} listing${list.length > 1 ? 's' : ''} · AI checks similar Trade Me listings (titles + photos) and keeps only the exact same product · about 4c each</p>
    <label class="ai-auto"><input type="checkbox" id="lmSize" ${LM.sameSize ? 'checked' : ''}/><span><b>Same size only</b><small>Uses the size in each listing's title (e.g. US10, 8W).</small></span></label>
    <div class="f"><span>Compare against</span><div class="seg" id="lmAp">${[['any', 'Any listing'], ['only', 'With Afterpay'], ['none', 'Without Afterpay']].map(([v, l]) => `<button data-v="${v}" class="${LM.afterpay === v ? 'on' : ''}">${l}</button>`).join('')}</div></div>
    <div class="actions"><button class="btn ghost" id="cancel">Cancel</button><button class="btn primary" id="go">Check ${list.length}</button></div>`);
  $$('#lmAp button').forEach((b) => (b.onclick = () => ((LM.afterpay = b.dataset.v), $$('#lmAp button').forEach((x) => x.classList.toggle('on', x === b)))));
  $('#cancel').onclick = closeModal;
  $('#go').onclick = () => {
    LM.sameSize = $('#lmSize').checked;
    closeModal();
    list.forEach((i) => (LIVE.match[i.listingId] = { loading: true }));
    if (current === 'live') renderLive();
    runPool(list, 3, async (i) => {
      try {
        LIVE.match[i.listingId] = { ...(await liveMatchOne(i)), at: Date.now() };
        saveLiveMatch();
      } catch (err) {
        LIVE.match[i.listingId] = { error: err.message };
      }
      if (current === 'live' && !LIVE.running) renderLive();
    }).then(() => toast(`Lowest match checked for ${list.length} listing${list.length > 1 ? 's' : ''}`));
  };
}
async function liveMatchOne(i) {
  const words = compWords(i.title, i.sku);
  const comps = await api.priceComps({ accountId: i.accountId, sku: i.sku || '', name: words, brand: '', isNew: true }).then((r) => r.comps || []);
  const cands = comps.filter((c) => +c.id !== +i.listingId).sort((a, b) => a.price - b.price).slice(0, 40);
  if (!cands.length) return { best: null, checked: 0 };
  const size = sizeFromTitle(i.title);
  const r = await api.findMatches({
    product: { title: i.title, sku: i.sku, size, condition: 'Brand new', image: fullSize(i.picture) },
    comps: cands.map((c) => ({ id: c.id, title: c.title, price: c.price, picture: c.picture, size: c.size })),
  });
  const ok = new Map(r.results.filter((x) => x.match).map((x) => [x.id, x]));
  const list = cands
    .filter((c) => ok.has(c.id))
    .filter((c) => !(LM.sameSize && size) || ok.get(c.id).sameSize !== false)
    .filter((c) => LM.afterpay === 'any' || (LM.afterpay === 'only' ? c.afterpay : !c.afterpay))
    .sort((a, b) => a.price - b.price);
  const filters = [LM.sameSize && size && `size ${size}`, LM.afterpay === 'only' && 'with Afterpay', LM.afterpay === 'none' && 'without Afterpay'].filter(Boolean).join(', ');
  const all = list.slice(0, 15).map(({ id, title, price, url, size, afterpay }) => ({ id, title, price, url, size, afterpay }));
  return { best: all[0] || null, all, count: list.length, checked: cands.length, filters, verifiedAt: Date.now() };
}

// The section (with a reference photo) whose category matches a listing's category number, else the
// first section that has a reference photo.
function aiSectionFor(accountId, category) {
  const secs = profList(accountId).filter((s) => s.aiRef);
  const cat = String(category || '').replace(/\D/g, '');
  return secs.find((s) => cat && String(s.category?.number || '').replace(/-$/, '').split('-').pop() === cat.padStart(4, '0')) || secs[0] || null;
}

// AI hero photos for many live listings at once. Each runs in the background (AI photos tab), 3 at a
// time. Reviewing one and clicking "Use as main photo" saves it to that listing on Trade Me; with
// auto-approve on they're saved as soon as they're made.
function bulkAiPhotos(list) {
  if (!S.openai?.hasKey) return toast('Add your OpenAI API key in Settings → AI photos first.');
  const accIds = [...new Set(list.map((i) => i.accountId))];
  const secs = accIds.length === 1 ? profList(accIds[0]).filter((s) => s.aiRef) : [];
  if (!list.some((i) => profList(i.accountId).some((s) => s.aiRef))) return toast('No section has a reference photo yet. Add one under Defaults → section → AI photo.');
  const per = (() => {
    const u = S.aiUsage?.[`${S.ai?.model || 'gpt-image-2.6-sunburst'}|${S.ai?.quality || 'high'}`];
    return u?.n ? u.usd / u.n : { medium: 0.04, high: 0.06, xhigh: 0.1 }[S.ai?.quality || 'high'];
  })();
  modal(`
    <h3>AI hero photos</h3>
    <p class="hint" style="margin-top:-6px">${list.length} listing${list.length > 1 ? 's' : ''} selected · about US$${(per * list.length).toFixed(2)} (≈ NZ$${nzd(per * list.length).toFixed(2)})</p>
    <label class="f">Reference photo
      <select id="baSec">
        <option value="">Match each listing's category (else first section with a photo)</option>
        ${secs.map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('')}
      </select>
    </label>
    <p class="hint">They're made in the background, 3 at a time. Watch them in the <b>AI photos</b> tab at the bottom of the sidebar.
    ${S.ai?.autoApprove ? '<b>Auto-approve is on:</b> each photo is saved to its listing on Trade Me as the main photo as soon as it\'s ready.' : 'Review each one there; <b>Use as main photo</b> saves it to that listing on Trade Me.'}</p>
    <div class="actions"><button class="btn ghost" id="cancel">Cancel</button><button class="btn primary" id="go">Make ${list.length} photo${list.length > 1 ? 's' : ''}</button></div>`);
  $('#cancel').onclick = closeModal;
  $('#go').onclick = () => {
    const pick = $('#baSec').value;
    closeModal();
    toast(`Making ${list.length} AI photo${list.length > 1 ? 's' : ''} in the background`);
    runPool(list, 3, (item) => bulkAiOne(item, pick));
  };
}
// Run fn over items, at most n at once.
async function runPool(items, n, fn) {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.min(n, queue.length) }, async () => {
    while (queue.length) await fn(queue.shift()).catch(() => {});
  }));
}
async function bulkAiOne(item, secId) {
  const fail = (msg) => {
    AI_JOBS.push({ id: newJobId(), kind: 'live', label: item.title, status: 'error', error: msg, opts: {}, bg: true });
    renderAiTray();
  };
  let L;
  try {
    L = await api.getListing({ accountId: item.accountId, listingId: item.listingId });
  } catch (err) {
    return fail(err.message);
  }
  const s = (secId && profList(item.accountId).find((x) => x.id === secId && x.aiRef)) || aiSectionFor(item.accountId, L.Category);
  if (!s) return fail("This account's sections have no reference photo.");
  const first = (L.Photos || [])[0];
  if (!first) return fail('This listing has no photo to work from.');
  let productSrc;
  try {
    productSrc = await toJpeg(await api.fetchImage(first.Value?.FullSize || first.Value?.Large));
  } catch (err) {
    return fail(`Couldn't load its photo: ${err.message}`);
  }
  // kind 'live': using it saves it in front of the listing's current photos on Trade Me.
  return runAiPhoto(s, productSrc, aiVars(s, { name: L.Title, sku: L.SKU }), {
    kind: 'live',
    payload: { accountId: item.accountId, listingId: item.listingId },
    label: L.Title,
    background: true,
    quiet: true,
    afterpay: hasAfterpay(L.PaymentMethods),
  });
}

// Photos on a live listing: reorder, remove, add, or make an AI hero photo, then save to Trade Me.
async function editLivePhotos(item, { ai = false } = {}) {
  modal(`<h3>Edit photos</h3><div class="empty"><div class="spinner" style="margin:auto"></div></div>`);
  let L;
  try {
    L = await api.getListing({ accountId: item.accountId, listingId: item.listingId });
  } catch (err) {
    modal(`<h3>Edit photos</h3><p style="color:var(--red)">${esc(err.message)}</p><div class="actions"><button class="btn" id="cancel">Close</button></div>`);
    return ($('#cancel').onclick = closeModal);
  }
  const st = {
    photos: (L.Photos || []).map((p) => ({ id: p.Key, src: p.Value?.Large || p.Value?.FullSize, full: p.Value?.FullSize || p.Value?.Large })),
    secs: profList(item.accountId),
  };
  st.secId = (aiSectionFor(item.accountId, L.Category) || st.secs[0])?.id;
  const sec = () => st.secs.find((s) => s.id === st.secId);

  const render = () => {
    const card = modal(`
      <h3>Edit photos</h3>
      <p class="hint" style="margin:-6px 0 16px">${esc(L.Title)} · #${item.listingId} · ${esc(item.nickname)}</p>
      <div class="images" id="lpImgs">
        ${st.photos
          .map(
            (p, n) => `<div class="img" draggable="true" data-i="${n}"><img src="${esc(p.src)}" data-full="${esc(p.full || p.src)}" /><span class="tag">${n === 0 ? 'Main' : p.ai ? 'AI' : p.id ? '' : 'New'}</span><button class="x" data-rm="${n}">×</button></div>`,
          )
          .join('')}
        <div class="drop" id="lpDrop">＋<br/>Add photos</div>
      </div>
      <input type="file" id="lpFile" accept="image/*" multiple hidden />
      <div class="lp-ai">
        <label class="f" style="margin:0;flex:1">Reference photo from section <select id="lpSec">${st.secs
          .map((s) => `<option value="${esc(s.id)}" ${s.id === st.secId ? 'selected' : ''} ${s.aiRef ? '' : 'disabled'}>${esc(s.name)}${s.aiRef ? '' : ' (no reference photo)'}</option>`)
          .join('')}</select></label>
        <button class="btn" id="lpAi">✨ Make AI hero photo</button>
      </div>
      <p class="hint">Drag to reorder; the first photo is the main one. The AI photo is made from the first non-AI photo.</p>
      <p class="hint" id="lpMsg" style="color:var(--red)"></p>
      <div class="actions"><button class="btn ghost" id="cancel">Cancel</button><button class="btn primary" id="go">Save photos</button></div>`);
    card.classList.add('ai-wide');
    $$('#lpImgs [data-rm]').forEach((b) => (b.onclick = () => (st.photos.splice(+b.dataset.rm, 1), render())));
    $('#lpDrop').onclick = () => $('#lpFile').click();
    $('#lpFile').onchange = (e) => addFiles(e.target.files);
    const box = $('#lpImgs');
    box.ondragover = (e) => e.preventDefault();
    box.ondrop = (e) => {
      e.preventDefault();
      if (!DRAG && e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
    };
    sortable(box, '[data-i]', (from, to, after) => {
      moveItem(st.photos, +from.dataset.i, +to.dataset.i, after);
      render();
    });
    $('#lpSec').onchange = (e) => (st.secId = e.target.value);
    $('#lpAi').onclick = makeAi;
    $('#cancel').onclick = closeModal;
    $('#go').onclick = save;
  };

  async function addFiles(files) {
    for (const f of files) {
      if (!f.type.startsWith('image/')) continue;
      const raw = await new Promise((res) => {
        const r = new FileReader();
        r.onload = () => res(r.result);
        r.readAsDataURL(f);
      });
      try {
        st.photos.push({ src: await toJpeg(raw) });
      } catch (err) {
        toast(err.message);
      }
    }
    render();
  }

  async function makeAi() {
    const s = sec();
    const choices = st.photos.filter((p) => !p.ai);
    const problem = !S.openai?.hasKey ? 'Add your OpenAI API key in Settings → AI photos first.' : !s?.aiRef ? 'Pick a section that has a reference photo (Defaults → section → AI photo).' : '';
    if (problem) return ($('#lpMsg').textContent = problem);
    const p = await pickAiSource(choices.map((x) => x.src), { onCancel: render });
    if (!p) return;
    const product = p.src ? { src: p.src } : choices[p.index]; // p.src: a photo added just for the AI
    modal(`<h3>Getting the photo…</h3><div class="empty"><div class="spinner" style="margin:auto"></div></div>`);
    let productSrc;
    try {
      productSrc = product.id ? await toJpeg(await api.fetchImage(product.full)) : product.src;
    } catch (err) {
      render();
      $('#lpMsg').textContent = `Couldn't load the product photo: ${err.message}`;
      return;
    }
    runAiPhoto(s, productSrc, aiVars(s, { name: L.Title, sku: L.SKU }), {
      kind: 'live',
      payload: { accountId: item.accountId, listingId: item.listingId },
      label: L.Title,
      afterpay: hasAfterpay(L.PaymentMethods),
      onBack: render,
      // Using it puts it first in this Edit photos window (reopened if you'd closed it), to save with
      // your other changes. After a restart it saves straight to the listing instead.
      useLabel: 'Use as main photo',
      onUse: async (dataUrl) => {
        st.photos.unshift({ src: await toJpeg(dataUrl), ai: true });
        render();
      },
      // Auto-approve: AI photo first, then the listing's photos as they were in this window, saved to Trade Me.
      autoUse: async (dataUrl) => {
        st.photos.unshift({ src: await toJpeg(dataUrl), ai: true });
        await api.saveListingPhotos({ accountId: item.accountId, listingId: item.listingId, photos: st.photos.slice(0, 20).map((p) => (p.id ? { id: p.id } : { base64: p.src.split(',')[1] })) });
        dataChanged('live');
      },
    });
  }

  async function save() {
    if (!st.photos.length) return ($('#lpMsg').textContent = 'A listing needs at least one photo.');
    $('#go').disabled = $('#cancel').disabled = true;
    $('#go').textContent = 'Saving…';
    try {
      await api.saveListingPhotos({ accountId: item.accountId, listingId: item.listingId, photos: st.photos.map((p) => (p.id ? { id: p.id } : { base64: p.src.split(',')[1] })) });
      closeModal();
      toast('Photos updated');
      dataChanged('live');
    } catch (err) {
      $('#lpMsg').textContent = err.message;
      $('#go').disabled = $('#cancel').disabled = false;
      $('#go').textContent = 'Save photos';
    }
  }

  render();
  if (ai) makeAi();
}

// Withdraw can't be undone, so it always asks first.
function withdrawListing(item) {
  const card = modal(`
    <h3>Withdraw this listing?</h3>
    <div class="hero">${item.picture ? `<img src="${esc(item.picture)}" />` : ''}<div><b>${esc(item.title)}</b><br/><small style="color:var(--muted)">#${item.listingId} · ${esc(item.nickname)}</small></div></div>
    <div class="seg" id="wdType" style="margin:0 0 16px"><button data-t="0" class="on">Didn't sell</button><button data-t="1">Sold elsewhere</button></div>
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
    <p class="hint modal-sub">#${item.listingId} · ${esc(item.nickname)}</p>
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
    <div class="actions"><button class="btn" id="edDrop" style="margin-right:auto">Edit price</button><button class="btn ghost" id="cancel">Cancel</button><button class="btn primary" id="go">Save changes</button></div>`);
  // Jumps to the Edit price popup for just this listing (drop by %, rounding, or type a price).
  $('#edDrop', card).onclick = () => (closeModal(), dropPrices([item]));
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
  loadTracking();
}

function renderSold() {
  const accs = envAccounts();
  SOLD.scope = pickScope(SOLD.scope);
  const cutoff = Date.now() - SOLD.days * 86400000;
  // Your courier cost (Settings) comes off every sale that ships (not pickups).
  const courier = +S.courierCost || 0;
  const items = (SOLD.items || [])
    .filter((i) => !i.soldDate || new Date(i.soldDate) >= cutoff)
    .filter((i) => searchHit(SOLD.q, i.title, i.buyer, i.listingId, i.purchaseId, i.nickname, ...(i.parcels || []).map((p) => p.ref)))
    .map((i) => {
      const post = i.pickup ? 0 : courier;
      return { ...i, courier: post, payout: Math.round((i.payout - post) * 100) / 100 };
    });
  const sum = (k) => items.reduce((s, i) => s + (i[k] || 0), 0);
  const fees = sum('processing') + sum('success') + sum('courier');
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
      <button class="btn" id="soldCourier" title="Open Trade Me's Book a courier page">📦 Book a courier</button>
      ${single ? `<div class="seg" id="soldMode"><button data-m="list" class="${mode === 'list' ? 'on' : ''}">Sales list</button><button data-m="page" class="${mode === 'page' ? 'on' : ''}">Trade Me page</button></div>` : ''}
      ${mode === 'page' ? '' : searchBox('soldQ', SOLD.q || '', 'Search title, buyer or #')}
      <div class="seg ${mode === 'page' ? 'hidden' : ''}" id="soldDays" style="${mode === 'page' ? 'margin-left:auto' : ''}">
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
              <div><span>Fees${courier ? ' + courier' : ''}</span><b>${fees ? '−' + money(fees) : '$0.00'}</b></div>
              <div class="payout-stat"><span>Your payout</span><b>${dollars(sum('payout'))}</b></div>
            </div>
            ${
              !items.length
                ? `<div class="empty">No sales in the last ${SOLD.days} days.</div>`
                : `<div class="rl-table sold-table ${showAcc ? 'with-acc' : ''}">
                    <div class="sold-row rl-head"><span></span><span>Listing</span>${showAcc ? '<span>Account</span>' : ''}<span>Sold</span><span>Paid via</span><span>Total</span><span>Fees</span><span>Payout</span><span></span></div>
                    ${items
                      .map(
                        (i) => `<div class="sold-row">
                          ${i.picture ? `<img src="${esc(i.picture)}" alt=""/>` : '<span class="rl-noimg"></span>'}
                          <span class="rl-title"><b>${esc(i.title)}</b><a href="#" data-url="${esc(i.url)}">${i.qty > 1 ? `${i.qty} × ` : ''}to ${esc(i.buyer || 'buyer')}${i.status ? ' · ' + esc(i.status) : ''}</a>${trackLine(i)}</span>
                          ${showAcc ? `<span class="rl-muted">${esc(i.nickname)}</span>` : ''}
                          <span class="rl-muted">${i.soldDate ? when(i.soldDate) : ''}</span>
                          <span>${i.method ? `<i class="pay-tag p${i.method}">${PAY_NAME[i.method] || 'Other'}</i>` : `<i class="pay-tag">${i.pending ? 'Pending' : 'Unpaid'}</i>`}</span>
                          <span class="rl-num">${dollars(i.total)}</span>
                          <span class="rl-muted" title="${esc([i.processing && `${PAY_NAME[i.method] || 'Payment'} fee ${money(i.processing)}`, i.success && `success fee ${money(i.success)}`, i.courier && `courier ${money(i.courier)}`].filter(Boolean).join(' + '))}">${i.processing + i.success + i.courier ? '−' + money(i.processing + i.success + i.courier) : '—'}</span>
                          <span class="rl-num payout-num">${dollars(i.payout)}</span>
                          ${
                            i.parcels?.length
                              ? `<button class="btn small" data-track="${i.purchaseId}" title="Delivery status from NZ Post">Track</button>`
                              : i.purchaseId && !i.pickup
                                ? `<button class="btn small ${i.booked ? '' : 'primary'}" data-courier="${i.purchaseId}" title="Book a courier for this sale on Trade Me">${i.booked ? 'Booking' : 'Book courier'}</button>`
                                : '<span></span>'
                          }
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

  const saleBy = (pid) => (SOLD.items || []).find((i) => String(i.purchaseId) === pid);
  $$('[data-courier]').forEach((b) => (b.onclick = () => bookCourier(saleBy(b.dataset.courier))));
  $$('[data-track]').forEach((b) => (b.onclick = () => showTracking(saleBy(b.dataset.track))));
  bindSearch('soldQ', (v) => (SOLD.q = v), renderSold);
  $('#soldCourier').onclick = () => bookCourierGeneral(SOLD.scope);
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
    // Braces matter: an on* handler that returns false cancels the key, which would block typing.
    t.onkeydown = (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) sendAnswer(sel, +t.dataset.q);
    };
  });
  $$('.q-reply button').forEach((b) => (b.onclick = () => sendAnswer(sel, +b.dataset.q)));
  if (sel?.koru) wireTmView(sel);
  if (!Q.data && !Q.loading && !Q.error && Q.accountId) loadQuestions();
}

// Trade Me's Book a courier wizard for one sale, inside the app and logged in as the selling account,
// so the booking is tied to the purchase (buyer's address, shows to the buyer). You pick the courier
// and parcel size and confirm on Trade Me's page; nothing is booked or paid automatically.
// Opens in its own window (logged in as the selling account). When it closes, Sold reloads so the
// tracking number Trade Me attaches to the sale shows up.
function bookCourier(sale) {
  if (!sale) return;
  api.openCourier({ accountId: sale.accountId, purchaseId: sale.purchaseId, listingId: sale.listingId, title: sale.title }).catch((e) => toast(e.message));
}
// Trade Me's general Book a courier page, signed in as one account (asks which when showing all).
function bookCourierGeneral(scope) {
  const accs = envAccounts();
  const open = (id) => api.openCourier({ accountId: id }).catch((e) => toast(e.message));
  if (scope && scope !== 'all') return open(scope);
  if (accs.length === 1) return open(accs[0].id);
  modal(`<h3>Book a courier</h3>
    <p class="hint" style="margin-top:-6px">Which account is sending it?</p>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin:6px 0 4px">${accs.map((a) => `<button class="btn ${a.id === S.defaultAccountId ? 'primary' : ''}" data-acc="${esc(a.id)}">${esc(a.nickname)}</button>`).join('')}</div>
    <div class="actions"><button class="btn ghost" id="cancel">Cancel</button></div>`);
  $('#cancel').onclick = closeModal;
  $$('[data-acc]').forEach((b) => (b.onclick = () => (closeModal(), open(b.dataset.acc))));
}
api.onCourierClosed(() => {
  // Trade Me can take a moment to attach the tracking number; check now and again shortly.
  loadSold();
  setTimeout(() => loadSold(), 20000);
});

// NZ Post delivery status per tracking number, filled in after Sold loads.
SOLD.track = {};
async function loadTracking() {
  const refs = (SOLD.items || []).flatMap((i) => (i.parcels || []).map((p) => p.ref));
  if (!refs.length) return;
  try {
    Object.assign(SOLD.track, await api.trackStatus(refs));
  } catch {}
  if (current === 'sold') renderSold();
}
function trackLine(sale) {
  const p = sale.parcels?.[0];
  if (!p) return sale.booked ? '<span class="trk trk-wait">Courier booked · waiting for tracking</span>' : '';
  const t = SOLD.track[p.ref];
  const cls = !t ? 'trk-wait' : t.error ? 'trk-err' : t.delivered ? 'trk-done' : 'trk-go';
  const text = !t ? 'Checking NZ Post…' : t.error ? 'Couldn\'t reach NZ Post' : t.status;
  return `<span class="trk ${cls}">${esc(p.courier || 'Courier')} · ${esc(text)}${sale.parcels.length > 1 ? ` · +${sale.parcels.length - 1} more` : ''}</span>`;
}
async function showTracking(sale) {
  if (!sale) return;
  const card = modal(`<h3>Tracking</h3><div class="empty"><div class="spinner" style="margin:auto"></div></div>`);
  let data;
  try {
    data = await api.trackStatus(sale.parcels.map((p) => p.ref));
    Object.assign(SOLD.track, data);
  } catch (e) {
    data = {};
  }
  const when = (iso) => new Date(iso).toLocaleString('en-NZ', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  modal(`
    <h3>Tracking</h3>
    <p class="hint" style="margin:-6px 0 16px">${esc(sale.title)} · to ${esc(sale.buyer || 'buyer')}</p>
    ${sale.parcels
      .map((p) => {
        const t = data[p.ref] || {};
        return `<div class="trk-box">
          <div class="trk-head"><b>${esc(p.courier || 'Courier')}</b><code>${esc(p.ref)}</code><a href="#" data-url="${esc(t.url || p.url)}">Open on NZ Post</a></div>
          ${
            t.error
              ? `<p style="color:var(--red)">${esc(t.error)}</p>`
              : (t.events || []).length
                ? `<ol class="trk-events">${t.events.map((e) => `<li><b>${esc(e.status)}</b><span>${esc(e.description)}</span><small>${when(e.at)}</small></li>`).join('')}</ol>`
                : '<p class="hint">No tracking events yet.</p>'
          }
        </div>`;
      })
      .join('')}
    <div class="actions"><button class="btn" id="cancel">Close</button></div>`);
  $('#cancel').onclick = closeModal;
  $$('#modalCard [data-url]').forEach((a) => (a.onclick = (e) => (e.preventDefault(), api.openExternal(a.dataset.url))));
  if (current === 'sold') renderSold();
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

// Shows what a section's templates produce for a sample product (Nike Dunk Low "Panda", DD1391-100, US 10).
function previewTemplates(p) {
  const afterpay = !!p.payment?.afterpay;
  const base = {
    brand: 'Nike', name: 'Dunk Low Retro White Black Panda', sku: 'DD1391-100', size: sizeText('10'), eu: euSize('10', 'nike'),
    colour: 'White/Black', condition: p.isBrandNew === false ? 'Used' : 'Brand new', ...shipVars(p.shipping),
  };
  const title = fill(p.titleTemplate, { ...base, afterpay: afterpay ? (p.afterpayText ?? 'AfterPay Available').trim() : '' }).trim();
  const desc = fill(p.descriptionTemplate, { ...base, afterpay: afterpay ? (p.afterpayDescText ?? 'AfterPay Available').trim() : '' });
  const over = title.length > 80;
  const shipErr = shipRefError(p);
  const card = modal(`
    <h3>Listing preview</h3>
    <p class="hint modal-sub">${esc(p.name)} · Nike Dunk Low "Panda" DD1391-100, US 10${afterpay ? ' · Afterpay on' : ''}</p>
    <div class="tpl-prev">
      <div class="tpl-prev-label">Title <span class="${over ? 'tpl-over' : ''}">${title.length}/80${over ? ' · too long' : ''}</span></div>
      <div class="tpl-prev-title">${title ? esc(title) : '<span class="tpl-empty">Title template is empty</span>'}</div>
      <div class="tpl-prev-label">Description</div>
      <div class="tpl-prev-desc">${desc.trim() ? esc(desc) : '<span class="tpl-empty">Description template is empty</span>'}</div>
    </div>
    ${shipErr ? `<p class="hint" style="color:var(--red)">${esc(shipErr)}</p>` : ''}
    <div class="actions"><button class="btn primary" id="cancel">Close</button></div>`);
  $('#cancel', card).onclick = closeModal;
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

const SET_TABS = [['trademe', 'Trade Me'], ['ai', 'AI'], ['integrations', 'Integrations'], ['general', 'General']];
const SET_CARDS = { trademe: ['Accounts', 'Trade Me API'], ai: ['Total AI spend', 'AI photos'], integrations: ['Product lookup', 'Discord'], general: ['Your costs', 'Startup', 'Desktop notifications', 'Lowest match', 'Backup', 'Updates'] };
const G_DEFAULTS = { startTab: 'new', startOnLogin: false, checkUpdates: true, notify: { sales: true, questions: true }, pollMins: 3, usdNzd: 1.7, lowestOldDays: 3, lowestKeepDays: 30 };
const G = () => ({ ...G_DEFAULTS, ...(S?.general || {}) });
const nzd = (usd) => usd * (+G().usdNzd || 1.7);
let SET_TAB = 'trademe';
function renderSettings() {
  const c = S.consumer[S.env];
  view.innerHTML = `
  <div class="settings">
    <h1>Settings</h1>
    <div class="tabs" id="setTabs">${SET_TABS.map(([k, l]) => `<button data-t="${k}" class="${k === SET_TAB ? 'on' : ''}">${l}</button>`).join('')}</div>

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
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <button class="btn ${S.trace.viaLogin ? 'small' : 'primary'}" id="traceLogin">${S.trace.viaLogin ? 'Change login' : 'Log in to Trace'}</button>
        <button class="btn small" id="traceTest" ${S.trace.hasToken ? '' : 'disabled'}>Test</button>
        ${S.trace.hasToken ? `<button class="btn small danger" id="traceClear">${S.trace.viaLogin ? 'Log out' : 'Remove'}</button>` : ''}
        <span class="hint" id="traceStatus" style="margin:0">${
          S.trace.viaLogin ? `Logged in as ${esc(S.trace.email)}. Renews itself when it expires.` : S.trace.hasToken ? 'Pasted token saved. It stops working when it expires.' : 'Not connected. Without Trace, add photos yourself on each listing.'
        }</span>
      </div>
      <p class="hint">Looks up the SKU on Trace for the product name, colour and photo. Your Trace email and password are saved encrypted on this computer only.</p>
      <details class="extras" style="margin-top:6px">
        <summary>Paste a token instead</summary>
        <label class="f" style="margin-top:10px">Bearer token <input id="traceToken" type="password" spellcheck="false" placeholder="${S.trace.hasToken && !S.trace.viaLogin ? '•••••••• saved — paste to replace' : 'Paste the Bearer token'}" /></label>
      </details>
    </div>

    <div class="card">
      <h2>Your costs</h2>
      <div class="row">
        <label class="f" style="max-width:260px">Courier cost per parcel ($) <input id="courierCost" type="number" min="0" step="0.01" value="${S.courierCost ?? ''}" placeholder="e.g. 5.23" /></label>
      </div>
      <p class="hint">What you pay to send a parcel. It comes off your payout on New listing and on Sold (not for pickups or cash).</p>
      <div class="row" style="margin-top:12px">
        <label class="f" style="max-width:260px">US$1 in NZ$ <input id="gRate" type="number" min="0.5" max="5" step="0.01" value="${G().usdNzd}" /></label>
      </div>
      <p class="hint">Exchange rate for showing AI costs (billed by OpenAI in US$) in NZ$.</p>
    </div>

    <div class="card">
      <h2>Startup</h2>
      <div class="row">
        <label class="f" style="max-width:260px">Open Tagline on <select id="gStart">${[['new', 'New listing'], ['live', 'Live'], ['relist', 'Relist'], ['sold', 'Sold'], ['questions', 'Questions'], ['history', 'History']]
          .map(([v, l]) => `<option value="${v}" ${G().startTab === v ? 'selected' : ''}>${l}</option>`)
          .join('')}</select></label>
      </div>
      <label class="ai-auto"><input type="checkbox" id="gLogin" ${G().startOnLogin ? 'checked' : ''} /> <span><b>Start Tagline when you log in to your computer</b><small>So sale and question alerts keep coming without you opening it. Only works in the installed app.</small></span></label>
      <label class="ai-auto"><input type="checkbox" id="gUpd" ${G().checkUpdates ? 'checked' : ''} /> <span><b>Check for updates when Tagline opens</b><small>Tells you when a new version is out. Nothing installs until you click it under Updates.</small></span></label>
    </div>

    <div class="card">
      <h2>Desktop notifications</h2>
      <div class="chips" id="gNotify" style="margin:0 0 12px">
        ${[['sales', 'New sales'], ['questions', 'New questions']].map(([k, l]) => `<button class="chip ${G().notify?.[k] ? 'on' : ''}" data-n="${k}">${l}</button>`).join('')}
      </div>
      <div class="row">
        <label class="f" style="max-width:260px">Check every (minutes) <input id="gPoll" type="number" min="1" max="60" step="1" value="${G().pollMins}" /></label>
      </div>
      <p class="hint">A Windows / Mac notification while Tagline is open; click it to jump to Sold or Questions. The same check sends Discord messages. Ones from before you switched it on aren't shown.</p>
    </div>

    <div class="card">
      <h2>Lowest match</h2>
      <div class="row">
        <label class="f">Fade results after (days) <input id="gLmOld" type="number" min="1" max="60" step="1" value="${G().lowestOldDays}" /></label>
        <label class="f">Forget results after (days) <input id="gLmKeep" type="number" min="1" max="365" step="1" value="${G().lowestKeepDays}" /></label>
      </div>
      <p class="hint">🔎 Lowest results on Live show how long ago they were checked and fade once they're old, so you know to re-check before pricing off them. Whenever Live loads, Tagline also checks the cheapest match is still for sale: if it sold or was withdrawn, the next cheapest takes over (free, no AI).</p>
    </div>

    <div class="card">
      <h2>Backup</h2>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <button class="btn small" id="bkExport">Export backup…</button>
        <button class="btn small" id="bkImport">Restore from backup…</button>
        <button class="btn small" id="openData">Open data folder</button>
        <button class="btn small danger" id="clearHist">Clear history</button>
      </div>
      <p class="hint" id="bkStatus">A backup has your sections, templates, AI reference photos, settings and history, for moving to another computer. It doesn't include API secrets, Trade Me logins, the Trace login, OpenAI key or Discord webhook: add those again after restoring.</p>
    </div>

    <div class="card">
      <h2>Total AI spend</h2>
      <div id="aiSpend"></div>
    </div>

    <div class="card">
      <h2>AI photos (OpenAI)</h2>
      <div class="row">
        <label class="f">API key <input id="oaKey" type="password" spellcheck="false" autocomplete="off" placeholder="${S.openai?.hasKey ? '•••••••• saved — paste to replace' : 'sk-…'}" /></label>
      </div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <button class="btn small" id="oaTest" ${S.openai?.hasKey ? '' : 'disabled'}>Test</button>
        ${S.openai?.hasKey ? '<button class="btn small danger" id="oaClear">Remove</button>' : ''}
        <span class="hint" id="oaStatus" style="margin:0">${S.openai?.hasKey ? 'Key saved (encrypted on this computer).' : 'Not connected.'}</span>
      </div>
      <p class="hint">Used to make AI hero photos. Create a key at platform.openai.com → API keys. Each photo is billed to your OpenAI account.</p>
      <div class="row" style="margin-top:12px">
        <label class="f">Model <select id="aiModel"><option value="gpt-image-2.6-sunburst">GPT Image 2.6 Sunburst (most accurate)</option><option value="gpt-image-2.6-flare">GPT Image 2.6 Flare (faster)</option></select></label>
        <label class="f">Quality <select id="aiQuality"><option value="medium">Medium</option><option value="high">High</option><option value="xhigh">Extra high</option></select></label>
      </div>
      <div id="aiCost" class="ai-cost"></div>
      <label class="ai-auto"><input type="checkbox" id="aiAuto" ${S.ai?.autoApprove ? 'checked' : ''} /> <span><b>Auto-approve AI photos</b><small>Skip the review: on New listing the photo goes straight in as the main photo; on Live it's saved to the listing on Trade Me as soon as it's ready.</small></span></label>
      <label class="ai-auto"><input type="checkbox" id="aiAfterpay" ${S.ai?.afterpayLogo ? 'checked' : ''} /> <span><b>Add the Afterpay logo when the listing has Afterpay</b><small>Placed in the space above the product, centred. Added after the AI makes the photo, so the logo is always exact.</small></span></label>
      <label class="f" style="margin-top:4px"><span>Prompt <a href="#" id="aiReset" style="float:right;font-weight:400">Reset to default</a></span><textarea id="aiPrompt" rows="12" spellcheck="false"></textarea></label>
      <p class="hint">Image 1 is the section's reference photo (Defaults → section → AI photo), Image 2 is the listing's product photo. Placeholders: <code>{product}</code> (brand + name) <code>{brand}</code> <code>{name}</code> <code>{colour}</code> <code>{sku}</code> <code>{category}</code> (the section's item word, e.g. "trading card box") <code>{section}</code></p>
    </div>

    <div class="card">
      <h2>Discord</h2>
      <div class="row">
        <label class="f">Webhook URL <input id="dcUrl" type="password" spellcheck="false" placeholder="${S.discord?.hasUrl ? '•••••••• saved — paste to replace' : 'https://discord.com/api/webhooks/…'}" /></label>
      </div>
      <div class="chips" id="dcEvents" style="margin:4px 0 12px">
        ${[['activity', 'Activity (listed, edits, price drops, withdrawals, relists)'], ['sales', 'New sales'], ['questions', 'New questions']]
          .map(([k, l]) => `<button class="chip ${S.discord?.events?.[k] !== false ? 'on' : ''}" data-dc="${k}">${l}</button>`)
          .join('')}
      </div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <button class="btn small" id="dcTest" ${S.discord?.hasUrl ? '' : 'disabled'}>Send test</button>
        ${S.discord?.hasUrl ? '<button class="btn small danger" id="dcClear">Remove</button>' : ''}
        <span class="hint" id="dcStatus" style="margin:0">${S.discord?.hasUrl ? 'Webhook saved.' : 'Not connected.'}</span>
      </div>
      <p class="hint">In Discord: channel settings → Integrations → Webhooks → New Webhook → Copy Webhook URL. New sales and questions are checked every 3 minutes while the app is open; ones from before you connect aren't posted.</p>
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

  // Tabs: each card belongs to the tab whose list has its heading.
  const showTab = () => {
    $$('#setTabs button').forEach((b) => b.classList.toggle('on', b.dataset.t === SET_TAB));
    $$('.settings > .card').forEach((card) => {
      const h = card.querySelector('h2')?.textContent.trim() || '';
      const tab = Object.keys(SET_CARDS).find((k) => SET_CARDS[k].some((x) => h.startsWith(x))) || 'general';
      card.classList.toggle('hidden', tab !== SET_TAB);
    });
  };
  $$('#setTabs button').forEach((b) => (b.onclick = () => ((SET_TAB = b.dataset.t), showTab())));
  showTab();

  // Running total of what AI features have cost, worked out from OpenAI's token counts on each call.
  const renderSpend = () => {
    const photos = Object.values(S.aiUsage || {}).reduce((a, u) => ({ n: a.n + (u.n || 0), usd: a.usd + (u.usd || 0) }), { n: 0, usd: 0 });
    const matches = S.aiMatchUsage || { n: 0, usd: 0 };
    const total = photos.usd + matches.usd;
    const box = $('#aiSpend');
    if (!box) return;
    box.innerHTML = `
      <div class="ai-cost-row">
        <div class="on"><span>Total</span><b>US$${total.toFixed(2)}</b><small>≈ NZ$${nzd(total).toFixed(2)}</small></div>
        <div><span>AI photos</span><b>US$${photos.usd.toFixed(2)}</b><small>${photos.n} photo${photos.n === 1 ? '' : 's'}</small></div>
        <div><span>Lowest-match checks</span><b>US$${matches.usd.toFixed(2)}</b><small>${matches.n} check${matches.n === 1 ? '' : 's'}</small></div>
      </div>
      <div style="display:flex;gap:8px;align-items:center;margin-top:10px">
        <button class="btn small" id="spendReset" ${total ? '' : 'disabled'}>Reset</button>
        <span class="hint" style="margin:0">Worked out from OpenAI's token counts at their published rates, counted from when Tagline started tracking. Your OpenAI dashboard has the exact bill.</span>
      </div>`;
    $('#spendReset').onclick = async () => {
      if (!confirm('Reset the AI spend totals to $0? (Per-photo cost averages reset too.)')) return;
      S = await api.updateSettings({ aiMatchUsage: { n: 0, usd: 0 }, aiUsageReset: true });
      renderSpend();
      renderAiCost?.();
    };
  };
  api.getSettings().then((s) => ((S = s), renderSpend())).catch(renderSpend);
  $('#courierCost').oninput = debounce(async (e) => {
    const v = e.target.value === '' ? 0 : Math.max(0, Math.round(+e.target.value * 100) / 100);
    S = await api.updateSettings({ courierCost: v });
  }, 400);

  // General tab
  const setG = async (patch) => (S = await api.updateSettings({ general: patch }));
  const numG = (id, key, min, max, dp = 0) =>
    ($(id).oninput = debounce((e) => {
      const v = +e.target.value;
      if (e.target.value !== '' && v >= min && v <= max) setG({ [key]: dp ? Math.round(v * 10 ** dp) / 10 ** dp : Math.round(v) });
    }, 400));
  numG('#gRate', 'usdNzd', 0.5, 5, 2);
  numG('#gPoll', 'pollMins', 1, 60);
  numG('#gLmOld', 'lowestOldDays', 1, 60);
  numG('#gLmKeep', 'lowestKeepDays', 1, 365);
  $('#gStart').onchange = (e) => setG({ startTab: e.target.value });
  $('#gLogin').onchange = (e) => setG({ startOnLogin: e.target.checked });
  $('#gUpd').onchange = (e) => setG({ checkUpdates: e.target.checked });
  $$('#gNotify [data-n]').forEach(
    (b) =>
      (b.onclick = () => {
        b.classList.toggle('on');
        setG({ notify: { [b.dataset.n]: b.classList.contains('on') } });
      }),
  );
  const bk = (text, color = '') => {
    $('#bkStatus').textContent = text;
    $('#bkStatus').style.color = color;
  };
  $('#bkExport').onclick = async () => {
    try {
      const file = await api.backupExport();
      if (file) bk(`Saved to ${file}`, 'var(--green)');
    } catch (err) {
      bk(err.message, 'var(--red)');
    }
  };
  $('#bkImport').onclick = async () => {
    if (!confirm("Restore from a backup?\n\nYour sections, templates and settings are replaced with the backup's, and its history is added to yours. API keys, logins and accounts on this computer are kept.")) return;
    try {
      const r = await api.backupImport();
      if (!r) return;
      S = r.settings;
      renderSettings();
      toast('Backup restored');
      if (r.missing?.length) bk(`Restored. Sections for ${r.missing.join(', ')} weren't restored because ${r.missing.length > 1 ? "those accounts aren't" : "that account isn't"} logged in here: log in under Trade Me → Accounts, then restore again.`, 'var(--red)');
    } catch (err) {
      bk(err.message, 'var(--red)');
    }
  };
  $('#openData').onclick = () => api.openDataFolder();
  $('#clearHist').onclick = async () => {
    const n = (S.history || []).length;
    if (!n) return toast('History is already empty');
    if (!confirm(`Delete all ${n} History entries? This can't be undone (export a backup first if you might want them).`)) return;
    S = await api.clearHistory();
    toast('History cleared');
  };
  const oaStatus = (text, color = '') => {
    const st = $('#oaStatus');
    st.textContent = text;
    st.style.color = color;
  };
  $('#oaKey').onchange = async (e) => {
    const key = e.target.value.trim();
    if (!key) return;
    if (!/^sk-[\w-]{20,}$/.test(key)) return oaStatus("That doesn't look like an OpenAI API key (they start with sk-).", 'var(--red)');
    S = await api.updateSettings({ openai: { key } });
    renderSettings();
    $('#oaTest').click();
  };
  // AI photo model/quality/prompt. The prompt box shows the built-in default until you change it;
  // a prompt identical to the default is stored as '' so future default improvements still apply.
  $('#aiModel').value = S.ai?.model || 'gpt-image-2.6-sunburst';
  $('#aiQuality').value = S.ai?.quality || 'high';
  // Cost per photo: your own measured average where you have one, otherwise an estimate.
  // Estimates: ~2,200 input + ~1,550 output tokens at high (measured); medium/extra high scaled.
  const AI_EST = { medium: 0.04, high: 0.06, xhigh: 0.1 };
  const renderAiCost = () => {
    const model = $('#aiModel').value;
    const rows = [['medium', 'Medium'], ['high', 'High'], ['xhigh', 'Extra high']].map(([q, label]) => {
      const u = S.aiUsage?.[`${model}|${q}`];
      const avg = u?.n ? u.usd / u.n : null;
      const v = avg ?? AI_EST[q];
      const on = q === $('#aiQuality').value;
      return `<div class="${on ? 'on' : ''}"><span>${label}</span><b>US$${v.toFixed(2)}</b><small>≈ NZ$${nzd(v).toFixed(2)} · ${avg != null ? `your average of ${u.n}` : 'estimate'}</small></div>`;
    });
    $('#aiCost').innerHTML = `<p class="hint" style="margin:0 0 6px">Approx. cost per photo with ${model.endsWith('flare') ? 'Flare' : 'Sunburst'} (both bill at the same token rates; Flare is faster, not cheaper):</p><div class="ai-cost-row">${rows.join('')}</div>`;
  };
  renderAiCost();
  $('#aiAuto').onchange = async (e) => (S = await api.updateSettings({ ai: { autoApprove: e.target.checked } }));
  $('#aiAfterpay').onchange = async (e) => (S = await api.updateSettings({ ai: { afterpayLogo: e.target.checked } }));
  $('#aiModel').onchange = async (e) => ((S = await api.updateSettings({ ai: { model: e.target.value } })), renderAiCost());
  $('#aiQuality').onchange = async (e) => ((S = await api.updateSettings({ ai: { quality: e.target.value } })), renderAiCost());
  api.aiDefaults().then((d) => {
    const box = $('#aiPrompt');
    if (!box) return;
    box.value = S.ai?.prompt?.trim() ? S.ai.prompt : d.prompt;
    box.oninput = debounce(async () => (S = await api.updateSettings({ ai: { prompt: box.value.trim() === d.prompt.trim() ? '' : box.value } })), 500);
    $('#aiReset').onclick = async (e) => {
      e.preventDefault();
      box.value = d.prompt;
      S = await api.updateSettings({ ai: { prompt: '' } });
    };
  });
  $('#oaTest')?.addEventListener('click', async () => {
    oaStatus('Testing…');
    try {
      oaStatus(await api.openaiTest(), 'var(--green)');
    } catch (err) {
      oaStatus(err.message, 'var(--red)');
    }
  });
  $('#oaClear')?.addEventListener('click', async () => {
    S = await api.updateSettings({ openai: { key: '' } });
    renderSettings();
  });
  const dcStatus = (text, color = '') => {
    const st = $('#dcStatus');
    st.textContent = text;
    st.style.color = color;
  };
  $('#dcUrl').onchange = async (e) => {
    const url = e.target.value.trim();
    if (!url) return;
    if (!/^https:\/\/((ptb|canary)\.)?discord(app)?\.com\/api\/webhooks\/\d+\/[\w-]+/.test(url)) return dcStatus("That isn't a Discord webhook URL. It starts with https://discord.com/api/webhooks/", 'var(--red)');
    S = await api.updateSettings({ discord: { url } });
    renderSettings();
    $('#dcTest').click();
    api.discordPoll().catch(() => {}); // records existing sales/questions so only new ones are posted
  };
  $('#dcTest')?.addEventListener('click', async () => {
    dcStatus('Sending…');
    try {
      await api.discordTest();
      dcStatus('Sent. Check your Discord channel.', 'var(--green)');
    } catch (err) {
      dcStatus(err.message, 'var(--red)');
    }
  });
  $('#dcClear')?.addEventListener('click', async () => {
    S = await api.updateSettings({ discord: { url: '' } });
    renderSettings();
  });
  $$('#dcEvents [data-dc]').forEach(
    (b) =>
      (b.onclick = async () => {
        const on = !b.classList.contains('on');
        b.classList.toggle('on', on);
        S = await api.updateSettings({ discord: { events: { [b.dataset.dc]: on } } });
      }),
  );

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
  $('#traceLogin').onclick = () => traceLoginModal();
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

// Trace login popup: email and password are prefilled from the last login (the password shows as
// "saved" and is reused if left blank). Signs in straight away; the app renews the token itself later.
function traceLoginModal() {
  const saved = S.trace.viaLogin;
  const card = modal(`
    <h3>Log in to Trace</h3>
    <p class="hint modal-sub">The same email and password you use to log in to Trace.</p>
    <label class="f">Email <input id="tlEmail" type="email" spellcheck="false" autocomplete="username" value="${esc(S.trace.email || '')}" /></label>
    <label class="f">Password <input id="tlPass" type="password" autocomplete="current-password" placeholder="${saved ? '•••••••• saved — leave blank to keep' : ''}" /></label>
    <p class="hint" id="tlMsg" style="color:var(--red);margin:0"></p>
    <div class="actions"><button class="btn ghost" id="cancel">Cancel</button><button class="btn primary" id="go">Log in</button></div>`);
  const go = $('#go', card);
  $('#cancel', card).onclick = closeModal;
  const submit = async () => {
    const email = $('#tlEmail', card).value.trim();
    const password = $('#tlPass', card).value;
    if (!email || (!password && !saved)) return ($('#tlMsg', card).textContent = 'Enter your email and password.');
    go.disabled = $('#cancel', card).disabled = true;
    go.textContent = 'Logging in…';
    $('#tlMsg', card).textContent = '';
    try {
      S = await api.traceLogin({ email, password });
      closeModal();
      toast('Logged in to Trace');
      F = null;
      renderSettings();
      $('#traceTest')?.click();
    } catch (err) {
      $('#tlMsg', card).textContent = err.message;
      go.disabled = $('#cancel', card).disabled = false;
      go.textContent = 'Log in';
    }
  };
  go.onclick = submit;
  // Braces matter: returning false from onkeydown would cancel every key and block typing.
  $$('input', card).forEach((i) => (i.onkeydown = (e) => {
    if (e.key === 'Enter') submit();
  }));
  (S.trace.email ? $('#tlPass', card) : $('#tlEmail', card)).focus();
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
        ${[['general', 'General'], ['templates', 'Templates'], ['shipping', 'Shipping'], ['payment', 'Payment'], ['ai', 'AI photo']].map(([k, l]) => `<button data-t="${k}">${l}</button>`).join('')}
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

      <div data-panel="ai">
        <div class="ai-ref">
          <div class="ai-ref-img" id="aiRefImg">${p.aiRef ? '<div class="spinner"></div>' : '<span>No reference photo</span>'}</div>
          <div class="ai-ref-side">
            <p class="hint" style="margin:0 0 4px"><b>Your setup photo.</b> Take one real photo of an item where you'd shoot it.</p>
            <p class="hint" style="margin:0 0 14px">AI photos swap the listing's product into this scene, keeping the same background and lighting.</p>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <button class="btn small primary" id="aiRefPick">${p.aiRef ? 'Replace photo' : 'Add reference photo'}</button>
              ${p.aiRef ? '<button class="btn small danger" id="aiRefRm">Remove</button>' : ''}
            </div>
            <input type="file" id="aiRefFile" accept="image/jpeg,image/png,image/webp" hidden />
            <label class="f" style="margin-top:14px">What kind of item is it? (optional) <input id="aiCat" value="${esc(p.aiCategory || '')}" placeholder="${esc(String(p.category?.path || '').split('›').pop().trim().toLowerCase() || 'e.g. trading card box')}" /></label>
            <p class="hint">A couple of words telling the AI what it's placing, e.g. "trading card box" or "pair of sneakers". Leave blank to use the category name shown. Fills <code>{category}</code> in the prompt (Settings → AI photos).</p>
          </div>
        </div>
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
        <div style="display:flex;justify-content:flex-end;margin-top:14px"><button class="btn" id="tPreview">Preview</button></div>
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
  // AI photo reference for this section (stored as a file; the section keeps its name).
  if (p.aiRef)
    api.aiRef(p.aiRef).then((src) => {
      const box = $('#aiRefImg');
      if (box) box.innerHTML = src ? `<img src="${src}" alt=""/>` : '<span>Reference photo missing — add it again</span>';
    });
  $('#aiRefPick').onclick = () => $('#aiRefFile').click();
  $('#aiRefFile').onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const raw = await new Promise((res) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.readAsDataURL(f);
    });
    try {
      // Re-encode as JPEG (max 2000px) so AVIF/HEIC-ish oddities and huge phone photos are handled.
      p.aiRef = await api.aiSaveRef({ key: `${defAcc || 'all'}-${p.id}`, dataUrl: await toJpeg(raw) });
      save();
      renderSections();
    } catch (err) {
      toast(err.message);
    }
  };
  $('#aiRefRm')?.addEventListener('click', () => {
    delete p.aiRef;
    save();
    renderSections();
  });
  $('#aiCat').oninput = (e) => ((p.aiCategory = e.target.value), save());

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
  $('#tPreview').onclick = () => previewTemplates(p);
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
  pruneLiveMatch();
  go(S.accounts.some((a) => a.env === S.env) ? G().startTab || 'new' : 'settings');
  restoreAiJobs(); // AI photos (and queued listings) waiting from last time
  api.onGoto((v) => go(v)); // clicked a desktop notification
  if (G().checkUpdates)
    setTimeout(
      () =>
        api
          .checkUpdate()
          .then((r) => r?.available && toast(`Tagline ${r.latest} is out — Settings → General → Updates`, 8000))
          .catch(() => {}),
      4000,
    );
})();
