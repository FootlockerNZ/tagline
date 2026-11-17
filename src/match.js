// "Find lowest exact match": asks an OpenAI model which similar Trade Me listings are really the same
// product as ours (same model, colourway/edition and condition; size reported separately), looking at
// both titles and photos. The cheapest true match is then the price to beat.
const store = require('./store');

const MODEL = 'gpt-5.5';

const SYSTEM = `You compare second-hand-marketplace listings to decide which are the SAME product as ours.
Same product means: same brand, same model, same colourway / edition / version and the same item type (e.g. a pair of shoes vs a single, a booster box vs a single pack). Different sizes of the same product still count as the same product, but report the size match separately.
Be strict: if a detail that changes the product (colourway, edition, men's vs women's vs kids' sizing line, GS vs adult, "SE"/"PRM" variants, bundle vs single item) differs or can't be confirmed from the title and photo, it is NOT a match. Generic titles with a matching photo can be a match.
Answer only with JSON: {"results":[{"id":<listing id>,"match":true|false,"sameSize":true|false|null,"confidence":0-1,"reason":"<= 12 words"}]} with one entry per listing given.`;

async function findMatches({ product, comps }) {
  const key = store.openaiKey();
  if (!key) throw new Error('Add your OpenAI API key in Settings → AI photos first (the same key is used here).');
  if (!comps?.length) return { results: [], model: MODEL };
  const ours = [
    `OUR LISTING`,
    `Title: ${product.title || ''}`,
    product.brand && `Brand: ${product.brand}`,
    product.name && `Model / name: ${product.name}`,
    product.sku && `Style code / SKU: ${product.sku}`,
    product.colour && `Colour: ${product.colour}`,
    product.size && `Size: ${product.size}`,
    `Condition: ${product.condition || 'Brand new'}`,
  ]
    .filter(Boolean)
    .join('\n');
  const content = [{ type: 'text', text: ours }];
  if (/^(https?:|data:image\/)/.test(product.image || '')) content.push({ type: 'image_url', image_url: { url: product.image, detail: 'low' } });
  content.push({ type: 'text', text: `\nCANDIDATE LISTINGS (${comps.length}):` });
  for (const c of comps) {
    content.push({ type: 'text', text: `\n#${c.id} · $${c.price} · "${c.title}"${c.size ? ` · size field: ${c.size}` : ''}` });
    if (/^https?:/.test(c.picture || '')) content.push({ type: 'image_url', image_url: { url: c.picture, detail: 'low' } });
  }
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content },
      ],
    }),
  });
  const j = await res.json().catch(() => ({}));
  if (res.status === 401) throw new Error('OpenAI rejected the API key. Check it in Settings → AI photos.');
  if (!res.ok) throw new Error(j.error?.message || `OpenAI ${res.status}`);
  let parsed;
  try {
    parsed = JSON.parse(j.choices?.[0]?.message?.content || '{}');
  } catch {
    throw new Error("The AI's answer couldn't be read. Try again.");
  }
  // GPT-5.5 rates: $5 / 1M input, $30 / 1M output tokens. Added to the running total in Settings.
  const u = j.usage || {};
  const cost = ((u.prompt_tokens || 0) * 5 + (u.completion_tokens || 0) * 30) / 1e6;
  const prev = store.load().aiMatchUsage || { n: 0, usd: 0 };
  store.updateSettings({ aiMatchUsage: { n: prev.n + 1, usd: Math.round((prev.usd + cost) * 1e6) / 1e6 } });
  const ids = new Set(comps.map((c) => String(c.id)));
  const results = (parsed.results || []).filter((r) => ids.has(String(r.id))).map((r) => ({ id: +r.id, match: !!r.match, sameSize: r.sameSize ?? null, confidence: +r.confidence || 0, reason: String(r.reason || '').slice(0, 120) }));
  return { results, model: MODEL, usage: j.usage, cost };
}

module.exports = { findMatches };
