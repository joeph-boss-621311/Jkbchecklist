#!/usr/bin/env node
// MCP connector: gives Claude Code (or Claude Desktop) tools for the live JKB Ops checklist.
// Tools edit the synced copy in .jkb/; Claude moves it to and from the app's cloud save with
// its built-in ArtifactData tool (see get_sync_info and CLAUDE.md).
const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { z } = require("zod");
const store = require("./lib/store");
const T = require("./lib/tasks");

const server = new McpServer({ name: "jkb-checklist", version: "2.0.0" });

function out(value) {
  return { content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] };
}
// reads get a staleness warning; writes get the push reminder
function tool(name, description, inputSchema, handler, { writes = false } = {}) {
  server.registerTool(name, { description, inputSchema }, async args => {
    try {
      const result = await handler(args || {});
      const sync = store.sync();
      const note = writes
        ? { next_step: `Saved to the synced copy only. Push it so the app sees it: ${sync.push}`, unpushed_changes: sync.unpushed_changes }
        : sync.stale ? { warning: `Synced copy is ${sync.pulled_minutes_ago === null ? "of unknown age" : sync.pulled_minutes_ago + " min old"}. Pull again before relying on it: ${sync.pull}` } : {};
      return out({ ...result, ...note });
    } catch (e) {
      return { ...out("Error: " + e.message), isError: true };
    }
  });
}

const due = z.string().optional().describe('YYYY-MM-DD, "today", "tomorrow" or "none"');
const time = z.string().optional().describe('HH:MM in 24-hour form, or "none" — fires a push notification at that time');
const repeat = z.enum(["daily", "weekdays", "weekly", "monthly", "none"]).optional();
const priority = z.enum(["high", "normal", "low"]).optional();

tool("get_sync_info", "Where the synced copy of the app's data lives, how old it is, unpushed changes, and the exact ArtifactData calls to pull and push. Call this first in a session.", {},
  () => ({ ...store.sync(), pushed_hint: "After a successful push, call mark_pushed." }));

tool("mark_pushed", "Clear the unpushed-changes list after you pushed the synced copy with ArtifactData.", {},
  () => { store.markPushed(); return { ok: true }; });

tool("get_status", "Today's focus, overdue and due-soon tasks, streak, check-ins and progress per project.", {},
  () => T.status(store.load()));

tool("list_tasks", "List tasks with their ids. Filter by project and/or section (id, name or prefix).", {
  project: z.string().optional().describe("Project id, name or prefix, e.g. 'SafeGate' or 'safe'"),
  section: z.string().optional().describe("Section name or prefix within the project"),
  open_only: z.boolean().optional().describe("Only tasks that are not done"),
}, ({ project, section, open_only }) => ({ projects: T.list(store.load(), { project, section, openOnly: !!open_only }) }));

tool("search_tasks", "Find tasks whose text, steps or tags contain the query.", {
  query: z.string().describe("Text to search for"),
}, ({ query }) => ({ tasks: T.search(store.load(), query) }));

const tags = z.array(z.string()).optional().describe("Freeform labels, e.g. ['client','safegate']. Lowercased, deduped, max 8.");

tool("add_task", "Add a task. An unknown or missing section puts it in the project's Inbox, like the app does.", {
  project: z.string().describe("Project id, name or prefix"),
  section: z.string().optional().describe("Section name or prefix"),
  text: z.string().describe("The task, short and verb-first"),
  priority, due, time, repeat, tags,
  steps: z.array(z.string()).optional().describe("Optional sub-steps"),
  focus: z.boolean().optional().describe("Also add it to today's focus"),
}, a => store.apply(`add "${a.text}"`, s => T.addTask(s, a)), { writes: true });

tool("set_task_done", "Mark a task done or not done. Completing a recurring task creates its next occurrence.", {
  task_id: z.string(),
  done: z.boolean().optional().describe("Default true"),
}, ({ task_id, done }) => store.apply(`${done === false ? "undo" : "done"} ${task_id}`, s => T.setDone(s, task_id, done !== false)), { writes: true });

tool("edit_task", "Change a task: text, priority, due date, time, repeat, tags, today's focus, extra steps, or move it to another project/section.", {
  task_id: z.string(),
  text: z.string().optional(),
  priority, due, time, repeat,
  tags: z.array(z.string()).optional().describe("Replaces the task's tags entirely — pass the full set you want it to have, not just new ones."),
  focus: z.boolean().optional().describe("true adds to today's focus, false removes"),
  add_steps: z.array(z.string()).optional(),
  project: z.string().optional().describe("Move to this project"),
  section: z.string().optional().describe("Move to this section"),
}, ({ task_id, add_steps, ...rest }) => store.apply(`edit ${task_id}`, s => T.editTask(s, task_id, { ...rest, steps: add_steps })), { writes: true });

tool("delete_task", "Delete a task permanently. Confirm with the user first.", {
  task_id: z.string(),
}, ({ task_id }) => store.apply(`delete ${task_id}`, s => T.deleteTask(s, task_id)), { writes: true });

tool("add_project", "Create a new project (it starts with a 'General' section).", {
  title: z.string(),
  emoji: z.string().optional(),
}, a => store.apply(`project "${a.title}"`, s => T.addProject(s, a)), { writes: true });

tool("add_section", "Add a section to a project.", {
  project: z.string(),
  name: z.string(),
}, a => store.apply(`section "${a.name}"`, s => T.addSection(s, a)), { writes: true });

server.connect(new StdioServerTransport());
