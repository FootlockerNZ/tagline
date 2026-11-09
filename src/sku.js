// SKU → brand guess. This is only the backup: the brand Trace returns for the product wins.
const BRANDS = {
  nike: { label: 'Nike', re: /^[A-Z0-9]{6}-\d{3}$/ }, // DD1391-100 (also Jordan)
  asics: { label: 'ASICS', re: /^[A-Z0-9]{8}-\d{3}$/ }, // 1011B548-001, 1201A019-108
  adidas: { label: 'Adidas', re: /^(?=.{6}$)[A-Z]{1,2}\d{4,5}$/ }, // IE0421, B75806
  newbalance: { label: 'New Balance', re: /^[A-Z]{1,3}\d{3,4}[A-Z0-9]{1,5}$/ }, // M990GL6, U9060MAC, BB550WT1
  puma: { label: 'Puma', re: /^\d{6}-?\d{2}$/ }, // 39372801, 393728-01
  hoka: { label: 'Hoka', re: /^\d{7}(-[A-Z]{2,5})?$/ }, // 1127895, 1127895-BBLC (style + colour code)
  birkenstock: { label: 'Birkenstock', re: /^\d{7}$/ }, // 1027066 (same shape as a bare Hoka number)
};

const normalize = (sku) => String(sku || '').trim().toUpperCase().replace(/\s+/g, '');

// Every brand whose pattern fits. More than one (e.g. 7 digits: Hoka or Birkenstock) means
// the pattern can't tell, and Trace has to decide.
// Patterns are checked in order and the first wins, except a bare 7-digit number, which really is
// either Hoka or Birkenstock.
function detectAll(sku) {
  const all = Object.entries(BRANDS).filter(([, b]) => b.re.test(normalize(sku))).map(([id]) => id);
  return all[0] === 'hoka' && all.includes('birkenstock') ? ['hoka', 'birkenstock'] : all.slice(0, 1);
}
const detect = (sku) => detectAll(sku)[0] || 'other';

const TYPES = { 'image/jpeg': 'JPG', 'image/jpg': 'JPG', 'image/png': 'PNG', 'image/gif': 'GIF', 'image/bmp': 'BMP' };

async function fetchImage(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36',
      Accept: 'image/avif,image/webp,image/png,image/jpeg,*/*;q=0.8',
    },
  });
  if (!res.ok) throw new Error(`Image ${res.status} from ${new URL(url).host}`);
  const mime = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!mime.startsWith('image/')) throw new Error(`Not an image (${mime || 'unknown type'})`);
  return { buffer: Buffer.from(await res.arrayBuffer()), mime };
}

module.exports = { BRANDS, normalize, detect, detectAll, fetchImage, TYPES };
