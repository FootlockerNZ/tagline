// Discord webhook notifications: app activity (listed, price changes, withdrawals…), new sales and
// new buyer questions. The webhook URL is set in Settings and stored encrypted.
const store = require('./store');

const WEBHOOK_RE = /^https:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+/;
const isWebhook = (u) => WEBHOOK_RE.test(String(u || '').trim());

const COLORS = { listed: 0x57f287, sale: 0xfee75c, question: 0x5865f2, price: 0xeb459e, edited: 0x5865f2, withdrawn: 0xed4245, 'sold-elsewhere': 0xfee75c, relisted: 0x57f287, 'relist-failed': 0xed4245, answered: 0x5865f2, feedback: 0x57f287 };
const TITLES = {
  listed: 'New listing',
  edited: 'Listing edited',
  price: 'Price changed',
  withdrawn: 'Listing withdrawn',
  'sold-elsewhere': 'Sold elsewhere',
  relisted: 'Relisted',
  'relist-failed': 'Relist failed',
  archived: 'Archived',
  unarchived: 'Unarchived',
  answered: 'Question answered',
  feedback: 'Feedback left',
  'account-added': 'Account added',
  'account-removed': 'Account removed',
};
const money = (n) => (n == null || n === '' ? '' : '$' + (Number.isInteger(+n) ? +n : (+n).toFixed(2)));

// Discord allows ~5 requests / 2s per webhook; send one at a time and honour 429 retry_after.
let queue = Promise.resolve();
function post(url, payload) {
  queue = queue.then(async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'Tagline', ...payload }) });
      if (res.status === 429) {
        const j = await res.json().catch(() => ({}));
        await new Promise((r) => setTimeout(r, Math.ceil((j.retry_after || 1) * 1000)));
        continue;
      }
      if (!res.ok) throw new Error(`Discord ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return true;
    }
    throw new Error('Discord kept rate-limiting the webhook.');
  });
  return queue;
}

function embed({ kind, title, url, description, fields = [], thumb, account }) {
  return {
    title: String(title || '').slice(0, 256),
    url: url || undefined,
    description: description ? String(description).slice(0, 2000) : undefined,
    color: COLORS[kind] ?? 0x99aab5,
    fields: fields.filter((f) => f.value !== '' && f.value != null).map((f) => ({ name: f.name, value: String(f.value).slice(0, 1024), inline: f.inline !== false })),
    thumbnail: /^https?:\/\//.test(thumb || '') ? { url: thumb } : undefined,
    footer: account ? { text: account } : undefined,
    timestamp: new Date().toISOString(),
  };
}

// Fire-and-forget: a Discord problem must never break listing.
function send(kind, payload) {
  const d = store.discordConfig();
  if (!isWebhook(d.url) || d.events?.[kind] === false) return;
  post(d.url, { embeds: [embed(payload)] }).catch((e) => console.warn('[discord]', e.message));
}

// Everything the app logs to History, as an activity message.
function history(e) {
  if (!e?.action || e.env === 'sandbox') return;
  const head = TITLES[e.action] || e.action;
  const change = e.from != null && e.to != null && e.from !== e.to ? `${money(e.from)} → ${money(e.to)}` : '';
  send('activity', {
    kind: e.action,
    title: e.title ? `${head}: ${e.title}` : head,
    url: e.url,
    description: e.detail,
    thumb: e.thumb,
    account: e.accountNickname,
    fields: [
      { name: 'Price', value: change || money(e.price) },
      { name: 'SKU', value: e.sku },
      { name: 'Listing', value: e.listingId ? `#${e.listingId}` : '' },
    ],
  });
}

async function test(url) {
  const u = String(url || store.discordConfig().url).trim();
  if (!isWebhook(u)) throw new Error('That isn\'t a Discord webhook URL. It should start with https://discord.com/api/webhooks/');
  await post(u, { embeds: [embed({ kind: 'listed', title: 'Tagline is connected', description: 'You\'ll get messages here for the things you switched on in Settings.' })] });
  return true;
}

// Background check for new sales and questions on every account (production only). It always runs,
// since the window refreshes from it too; Discord and desktop notifications only send for kinds that
// are switched on. The first run after setting a webhook only records what's there, so old ones aren't
// posted. notify(fresh) gets the new ones for desktop notifications; activity(kinds) tells the window.
async function poll({ tm, accounts, notify, activity }) {
  const d = store.discordConfig();
  const g = store.load().general?.notify || {};
  const seen = { sales: new Set(d.seen.sales), questions: new Set(d.seen.questions) };
  const fresh = [];
  for (const acc of accounts) {
    if (acc.env === 'sandbox') continue;
    const sold = await tm.api(acc, 'GET', '/v1/MyTradeMe/SoldItems/Last45Days.json?rows=200&photo_size=List').catch(() => null);
    for (const i of sold?.List || []) {
      const key = String(i.PurchaseId || `${i.ListingId}-${i.SoldDate}`);
      if (seen.sales.has(key)) continue;
      seen.sales.add(key);
      fresh.push(['sales', {
        kind: 'sale',
        title: `Sold: ${i.Title}`,
        url: tm.listingUrl(acc.env, i.ListingId),
        thumb: i.PictureHref,
        account: acc.nickname,
        fields: [
          { name: 'Price', value: money(i.SubtotalPrice ?? i.SalePrice ?? i.Price) },
          { name: 'Qty', value: (i.QuantitySold || 1) > 1 ? i.QuantitySold : '' },
          { name: 'Buyer', value: i.Buyer?.Nickname },
        ],
      }]);
    }
    const questions = await tm.api(acc, 'GET', '/v1/Listings/Questions/UnansweredQuestions.json').catch(() => null);
    for (const q of questions?.List || []) {
      const key = String(q.ListingQuestionId);
      if (seen.questions.has(key)) continue;
      seen.questions.add(key);
      fresh.push(['questions', {
        kind: 'question',
        title: `Question on #${q.ListingId}`,
        url: tm.listingUrl(acc.env, q.ListingId),
        description: q.Comment,
        account: acc.nickname,
        fields: [{ name: 'From', value: q.AskingMember?.Nickname }],
      }]);
    }
  }
  if (d.primed) {
    for (const [kind, p] of fresh) send(kind, p); // send() skips kinds switched off for Discord
    notify?.(fresh.filter(([kind]) => g[kind]));
    const kinds = [...new Set(fresh.map(([kind]) => kind))];
    if (kinds.length) activity?.(kinds);
  }
  store.discordSeen({ sales: [...seen.sales], questions: [...seen.questions] }, true);
}

module.exports = { isWebhook, history, test, poll };
