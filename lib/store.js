// Where the jkb CLI and the MCP connector read and write the checklist.
//
// Live (default): Joseph's row in the Supabase table app_state (project nbgmegpqxzvgvtqqlvko), the same
// data the app and Atlas use, reached through his own login so Row Level Security lets it touch only his
// row, exactly like the app. Every write is a compare-and-swap on state_saved_at: it only lands if nothing
// was saved since we read, so a change he just made on his phone is never overwritten; on a conflict we
// re-read and apply the same change on top of his. Open apps pick the change up live (Supabase Realtime),
// because state_saved_at moves forward.
//
// Local file (tests / offline): set JKB_STATE_FILE to a JSON file with the same shape.
const fs = require("fs");
const path = require("path");
const tasks = require("./tasks");

const SUPABASE_URL = (process.env.JKB_SUPABASE_URL || "https://nbgmegpqxzvgvtqqlvko.supabase.co").replace(/\/$/, "");
// The project's publishable key: public by design (app.html ships it too); Row Level Security protects the data.
const ANON_KEY = process.env.JKB_SUPABASE_ANON_KEY || "sb_publishable_JTjhzlocGXAOGAeKM30YzA_c4Q2Gjcr";
const ROOT = process.env.JKB_DIR || path.join(__dirname, "..", ".jkb");
const SESSION_FILE = path.join(ROOT, "session.json");
const LOCAL_FILE = process.env.JKB_STATE_FILE || null;

// ---- sign-in (the session lives only in .jkb/, which git ignores)

function readSession() { try { return JSON.parse(fs.readFileSync(SESSION_FILE, "utf8")); } catch (e) { return null; } }
function keepSession(data) {
  const s = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: data.expires_at || Math.floor(Date.now() / 1000) + (data.expires_in || 3600),
    user_id: data.user && data.user.id,
    email: data.user && data.user.email,
  };
  if (!s.access_token || !s.refresh_token || !s.user_id) throw new Error("Sign-in did not return a session.");
  fs.mkdirSync(ROOT, { recursive: true, mode: 0o700 });
  fs.writeFileSync(SESSION_FILE, JSON.stringify(s, null, 2), { mode: 0o600 });
  return s;
}

async function http(method, url, { body, token, headers = {} } = {}) {
  const res = await fetch(url, {
    method,
    headers: { apikey: ANON_KEY, "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
  if (!res.ok) {
    const why = (data && (data.error_description || data.msg || data.message || data.error)) || res.statusText;
    const err = new Error(`${res.status} ${why}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

async function login(email, password) {
  return keepSession(await http("POST", `${SUPABASE_URL}/auth/v1/token?grant_type=password`, { body: { email, password } }));
}

// Phone-friendly sign-in: email a one-time sign-in link (Supabase's normal magic link)...
async function sendLink(email) {
  await http("POST", `${SUPABASE_URL}/auth/v1/otp`, { body: { email, create_user: false } });
}
// ...then finish with that link, or just its token, pasted back. Single-use; it expires after an hour.
async function loginWithLink(linkOrToken) {
  let token = String(linkOrToken || "").trim(), type = "magiclink";
  try {
    const u = new URL(token);
    token = u.searchParams.get("token") || u.searchParams.get("token_hash") || "";
    type = u.searchParams.get("type") || type;
  } catch (e) { /* not a URL: treat it as the token itself */ }
  if (!token) throw new Error("That doesn't look like a sign-in link.");
  return keepSession(await http("POST", `${SUPABASE_URL}/auth/v1/verify`, { body: { type, token_hash: token } }));
}

async function session() {
  let s = readSession();
  if (!s || !s.refresh_token) {
    throw new Error("Not signed in. Run: jkb login   (from a phone: jkb login --email you@example.com, then jkb login --link '<link from the email>')");
  }
  if (!s.expires_at || s.expires_at - 60 < Date.now() / 1000) {
    try { s = keepSession(await http("POST", `${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, { body: { refresh_token: s.refresh_token } })); }
    catch (e) { throw new Error("Your sign-in expired or was revoked. Sign in again: jkb login"); }
  }
  return s;
}

async function logout() {
  const s = readSession();
  if (s && s.access_token) { try { await http("POST", `${SUPABASE_URL}/auth/v1/logout`, { token: s.access_token }); } catch (e) { /* already invalid */ } }
  try { fs.unlinkSync(SESSION_FILE); } catch (e) { /* not signed in */ }
}

function whoami() {
  if (LOCAL_FILE) return { mode: "local file", file: LOCAL_FILE };
  const s = readSession();
  return { mode: "live", project: SUPABASE_URL, signed_in_as: s ? s.email : null };
}

// ---- data

async function readRow() {
  if (LOCAL_FILE) {
    const state = tasks.validate(JSON.parse(fs.readFileSync(LOCAL_FILE, "utf8")));
    return { state, savedAt: state.savedAt || 0 };
  }
  const s = await session();
  const rows = await http("GET", `${SUPABASE_URL}/rest/v1/app_state?select=state,state_saved_at&user_id=eq.${s.user_id}`, { token: s.access_token });
  if (!Array.isArray(rows) || !rows.length || !rows[0].state) throw new Error("No checklist on this account yet. Sign in to the app once first.");
  return { state: tasks.validate(rows[0].state), savedAt: Number(rows[0].state_saved_at) || 0 };
}

// Saves only if nothing was saved since savedAt. Returns false on a conflict.
async function writeRow(state, savedAt) {
  if (LOCAL_FILE) {
    const current = JSON.parse(fs.readFileSync(LOCAL_FILE, "utf8"));
    if ((current.savedAt || 0) !== savedAt) return false;
    const tmp = LOCAL_FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(state));
    fs.renameSync(tmp, LOCAL_FILE);
    return true;
  }
  const s = await session();
  const rows = await http("PATCH", `${SUPABASE_URL}/rest/v1/app_state?user_id=eq.${s.user_id}&state_saved_at=eq.${savedAt}`, {
    token: s.access_token,
    body: { state, state_saved_at: state.savedAt },
    headers: { Prefer: "return=representation" },
  });
  return Array.isArray(rows) && rows.length === 1;
}

async function load() { return (await readRow()).state; }

// Reads the latest data, applies one change and saves it only if nothing was saved in between. On a
// conflict it re-reads and applies the same change to the fresh copy (up to 3 tries), so fn must depend
// only on the state it is given.
async function apply(label, fn) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { state, savedAt } = await readRow();
    const result = fn(state);
    state.savedAt = Math.max(Date.now(), savedAt + 1, state.savedAt || 0);
    if (await writeRow(state, savedAt)) return result;
  }
  throw new Error(`Couldn't save ${label}: the checklist kept changing (the app is busy syncing). Try again in a moment.`);
}

module.exports = { SUPABASE_URL, SESSION_FILE, login, sendLink, loginWithLink, logout, whoami, load, apply };
