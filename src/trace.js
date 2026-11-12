// Trace (jointrace.co) sign-in for product lookup.
// Signs in with your Trace email and password, the same request Trace's web app makes, and keeps
// the token it returns. When that token expires, main.js signs in again with the saved details,
// so you never log in by hand after the first time.
const API = 'https://fulltrace-server.onrender.com';

// Trace only accepts sign-ins that say they come from its web app (an Origin header is required).
const ORIGIN = 'https://app.jointrace.co';

async function signIn(email, password) {
  const origin = ORIGIN;
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
  // The set-auth-token header is the token Trace's web app uses for API calls (the body's "token" is
  // the raw session id, which the API refuses). Fall back to the body only if the header is missing.
  const token = res.headers.get('set-auth-token') || j?.token;
  if (!token) throw new Error('Trace signed you in but sent no token back.');
  await pickStore(token, origin);
  return token;
}

// If the session has no store selected yet, select the first one you belong to (what Trace's store
// switcher does). Best effort: any failure here is ignored and the lookup reports its own error.
async function pickStore(token, origin) {
  const h = { Authorization: `Bearer ${token}`, Accept: 'application/json', Origin: origin, 'Content-Type': 'application/json' };
  try {
    const session = await (await fetch(`${API}/api/auth/get-session`, { headers: h })).json();
    if (session?.session?.activeOrganizationId) return;
    const orgs = await (await fetch(`${API}/api/auth/organization/list`, { headers: h })).json();
    const first = Array.isArray(orgs) ? orgs[0] : orgs?.data?.[0];
    if (first?.id) await fetch(`${API}/api/auth/organization/set-active`, { method: 'POST', headers: h, body: JSON.stringify({ organizationId: first.id }) });
  } catch {}
}

module.exports = { signIn };
