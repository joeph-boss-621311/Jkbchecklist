#!/usr/bin/env node
// Command-line access to the checklist. Built for Claude Code / Atlas and for humans.
const store = require("./lib/store");
const JKB = require("./shared.js");

const HELP = `jkb — JKB Ops checklist

  jkb status                              Progress per project
  jkb list [project] [section] [--open]   Show tasks with their ids (--open hides done ones)
  jkb find <text>                         Search tasks
  jkb add <project> <section> <task> [--create]
                                          Add a task (--create makes the section if missing)
  jkb done <id...>                        Mark tasks done
  jkb undo <id...>                        Mark tasks not done
  jkb edit <id> <new text>                Rename a task
  jkb rm <id...>                          Delete tasks
  jkb project <title> [emoji]             Add a project
  jkb section <project> <name>            Add a section
  jkb json                                Print the full checklist as JSON

Projects and sections can be given by name, name prefix or id (e.g. "safe" for SafeGate).`;

function pct(s) { return s.total ? Math.round((s.done / s.total) * 100) : 0; }

function printStatus(state) {
  const all = JKB.stats(state);
  console.log(`Overall: ${all.done}/${all.total} (${pct(all)}%)`);
  state.projects.forEach(p => {
    const s = JKB.projectStats(p);
    console.log(`  ${p.emoji} ${p.title} [${p.id}]: ${s.done}/${s.total} (${pct(s)}%)`);
  });
}

function printList(state, projectRef, sectionRef, openOnly) {
  const projects = projectRef ? [JKB.findProject(state, projectRef)] : state.projects;
  projects.forEach(p => {
    const sections = sectionRef ? [JKB.findSection(p, sectionRef)] : p.sections;
    console.log(`\n${p.emoji} ${p.title} [${p.id}]`);
    sections.forEach(s => {
      const st = JKB.sectionStats(s);
      const tasks = openOnly ? s.tasks.filter(t => !t.done) : s.tasks;
      if (openOnly && !tasks.length) return;
      console.log(`  ## ${s.name} (${st.done}/${st.total})`);
      tasks.forEach(t => console.log(`    [${t.done ? "x" : " "}] ${t.id}  ${t.text}`));
    });
  });
}

function main(argv) {
  const flags = new Set(argv.filter(a => a.startsWith("--")));
  const args = argv.filter(a => !a.startsWith("--"));
  const cmd = args.shift();

  switch (cmd) {
    case undefined:
    case "help":
    case "-h":
      return console.log(HELP);
    case "status":
      return printStatus(store.load());
    case "list":
    case "ls":
      return printList(store.load(), args[0], args[1], flags.has("--open"));
    case "json":
      return console.log(JSON.stringify(store.load(), null, 2));
    case "find": {
      const q = args.join(" ").toLowerCase();
      if (!q) throw new Error("Usage: jkb find <text>");
      const state = store.load();
      let hits = 0;
      state.projects.forEach(p => p.sections.forEach(s => s.tasks.forEach(t => {
        if (t.text.toLowerCase().includes(q)) {
          hits++;
          console.log(`[${t.done ? "x" : " "}] ${t.id}  ${t.text}   — ${p.title} › ${s.name}`);
        }
      })));
      if (!hits) console.log("No matches.");
      return;
    }
    case "add": {
      const [project, section, ...rest] = args;
      if (!project || !section || !rest.length) throw new Error("Usage: jkb add <project> <section> <task>");
      const { result } = store.apply({ type: "addTask", project, section, text: rest.join(" "), createSection: flags.has("--create") });
      return console.log(`Added ${result.id}: ${result.text}`);
    }
    case "done":
    case "undo": {
      if (!args.length) throw new Error(`Usage: jkb ${cmd} <id...>`);
      args.forEach(taskId => {
        const { result } = store.apply({ type: "setDone", taskId, done: cmd === "done" });
        console.log(`${cmd === "done" ? "✔" : "○"} ${result.id}  ${result.text}`);
      });
      return;
    }
    case "edit": {
      const [taskId, ...rest] = args;
      if (!taskId || !rest.length) throw new Error("Usage: jkb edit <id> <new text>");
      const { result } = store.apply({ type: "editTask", taskId, text: rest.join(" ") });
      return console.log(`Updated ${result.id}: ${result.text}`);
    }
    case "rm": {
      if (!args.length) throw new Error("Usage: jkb rm <id...>");
      args.forEach(taskId => {
        const { result } = store.apply({ type: "deleteTask", taskId });
        console.log(`Deleted ${result.id}: ${result.text}`);
      });
      return;
    }
    case "project": {
      const [title, emoji] = args;
      const { result } = store.apply({ type: "addProject", title, emoji });
      return console.log(`Added project ${result.title} [${result.id}]`);
    }
    case "section": {
      const [project, ...rest] = args;
      const { result } = store.apply({ type: "addSection", project, name: rest.join(" ") });
      return console.log(`Added section ${result.name}`);
    }
    default:
      throw new Error(`Unknown command "${cmd}". Run: jkb help`);
  }
}

try {
  main(process.argv.slice(2));
} catch (e) {
  console.error("Error: " + e.message);
  process.exit(1);
}
