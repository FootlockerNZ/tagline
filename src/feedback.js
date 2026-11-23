// Feedback for buyers. Automatic: once NZ Post shows a sale's parcel as delivered, one short positive
// comment is posted (positive only, production only, sales from after the setting was switched on).
// Manual: "Leave feedback" on the Sold page posts the text the seller wrote (or an AI draft). Both go
// through leave(), so nothing is posted twice. OpenAI writes the comments; a built-in one is used if that fails.
const store = require('./store');

const MODEL = 'gpt-5-mini';
const MAX_TRIES = 3; // a failed automatic post is retried this many times, then left alone
const PER_RUN = 10; // automatic posts (or attempts) per background check
const AUTO_MAX = 80; // the AI comment's length (well under Trade Me's limit)
const TM_MAX = 500; // Trade Me's limit on feedback text (from a Trade Me help-forum post; not in the API docs)
const POSITIVE = 1; // Trade Me FeedbackType: 0 Negative, 1 Positive, 2 Neutral
const ALREADY_PLACED = 1; // Trade Me StatusCode: feedback is already on the purchase

const FALLBACK = [
  'Thanks for buying, a pleasure to sell to you!',
  'Great buyer, thanks heaps!',
  'Smooth sale, thanks so much!',
  'Thanks a lot, enjoy your purchase!',
  'Pleasure doing business with you, cheers!',
  'Top buyer, thanks for the great sale!',
];

const RULES = `You write one short positive feedback comment for a buyer on Trade Me (New Zealand), left by the seller after a sale.
- Under 80 characters. Very general: thank them, say it was a pleasure or a good sale.
- No names, prices, product details or emoji, unless the seller's style asks for them.
- Vary the wording. Don't repeat any of the comments listed as already used.
- Reply with the comment only: no quotes, no label.`;

const pick = (a) => a[Math.floor(Math.random() * a.length)];
// Trade Me dates come back as "/Date(ms)/" in JSON.
const msOf = (d) => {
  const m = /Date\((\d+)/.exec(d || '');
  return m ? +m[1] : Date.parse(d || '') || 0;
};
const recentTexts = () => (store.load().feedback?.log || []).filter((e) => e.ok).slice(0, 5).map((e) => e.text);

// One chat call per comment. Any failure (no key, network, bad reply, too long) uses the built-in list.
// Returns { text, ai } so the window can say when the built-in one was used.
async function writeComment(style, recent) {
  const key = store.openaiKey();
  if (!key) return { text: pick(FALLBACK), ai: false };
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        max_completion_tokens: 1000,
        messages: [
          { role: 'system', content: RULES + (style ? `\nThe seller's style: ${style}` : '') },
          { role: 'user', content: recent.length ? `Already used: ${recent.join(' | ')}` : 'Write one comment.' },
        ],
      }),
    });
    const j = await res.json().catch(() => ({}));
    const text = String(j.choices?.[0]?.message?.content || '').trim().replace(/^["'“]|["'”]$/g, '');
    if (res.ok && text && text.length <= AUTO_MAX && !text.includes('\n')) return { text, ai: true };
  } catch {
    /* fall through to the built-in list */
  }
  return { text: pick(FALLBACK), ai: false };
}

// Window's "Generate with AI": a draft in the same style, for the seller to edit.
async function generate() {
  const f = store.load().feedback || {};
  return writeComment(f.style, recentTexts());
}

// Posts one Positive feedback and records it (ok or failed, with tries). Returns { ok, error }.
async function attempt(tm, acc, item, text, prevTries) {
  // Trade Me takes exactly one id: the purchase (points at this buyer) when there is one, else the listing.
  const body = { FeedbackType: POSITIVE, Text: text, ...(item.PurchaseId ? { PurchaseId: item.PurchaseId } : { ListingId: item.ListingId }) };
  let ok = false;
  let error = '';
  try {
    // POST /v1/MyTradeMe/Feedback.json (docs: "Post feedback on a listing").
    const r = await tm.api(acc, 'POST', '/v1/MyTradeMe/Feedback.json', body);
    ok = !!r?.Success || r?.StatusCode === ALREADY_PLACED; // already there counts as done
    if (!ok) error = r?.Description || `Trade Me status ${r?.StatusCode}`;
  } catch (e) {
    error = e.message;
  }
  store.feedbackRecord({ purchaseId: String(item.PurchaseId || ''), listingId: item.ListingId, title: item.Title, account: acc.nickname, text, ok, error, tries: (prevTries || 0) + 1, at: new Date().toISOString() });
  if (ok) {
    store.addHistory({
      action: 'feedback',
      title: item.Title,
      listingId: item.ListingId,
      url: tm.listingUrl(acc.env, item.ListingId),
      accountNickname: acc.nickname,
      env: acc.env,
      detail: `“${text}”`,
      thumb: item.PictureHref || item.picture,
    });
  }
  return { ok, error };
}

// Manual: the seller's own text, posted now. Refuses if this sale already has feedback from us.
async function leave({ tm, acc, item, text }) {
  const t = String(text || '').trim();
  if (!t) throw new Error('Write a comment first.');
  if (t.length > TM_MAX) throw new Error(`Trade Me allows ${TM_MAX} characters. This is ${t.length}.`);
  const rec = (store.load().feedback?.log || []).find((e) => String(e.purchaseId) === String(item.PurchaseId));
  if (rec?.ok) throw new Error('Feedback is already left for this sale.');
  const r = await attempt(tm, acc, item, t, rec?.tries);
  if (!r.ok) throw new Error(r.error || "Trade Me didn't accept the feedback. Try again.");
  return { ok: true };
}

// Is this sale ready for automatic feedback? Only once NZ Post shows a booked parcel delivered
// (the same check as track:status). Sales without tracking are left for the manual button.
async function delivered(i, track) {
  for (const p of i.TrackedParcels || []) {
    if (!p.TrackingReference) continue;
    if ((await track(p.TrackingReference).catch(() => null))?.delivered) return true;
  }
  return false;
}

// Background run: called from the sales/questions timer. track is main.js's NZ Post lookup.
async function run({ tm, accounts, track }) {
  const f = store.load().feedback || {};
  if (!f.auto || !f.since) return;
  const since = Date.parse(f.since);
  const recs = new Map((f.log || []).map((e) => [String(e.purchaseId), e]));
  const recent = recentTexts();
  let attempts = 0;
  for (const acc of accounts) {
    if (acc.env !== 'production') continue;
    const sold = await tm.api(acc, 'GET', '/v1/MyTradeMe/SoldItems/Last45Days.json?rows=200&photo_size=List').catch(() => null);
    for (const i of sold?.List || []) {
      if (attempts >= PER_RUN) return;
      const id = String(i.PurchaseId || '');
      const rec = recs.get(id);
      // HasSellerPlaceFeedback is the documented field name (Retrieve your sold items).
      if (!id || i.HasSellerPlaceFeedback || rec?.ok || (rec?.tries || 0) >= MAX_TRIES) continue;
      if (msOf(i.SoldDate) < since) continue;
      if (!(await delivered(i, track))) continue;

      attempts++;
      const { text } = await writeComment(f.style, recent);
      const r = await attempt(tm, acc, i, text, rec?.tries);
      if (r.ok) {
        recent.unshift(text);
        recent.length = Math.min(recent.length, 5);
      } else {
        console.warn('[feedback]', i.Title, r.error);
      }
    }
  }
}

module.exports = { run, generate, leave };
