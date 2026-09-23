// The local synced copy of the live app's data.
//
// The app saves to the claude.ai cloud save of the JKB Ops artifact (collection "app",
// document "state"). Only Claude Code's built-in ArtifactData tool can read and write it,
// signed in as you — so Claude pulls it to .jkb/app/state.json, the jkb CLI / MCP
// connector edit that file, and Claude pushes it back pinned to the version it pulled.
const fs = require("fs");
const path = require("path");
const tasks = require("./tasks");

const ARTIFACT_URL = "https://claude.ai/artifact/1puenyhWtJ8GhNQZvAcqm8";
const ROOT = process.env.JKB_DIR || path.join(__dirname, "..", ".jkb");
const STATE_FILE = process.env.JKB_STATE_FILE || path.join(ROOT, "app", "state.json");
const META_FILE = path.join(path.dirname(path.dirname(STATE_FILE)), "meta.json");
const STALE_MS = 15 * 60000;

const PULL = `ArtifactData action "get", url "${ARTIFACT_URL}", collection "app", doc_id "state", out_dir "${path.dirname(path.dirname(STATE_FILE))}" — and remember the version it reports`;
const PUSH = `ArtifactData action "set", url "${ARTIFACT_URL}", collection "app", doc_id "state", file_path "${STATE_FILE}", if_version <the version from your last pull>`;

function readMeta() { try { return JSON.parse(fs.readFileSync(META_FILE, "utf8")); } catch (e) { return {}; } }
function writeMeta(m) { fs.mkdirSync(path.dirname(META_FILE), { recursive: true }); fs.writeFileSync(META_FILE, JSON.stringify(m, null, 2)); }

function load() {
  let raw;
  try { raw = fs.readFileSync(STATE_FILE, "utf8"); }
  catch (e) {
    if (e.code === "ENOENT") throw new Error(`No synced copy yet. Pull it first with: ${PULL}`);
    throw e;
  }
  const state = tasks.validate(JSON.parse(raw));
  // a savedAt we didn't write means ArtifactData just pulled a fresh copy
  const meta = readMeta();
  if (meta.lastWrittenSavedAt !== state.savedAt) writeMeta({ pulledAt: Date.now(), pulledSavedAt: state.savedAt, dirty: false, changes: [] });
  return state;
}

function sync() {
  const meta = readMeta();
  const age = meta.pulledAt ? Date.now() - meta.pulledAt : null;
  return {
    file: STATE_FILE,
    pulled_minutes_ago: age === null ? null : Math.round(age / 60000),
    stale: age === null || age > STALE_MS,
    unpushed_changes: meta.dirty ? meta.changes || [] : [],
    pull: PULL,
    push: PUSH,
  };
}

function save(state, change) {
  const meta = readMeta();
  const tmp = STATE_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(state));
  fs.renameSync(tmp, STATE_FILE);
  writeMeta({ ...meta, lastWrittenSavedAt: state.savedAt, dirty: true, changes: [...(meta.changes || []), change].slice(-50) });
}

// Loads, applies one change, saves locally. The caller still has to push.
function apply(label, fn) {
  const state = load();
  const result = fn(state);
  save(state, label);
  return result;
}

// Call after a successful push so status stops reporting unpushed changes.
function markPushed() { const meta = readMeta(); writeMeta({ ...meta, dirty: false, changes: [] }); }

module.exports = { ARTIFACT_URL, STATE_FILE, PULL, PUSH, load, apply, sync, markPushed };
