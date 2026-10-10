// Starts the real MCP server over stdio and drives it like Claude Code would.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { StdioClientTransport } = require("@modelcontextprotocol/sdk/client/stdio.js");
const fixture = require("./fixture");

test("MCP tools read and write the checklist (local-file mode)", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jkb-"));
  const file = path.join(dir, "app", "state.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(fixture()));

  const client = new Client({ name: "test", version: "1" });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(__dirname, "..", "mcp.js")], env: { ...process.env, JKB_STATE_FILE: file } }));
  const call = async (name, args = {}) => { const r = await client.callTool({ name, arguments: args }); return { err: r.isError, body: r.content[0].text }; };

  const names = (await client.listTools()).tools.map(t => t.name).sort();
  assert.deepStrictEqual(names, ["add_project", "add_section", "add_task", "delete_task", "edit_task", "get_login_info", "get_status", "list_tasks", "search_tasks", "set_task_done"]);

  const found = JSON.parse((await call("search_tasks", { query: "login" })).body);
  assert.strictEqual(found.tasks[0].id, "t7");

  const added = await call("add_task", { project: "jkb", section: "seo", text: "Submit sitemap", priority: "high" });
  assert.ok(!added.err);
  assert.match(added.body, /Saved to Joseph's live checklist/);
  const onDisk = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.ok(onDisk.projects[0].sections[1].tasks.some(t => t.text === "Submit sitemap" && t.priority === "high"));

  const who = JSON.parse((await call("get_login_info")).body);
  assert.strictEqual(who.mode, "local file");

  const bad = await call("set_task_done", { task_id: "nope" });
  assert.ok(bad.err); assert.match(bad.body, /No task with id/);

  await client.close();
});
