// lib/store.js against a small fake Supabase (auth + the app_state row), including the case the store
// exists for: the app saving between our read and our write must not be overwritten.
const test = require("node:test");
const assert = require("node:assert");
const http = require("node:http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const fixture = require("./fixture");

const UID = "11111111-2222-3333-4444-555555555555";
const EMAIL = "boss@example.com";

function fakeSupabase() {
  const db = { state: fixture(), saved_at: 1000, patches: 0, beforePatch: null, refreshes: 0 };
  const session = n => ({ access_token: "access-" + n, refresh_token: "refresh-" + n, expires_in: 3600, user: { id: UID, email: EMAIL } });
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", c => (body += c));
    req.on("end", () => {
      const url = new URL(req.url, "http://x");
      const send = (code, data) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(data)); };
      const json = body ? JSON.parse(body) : {};
      const authed = /^Bearer access-/.test(req.headers.authorization || "");
      if (url.pathname === "/auth/v1/token" && url.searchParams.get("grant_type") === "password")
        return json.password === "right" ? send(200, session(1)) : send(400, { error_description: "Invalid login credentials" });
      if (url.pathname === "/auth/v1/token" && url.searchParams.get("grant_type") === "refresh_token") { db.refreshes++; return send(200, session(2)); }
      if (url.pathname === "/auth/v1/otp") return send(200, {});
      if (url.pathname === "/auth/v1/verify") return json.token_hash === "good-token" ? send(200, session(3)) : send(403, { msg: "Token has expired or is invalid" });
      if (url.pathname === "/rest/v1/app_state" && req.method === "GET") {
        if (!authed) return send(401, { message: "JWT required" });
        return send(200, [{ state: db.state, state_saved_at: db.saved_at }]);
      }
      if (url.pathname === "/rest/v1/app_state" && req.method === "PATCH") {
        if (!authed) return send(401, { message: "JWT required" });
        db.patches++;
        if (db.beforePatch) { db.beforePatch(db); db.beforePatch = null; }   // e.g. the phone saves first
        if (String(db.saved_at) !== url.searchParams.get("state_saved_at").replace("eq.", "")) return send(200, []);
        db.state = json.state; db.saved_at = json.state_saved_at;
        return send(200, [{ user_id: UID }]);
      }
      send(404, { message: "not mocked" });
    });
  });
  return new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve({ server, db, url: `http://127.0.0.1:${server.address().port}` })));
}

// a fresh copy of lib/store.js pointed at the fake server and a temp session folder
function freshStore(url, dir) {
  process.env.JKB_SUPABASE_URL = url;
  process.env.JKB_DIR = dir;
  delete process.env.JKB_STATE_FILE;
  delete require.cache[require.resolve("../lib/store")];
  return require("../lib/store");
}

test("store: sign-in, live reads and safe writes", async t => {
  const fake = await fakeSupabase();
  t.after(() => fake.server.close());
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jkb-store-"));
  const store = freshStore(fake.url, dir);
  const T = require("../lib/tasks");

  await assert.rejects(store.load(), /Not signed in/);
  await assert.rejects(store.login(EMAIL, "wrong"), /Invalid login credentials/);

  const s = await store.login(EMAIL, "right");
  assert.strictEqual(s.email, EMAIL);
  assert.strictEqual(fs.statSync(store.SESSION_FILE).mode & 0o777, 0o600);
  assert.deepStrictEqual(store.whoami(), { mode: "live", project: fake.url, signed_in_as: EMAIL });

  // read
  assert.strictEqual(T.search(await store.load(), "login")[0].id, "t7");

  // write: lands, and moves state_saved_at forward so open apps reload
  await store.apply("add", st => T.addTask(st, { project: "jkb", section: "seo", text: "Submit sitemap" }));
  assert.ok(fake.db.state.projects[0].sections[1].tasks.some(x => x.text === "Submit sitemap"));
  assert.ok(fake.db.saved_at > 1000);

  // conflict: the phone saves between our read and our write -> we re-read and apply on top of it
  fake.db.beforePatch = db => {
    db.state = JSON.parse(JSON.stringify(db.state));
    db.state.projects[1].sections[0].tasks.push({ id: "tphone", text: "Added on the phone", done: false, doneAt: null, priority: "normal", due: null, createdAt: 2 });
    db.saved_at += 5;
  };
  const before = fake.db.patches;
  await store.apply("done t7", st => T.setDone(st, "t7", true));
  assert.strictEqual(fake.db.patches - before, 2, "first write refused, second one lands");
  const tasksNow = fake.db.state.projects[1].sections[0].tasks;
  assert.ok(tasksNow.some(x => x.id === "tphone"), "the phone's change survived");
  assert.ok(tasksNow.find(x => x.id === "t7").done, "and ours is on top of it");

  // an expired session is refreshed automatically
  const saved = JSON.parse(fs.readFileSync(store.SESSION_FILE, "utf8"));
  fs.writeFileSync(store.SESSION_FILE, JSON.stringify({ ...saved, expires_at: 1 }));
  await store.load();
  assert.strictEqual(fake.db.refreshes, 1);

  // phone-friendly sign-in with the emailed link pasted back
  await store.logout();
  await assert.rejects(store.load(), /Not signed in/);
  await store.sendLink(EMAIL);
  await assert.rejects(store.loginWithLink("https://x.supabase.co/auth/v1/verify?token=stale&type=magiclink"), /expired or is invalid/);
  const viaLink = await store.loginWithLink("https://x.supabase.co/auth/v1/verify?token=good-token&type=magiclink&redirect_to=https://checklist.jkbglobal.site");
  assert.strictEqual(viaLink.email, EMAIL);
});
