// Trace (jointrace.co) sign-in for product lookup.
// Signs in with your Trace email and password, the same request Trace's web app makes, and keeps
// the token it returns. When that token expires, main.js signs in again with the saved details,
// so you never log in by hand after the first time.
const API = 'https://fulltrace-server.onrender.com';

const DEFAULT_SITE = 'https://app.jointrace.co';
// "consign.mystore.com/login" → "https://consign.mystore.com". Stores on Trace have their own
// dashboard address, and Trace only accepts sign-ins that come from it.
const siteOrigin = (site) => {
  try {
    const s = String(site || '').trim();
    return s ? new URL(/^https?:\/\//i.test(s) ? s : 'https://' + s).origin : DEFAULT_SITE;
  } catch {
    throw new Error("That Trace website address doesn't look right. Use the address you log in at, e.g. app.jointrace.co.");
  }
};

async function signIn(email, password, site) {
  const origin = siteOrigin(site);
  let res;
  try {
    res = await fetch(`${API}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: '*/*', Origin: origin, Referer: origin + '/' },
      body: JSON.stringify({ email, password }),
    });
  } catch {
    throw new Error("Couldn't reach Trace. Check your internet and try again.");
  }
  const j = await res.json().catch(() => null);
  if (res.status === 401 || res.status === 400) throw new Error('Trace says that email or password is wrong.');
  if (!res.ok) throw new Error(j?.message || `Trace sign-in failed (${res.status}). Try again in a minute.`);
  // Trace returns the token in the body; some versions also send it as a header.
  const token = j?.token || res.headers.get('set-auth-token');
  if (!token) throw new Error('Trace signed you in but sent no token back.');
  return token;
}

module.exports = { signIn, siteOrigin, DEFAULT_SITE };
