// AI hero photos: puts the listing's product photo into a section's reference photo (a real photo of
// your setup) with OpenAI's image edit API, so the main photo looks like you took it.
const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const store = require('./store');

const MODELS = ['gpt-image-2.6-sunburst', 'gpt-image-2.6-flare'];
const QUALITIES = ['medium', 'high', 'xhigh'];

// Placeholders: {product} {brand} {name} {colour} {sku} {category} {section}
const DEFAULT_PROMPT = `You are making the main photo for an online marketplace listing. You get two images:

- Image 1 — REFERENCE: our own real photo, taken in our store, of a different item. This sets the scene and the look.
- Image 2 — PRODUCT: a stock photo of {product}, the item to photograph.

Produce the photo we would get if we removed the item from Image 1, put {product} in the same spot, and took the picture with the same phone camera.

Keep from Image 1 (the scene):
- Background, wall, table/surface, props, camera height and angle, lens perspective, depth of field.
- Lighting direction, softness and colour temperature, shadows, reflections, white balance, grain/noise and overall phone-photo look.

Product accuracy (most important):
- Reproduce the product from Image 2 exactly: same shape, proportions, colours, materials, printing, artwork, logos, text, tags and colourway. Do not restyle or "improve" it, and do not add or change brand marks or text.
- Keep every printed element on the face it appears on in Image 2; don't move text or labels from one side of the product to another.
- Present it the way the item in Image 1 is presented (e.g. standing upright, front facing the camera), turning it to that view if Image 2 shows it from another angle.
- If part of the product is cut off, hidden or out of frame in Image 2, complete it the way the real item would plausibly look, continuing the visible design, colours and edges (e.g. the rest of a box panel, a hang tab, a back corner). Keep completed areas simple and consistent with what is visible — never add new text, logos, artwork or features that aren't implied by the visible parts.

Size and framing:
- Show the product at its true real-world size relative to the scene (judge it against the item in Image 1 and the table/wall). Do not shrink or stretch it to fit the old item's space.
- If the product is bigger than the item in Image 1, zoom the camera out: extend the scene outward in the same style — continue the table, wall, floor and background naturally — so the whole product fits with comfortable margins. Keep the camera height, angle and perspective consistent, and light the extended areas the same way.
- If it is smaller, keep Image 1's framing; don't zoom in so far that the scene loses its context.
- The whole product must be in frame, not cropped, and roughly where the item sits in Image 1.

Realism:
- Relight the product to match Image 1: same light direction and softness, matching highlights, gloss and reflections on its materials (e.g. shrink-wrap, foil, holographic print).
- Natural contact shadow and soft cast shadow on the wall/surface, consistent with Image 1's shadows.
- Match Image 1's focus, sharpness, noise and white balance so nothing looks pasted in. No white edges, halos or cut-out artefacts.

The item from Image 1 must not appear in the result. Do not add new objects, text, watermarks or borders. Output one photorealistic photo in Image 1's aspect ratio: Image 1's framing, or a wider version of it when the product needs more room.`;

const refsDir = () => path.join(app.getPath('userData'), 'ai-refs');
const safeName = (s) => String(s).replace(/[^\w.-]/g, '_').slice(0, 80);

function parseDataUrl(dataUrl) {
  const m = /^data:(image\/[\w+.-]+);base64,(.+)$/.exec(String(dataUrl || ''));
  if (!m) throw new Error('Not an image.');
  return { type: m[1], buffer: Buffer.from(m[2], 'base64') };
}
const EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };

// Reference photos live as files (too big for settings.json); sections store the file name.
function saveRef(key, dataUrl) {
  const { type, buffer } = parseDataUrl(dataUrl);
  if (!EXT[type]) throw new Error('Use a JPG, PNG or WebP photo.');
  fs.mkdirSync(refsDir(), { recursive: true });
  const file = `${safeName(key)}-${Date.now()}${EXT[type]}`;
  fs.writeFileSync(path.join(refsDir(), file), buffer);
  return file;
}
function readRef(file) {
  const p = path.join(refsDir(), path.basename(String(file || '')));
  if (!file || !fs.existsSync(p)) return null;
  const type = Object.entries(EXT).find(([, e]) => p.endsWith(e))?.[0] || 'image/jpeg';
  return { type, buffer: fs.readFileSync(p) };
}
// Put back a reference photo from a backup, under its original file name.
function writeRef(file, dataUrl) {
  const { buffer } = parseDataUrl(dataUrl);
  fs.mkdirSync(refsDir(), { recursive: true });
  fs.writeFileSync(path.join(refsDir(), path.basename(String(file))), buffer);
}
const refDataUrl = (file) => {
  const r = readRef(file);
  return r ? `data:${r.type};base64,${r.buffer.toString('base64')}` : null;
};

const fillPrompt = (tpl, vars) => String(tpl || DEFAULT_PROMPT).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k] ?? '').trim() || (k === 'product' ? 'the product' : '') : m));

async function callOpenAI({ key, model, quality, prompt, ref, product }) {
  const form = new FormData();
  form.append('model', model);
  form.append('prompt', prompt);
  // Order matters: the prompt calls these Image 1 (reference) and Image 2 (product).
  form.append('image[]', new Blob([ref.buffer], { type: ref.type }), '1-reference' + (EXT[ref.type] || '.jpg'));
  form.append('image[]', new Blob([product.buffer], { type: product.type }), '2-product' + (EXT[product.type] || '.jpg'));
  form.append('quality', quality);
  form.append('size', 'auto');
  form.append('n', '1');
  const res = await fetch('https://api.openai.com/v1/images/edits', { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(j.error?.message || `OpenAI ${res.status}`);
    err.code = j.error?.code || j.code || '';
    err.status = res.status;
    throw err;
  }
  return { b64: j.data?.[0]?.b64_json, usage: j.usage };
}

// GPT Image 2.6 rates (USD per 1M tokens, Sunburst and Flare alike): text in $5, image in $8, image out $30.
const usd = (u) => {
  if (!u) return null;
  const imgIn = u.input_tokens_details?.image_tokens ?? 0;
  const textIn = u.input_tokens_details?.text_tokens ?? Math.max(0, (u.input_tokens || 0) - imgIn);
  const out = u.output_tokens || 0;
  return (textIn * 5 + imgIn * 8 + out * 30) / 1e6;
};
// Running average cost per model + quality, from your own photos.
function recordCost(model, quality, cost) {
  if (cost == null) return;
  const s = store.load();
  const k = `${model}|${quality}`;
  const cur = s.aiUsage?.[k] || { n: 0, usd: 0 };
  store.updateSettings({ aiUsage: { [k]: { n: cur.n + 1, usd: Math.round((cur.usd + cost) * 1e6) / 1e6 } } });
}

// One photo. OpenAI's safety filter sometimes blocks busy branded artwork by mistake, so a block is
// retried once before giving up.
async function generate({ refFile, productDataUrl, vars }) {
  const key = store.openaiKey();
  if (!key) throw new Error('Add your OpenAI API key in Settings → AI photos first.');
  const ref = readRef(refFile);
  if (!ref) throw new Error('This section has no reference photo. Add one under Defaults → (section) → AI photo.');
  const product = parseDataUrl(productDataUrl);
  const cfg = store.load().ai || {};
  const model = MODELS.includes(cfg.model) ? cfg.model : MODELS[0];
  const quality = QUALITIES.includes(cfg.quality) ? cfg.quality : 'high';
  const prompt = fillPrompt(cfg.prompt?.trim() ? cfg.prompt : DEFAULT_PROMPT, vars || {});
  for (let attempt = 1; ; attempt++) {
    try {
      const { b64, usage } = await callOpenAI({ key, model, quality, prompt, ref, product });
      if (!b64) throw new Error('OpenAI returned no image.');
      const cost = usd(usage);
      recordCost(model, quality, cost);
      return { dataUrl: `data:image/png;base64,${b64}`, model, quality, cost };
    } catch (e) {
      if (e.code === 'moderation_blocked' && attempt < 2) continue;
      if (e.code === 'moderation_blocked') throw new Error("OpenAI's safety filter blocked this photo twice. This happens with some busy branded artwork; try again, or use a different product photo.");
      if (e.status === 401) throw new Error('OpenAI rejected the API key. Check it in Settings → AI photos.');
      throw e;
    }
  }
}

// The AI photo queue is saved to disk (one JSON file per job, images included) so it survives
// closing the app. Jobs that were still generating when the app closed come back as "interrupted".
const jobsDir = () => path.join(app.getPath('userData'), 'ai-jobs');
function saveJob(job) {
  if (!/^[\w-]+$/.test(String(job?.id))) throw new Error('Bad job id');
  fs.mkdirSync(jobsDir(), { recursive: true });
  fs.writeFileSync(path.join(jobsDir(), `${job.id}.json`), JSON.stringify(job));
  return true;
}
function loadJobs() {
  if (!fs.existsSync(jobsDir())) return [];
  return fs
    .readdirSync(jobsDir())
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(jobsDir(), f), 'utf8'));
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => (a.started || 0) - (b.started || 0));
}
function deleteJob(id) {
  const p = path.join(jobsDir(), `${path.basename(String(id))}.json`);
  if (fs.existsSync(p)) fs.unlinkSync(p);
  return true;
}

module.exports = { DEFAULT_PROMPT, MODELS, QUALITIES, saveRef, writeRef, refDataUrl, generate, saveJob, loadJobs, deleteJob };
