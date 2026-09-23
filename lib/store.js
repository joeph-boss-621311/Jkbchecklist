// Reads and writes the checklist file on disk. Shared by server, CLI and MCP connector.
const fs = require("fs");
const path = require("path");
const JKB = require("../shared.js");

const DATA_FILE = process.env.JKB_DATA_FILE || path.join(__dirname, "..", "data", "state.json");

function write(state) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  const tmp = DATA_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, DATA_FILE);
}

function load() {
  try {
    return JKB.normalize(JSON.parse(fs.readFileSync(DATA_FILE, "utf8")));
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
    const state = JKB.defaultState();
    write(state);
    return state;
  }
}

// Loads, applies one operation, bumps the revision and saves.
function apply(op) {
  const state = load();
  const result = JKB.applyOp(state, op);
  state.rev = (state.rev || 0) + 1;
  state.updatedAt = new Date().toISOString();
  write(state);
  return { state, result };
}

module.exports = { DATA_FILE, load, apply };
