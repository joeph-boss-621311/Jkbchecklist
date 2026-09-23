#!/usr/bin/env node
// MCP connector: lets Claude Code, Claude Desktop or Atlas manage the checklist as tools.
const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { z } = require("zod");
const store = require("./lib/store");
const JKB = require("./shared.js");

const server = new McpServer({ name: "jkb-checklist", version: "1.0.0" });

function text(value) {
  return { content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] };
}

// Wraps a handler so errors come back to Claude as readable tool errors.
function tool(name, description, inputSchema, handler) {
  server.registerTool(name, { description, inputSchema }, async args => {
    try { return text(await handler(args || {})); }
    catch (e) { return { ...text("Error: " + e.message), isError: true }; }
  });
}

function summary(state) {
  const all = JKB.stats(state);
  return {
    done: all.done,
    total: all.total,
    projects: state.projects.map(p => ({ id: p.id, emoji: p.emoji, title: p.title, ...JKB.projectStats(p),
      sections: p.sections.map(s => ({ name: s.name, ...JKB.sectionStats(s) })) })),
  };
}

tool("get_status", "Progress summary for every project and section in the JKB Ops checklist.", {},
  () => summary(store.load()));

tool("list_tasks", "List tasks with their ids. Filter by project and/or section (name, prefix or id).", {
  project: z.string().optional().describe("Project name, prefix or id, e.g. 'SafeGate' or 'safe'"),
  section: z.string().optional().describe("Section name or prefix within the project"),
  open_only: z.boolean().optional().describe("Only return tasks that are not done"),
}, ({ project, section, open_only }) => {
  const state = store.load();
  const projects = project ? [JKB.findProject(state, project)] : state.projects;
  return projects.map(p => ({
    project: p.title, project_id: p.id,
    sections: (section ? [JKB.findSection(p, section)] : p.sections).map(s => ({
      section: s.name,
      tasks: s.tasks.filter(t => !open_only || !t.done).map(t => ({ id: t.id, text: t.text, done: t.done })),
    })),
  }));
});

tool("search_tasks", "Find tasks whose text contains the query.", {
  query: z.string().describe("Text to search for"),
}, ({ query }) => {
  const q = query.toLowerCase();
  const state = store.load();
  return state.projects.flatMap(p => p.sections.flatMap(s => s.tasks
    .filter(t => t.text.toLowerCase().includes(q))
    .map(t => ({ id: t.id, text: t.text, done: t.done, project: p.title, section: s.name }))));
});

tool("add_task", "Add a task to a project section.", {
  project: z.string().describe("Project name, prefix or id"),
  section: z.string().describe("Section name or prefix"),
  text: z.string().describe("The task"),
  create_section: z.boolean().optional().describe("Create the section if it does not exist"),
}, ({ project, section, text: taskText, create_section }) =>
  store.apply({ type: "addTask", project, section, text: taskText, createSection: !!create_section }).result);

tool("set_task_done", "Mark a task done or not done.", {
  task_id: z.string(),
  done: z.boolean().default(true),
}, ({ task_id, done }) => store.apply({ type: "setDone", taskId: task_id, done: done !== false }).result);

tool("edit_task", "Change a task's text.", {
  task_id: z.string(),
  text: z.string(),
}, ({ task_id, text: taskText }) => store.apply({ type: "editTask", taskId: task_id, text: taskText }).result);

tool("delete_task", "Delete a task permanently.", {
  task_id: z.string(),
}, ({ task_id }) => store.apply({ type: "deleteTask", taskId: task_id }).result);

tool("add_project", "Create a new project (it starts with a 'General' section).", {
  title: z.string(),
  emoji: z.string().optional(),
}, ({ title, emoji }) => store.apply({ type: "addProject", title, emoji }).result);

tool("add_section", "Add a section to a project.", {
  project: z.string(),
  name: z.string(),
}, ({ project, name }) => store.apply({ type: "addSection", project, name }).result);

server.connect(new StdioServerTransport());
