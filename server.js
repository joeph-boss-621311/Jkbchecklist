// JKB checklist server: serves index.html and lets the page ask Claude (via the `claude` CLI)
// to turn a voice transcript into tasks. Zero dependencies — run with `node server.js`.
const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const PORT = parseInt(process.env.PORT || "3000", 10);
const HOST = process.env.HOST || "127.0.0.1";
const CLAUDE_BIN = process.env.CLAUDE_BIN || "claude";
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || "haiku"; // fast + light on usage; set to "sonnet" for smarter sorting
const TIMEOUT_MS = 90_000;

const TASK_SCHEMA = {
  type: "object",
  properties: {
    tasks: {
      type: "array",
      items: {
        type: "object",
        properties: {
          text: { type: "string" },
          project: { type: "string" },
          section: { type: "string" },
        },
        required: ["text", "project", "section"],
      },
    },
  },
  required: ["tasks"],
};

function buildPrompt({ transcript, projects, currentProject }) {
  return `You turn a messy voice transcript into a clean to-do list.

Rules:
- Pull out only real, actionable tasks. Ignore filler, small talk, thinking out loud, and things already done.
- Write each task as a short imperative starting with a verb ("Fix login bug", "Call Tunde about invoice"). Max ~10 words.
- Keep useful specifics (names, dates, numbers, deadlines). Drop the project name from the text if it's only there to say where the task goes.
- Split compound sentences into separate tasks. Merge duplicates.
- Never drop a real task just because it doesn't fit a project (errands, personal stuff) — send it to the default project's "Inbox".
- Assign each task to the best matching project id and section name from the list below.
  If no section fits, use section "Inbox". The default project is "${currentProject || projects[0]?.id || ""}"; use it when no project clearly fits.

Projects (id — title — sections):
${projects.map(p => `- ${p.id} — ${p.title} — ${p.sections.join(" | ")}`).join("\n")}

Transcript:
"""
${transcript}
"""

Reply with JSON only: {"tasks":[{"text":"...","project":"<id>","section":"<section name>"}]}`;
}

function runClaude(prompt) {
  return new Promise((resolve, reject) => {
    const args = [
      "-p",
      "--output-format", "json",
      "--model", CLAUDE_MODEL,
      "--tools", "",                 // pure text job — no file or shell access
      "--no-session-persistence",
      "--json-schema", JSON.stringify(TASK_SCHEMA),
    ];
    const child = spawn(CLAUDE_BIN, args, { stdio: ["pipe", "pipe", "pipe"] });
    let out = "", err = "";
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("Claude timed out")); }, TIMEOUT_MS);
    child.stdout.on("data", d => (out += d));
    child.stderr.on("data", d => (err += d));
    child.on("error", e => { clearTimeout(timer); reject(e); });
    child.on("close", code => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(err.trim() || out.trim() || `claude exited ${code}`));
      try {
        const envelope = JSON.parse(out);
        if (envelope.is_error) return reject(new Error(envelope.result || "Claude returned an error"));
        // --json-schema puts the parsed object in structured_output; fall back to digging JSON out of the text
        if (envelope.structured_output && Array.isArray(envelope.structured_output.tasks)) {
          return resolve(envelope.structured_output.tasks);
        }
        const text = String(envelope.result || "");
        const match = text.match(/\{[\s\S]*\}/);
        const parsed = JSON.parse(match ? match[0] : text);
        resolve(Array.isArray(parsed.tasks) ? parsed.tasks : []);
      } catch (e) {
        reject(new Error("Couldn't read Claude's reply"));
      }
    });
    child.stdin.end(prompt);
  });
}

let healthCache = null;
function claudeInstalled() {
  if (healthCache !== null) return Promise.resolve(healthCache);
  return new Promise(resolve => {
    const child = spawn(CLAUDE_BIN, ["--version"], { stdio: "ignore" });
    child.on("error", () => resolve((healthCache = false)));
    child.on("close", code => resolve((healthCache = code === 0)));
  });
}

function sendJson(res, status, obj) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(obj));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");

  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return fs.createReadStream(path.join(__dirname, "index.html")).pipe(res);
  }

  if (req.method === "GET" && url.pathname === "/api/health") {
    return sendJson(res, 200, { claude: await claudeInstalled(), model: CLAUDE_MODEL });
  }

  if (req.method === "POST" && url.pathname === "/api/extract") {
    let body = "";
    req.on("data", c => { body += c; if (body.length > 200_000) req.destroy(); });
    req.on("end", async () => {
      try {
        const input = JSON.parse(body || "{}");
        if (!input.transcript || !Array.isArray(input.projects)) return sendJson(res, 400, { error: "Missing transcript" });
        const tasks = await runClaude(buildPrompt(input));
        sendJson(res, 200, { tasks });
      } catch (e) {
        console.error("[extract]", e.message);
        sendJson(res, 502, { error: e.message });
      }
    });
    return;
  }

  res.writeHead(404); res.end("Not found");
});

server.listen(PORT, HOST, () => {
  console.log(`JKB checklist running → http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}`);
  console.log(`Using: ${CLAUDE_BIN} --model ${CLAUDE_MODEL}`);
});
