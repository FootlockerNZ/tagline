// Trace (jointrace.co) sign-in for product lookup.
// Signs in with your Trace email and password, the same request Trace's web app makes, and keeps
// the token it returns. When that token expires, main.js signs in again with the saved details,
// so you never log in by hand after the first time.
const API = 'https://fulltrace-server.onrender.com';

async function signIn(email, password) {
  let res;
  try {
    res = await fetch(`${API}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: '*/*', Origin: 'https://app.jointrace.co', Referer: 'https://app.jointrace.co/' },
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

module.exports = { signIn };
