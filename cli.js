#!/usr/bin/env node
// jkb — command-line access to the live JKB Ops checklist (via its synced copy in .jkb/).
const store = require("./lib/store");
const T = require("./lib/tasks");

const HELP = `jkb — JKB Ops checklist (edits the synced copy of the live app's data)

  jkb status                                  Focus, overdue, due soon and progress per project
  jkb list [project] [section] [--open]       Tasks with their ids (--open hides done ones)
  jkb find <text>                             Search tasks
  jkb add <project> <section> <task...> [--priority high|normal|low] [--due YYYY-MM-DD|today|tomorrow]
          [--repeat daily|weekdays|weekly|monthly] [--tags a,b,c] [--focus]
                                              Add a task (unknown section → Inbox)
  jkb done <id...>                            Mark tasks done (recurring ones get their next occurrence)
  jkb undo <id...>                            Mark tasks not done
  jkb edit <id> [text...] [--priority p] [--due d|none] [--repeat r|none] [--tags a,b,c|none] [--focus|--unfocus]
          [--project p] [--section s]
  jkb rm <id...>                              Delete tasks
  jkb project <title> [emoji]                 Add a project
  jkb section <project> <name...>             Add a section
  jkb sync                                    Where the synced copy is, how old it is, what's unpushed
  jkb pushed                                  Clear the unpushed list after pushing
  jkb json                                    Print the synced data as JSON

Projects and sections can be given by id, name or prefix ("safe" = SafeGate, "seo" = SEO).
Changes only reach the app after Claude pushes them — see: jkb sync`;

// --flag value / --flag parsing that keeps free text intact
function parse(argv) {
  const opts = {}, args = [];
  const valued = new Set(["priority", "due", "repeat", "project", "section", "tags"]);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      if (valued.has(k)) { if (argv[i + 1] === undefined) throw new Error(`--${k} needs a value`); opts[k] = argv[++i]; }
      else opts[k] = true;
    } else args.push(a);
  }
  return { opts, args };
}

function line(t) {
  const bits = [t.priority === "high" ? "high" : "", t.due ? "due " + t.due : "", t.repeat ? "↻ " + t.repeat : "", t.steps ? "steps " + t.steps : "",
    t.tags && t.tags.length ? t.tags.map(x => "#" + x).join(" ") : ""].filter(Boolean);
  return `[${t.done ? "x" : " "}] ${t.id}  ${t.text}${bits.length ? "  (" + bits.join(", ") + ")" : ""}`;
}

function printStatus(s) {
  console.log(`${s.today} · ${s.done}/${s.total} done · ${s.done_today} today · streak ${s.streak_days}d`);
  console.log(`\nToday's focus${s.focus.planned ? "" : " (not planned yet)"}${s.focus.note ? " — " + s.focus.note : ""}`);
  s.focus.tasks.forEach(t => console.log("  " + line(t) + "   — " + t.project));
  if (s.overdue.length) { console.log("\nOverdue"); s.overdue.forEach(t => console.log("  " + line(t) + "   — " + t.project)); }
  if (s.due_soon.length) { console.log("\nDue in the next 3 days"); s.due_soon.forEach(t => console.log("  " + line(t) + "   — " + t.project)); }
  if (s.checkins.length) { console.log("\nCheck-ins"); s.checkins.forEach(c => console.log(`  ${new Date(c.at).toLocaleString()} — ${c.about}`)); }
  console.log("\nProjects");
  s.projects.forEach(p => console.log(`  ${p.emoji} ${p.title} [${p.id}]: ${p.done}/${p.total}${p.high_priority_open ? ` · ${p.high_priority_open} high open` : ""}`));
}

function printSync() {
  const s = store.sync();
  console.log(`Synced copy: ${s.file}`);
  console.log(s.pulled_minutes_ago === null ? "Never pulled." : `Pulled ${s.pulled_minutes_ago} min ago${s.stale ? " — stale, pull again before changing things" : ""}.`);
  console.log(s.unpushed_changes.length ? `Unpushed changes:\n  - ${s.unpushed_changes.join("\n  - ")}` : "No unpushed changes.");
  console.log(`\nPull: ${s.pull}\nPush: ${s.push}`);
}

// After every change, remind whoever is driving that the app hasn't seen it yet.
function changed(msg) {
  if (msg) console.log(msg);
  console.log("→ Not in the app yet. Push with ArtifactData (see: jkb sync).");
}

function main(argv) {
  const { opts, args } = parse(argv);
  const cmd = args.shift();
  switch (cmd) {
    case undefined: case "help": case "-h": case "--help":
      return console.log(HELP);
    case "status":
      return printStatus(T.status(store.load()));
    case "list": case "ls": {
      const out = T.list(store.load(), { project: args[0], section: args[1], openOnly: !!opts.open });
      out.forEach(p => {
        console.log(`\n${p.emoji} ${p.project} [${p.project_id}]`);
        p.sections.forEach(s => { console.log(`  ## ${s.section}`); s.tasks.forEach(t => console.log("    " + line(t))); });
      });
      return;
    }
    case "find": {
      const hits = T.search(store.load(), args.join(" "));
      if (!hits.length) return console.log("No matches.");
      return hits.forEach(t => console.log(line(t) + `   — ${t.project} › ${t.section}`));
    }
    case "json":
      return console.log(JSON.stringify(store.load(), null, 2));
    case "sync":
      return printSync();
    case "pushed":
      store.markPushed();
      return console.log("Marked as pushed.");
    case "add": {
      const [project, section, ...rest] = args;
      if (!project || !section || !rest.length) throw new Error("Usage: jkb add <project> <section> <task...>");
      const r = store.apply(`add "${rest.join(" ")}"`, s => T.addTask(s, { project, section, text: rest.join(" "), priority: opts.priority, due: opts.due, repeat: opts.repeat, tags: opts.tags, focus: !!opts.focus }));
      return changed(`Added ${r.added.id}: ${r.added.text}  → ${r.added.project} › ${r.added.section}`);
    }
    case "done": case "undo": {
      if (!args.length) throw new Error(`Usage: jkb ${cmd} <id...>`);
      args.forEach(id => {
        const r = store.apply(`${cmd} ${id}`, s => T.setDone(s, id, cmd === "done"));
        console.log(`${cmd === "done" ? "✔" : "○"} ${r.task.id}  ${r.task.text}${r.next_occurrence ? `  (next: ${r.next_occurrence.id}, due ${r.next_occurrence.due})` : ""}`);
      });
      return changed("");
    }
    case "edit": {
      const [id, ...rest] = args;
      if (!id) throw new Error("Usage: jkb edit <id> [text...] [--priority p] [--due d] [--repeat r] [--tags a,b|none] [--focus|--unfocus] [--project p] [--section s]");
      const changes = {};
      if (rest.length) changes.text = rest.join(" ");
      ["priority", "due", "repeat", "project", "section"].forEach(k => { if (opts[k] !== undefined) changes[k] = opts[k]; });
      if (opts.tags !== undefined) changes.tags = opts.tags === "none" ? [] : opts.tags;
      if (opts.focus) changes.focus = true;
      if (opts.unfocus) changes.focus = false;
      if (!Object.keys(changes).length) throw new Error("Nothing to change. Give new text or a --flag.");
      const r = store.apply(`edit ${id}`, s => T.editTask(s, id, changes));
      return changed(r.changed.length ? `Updated ${r.task.id} (${r.changed.join(", ")}): ${r.task.text}` : "Nothing changed.");
    }
    case "rm": {
      if (!args.length) throw new Error("Usage: jkb rm <id...>");
      args.forEach(id => { const r = store.apply(`delete ${id}`, s => T.deleteTask(s, id)); console.log(`Deleted ${r.deleted.id}: ${r.deleted.text}`); });
      return changed("");
    }
    case "project": {
      const [title, emoji] = args;
      const r = store.apply(`project "${title}"`, s => T.addProject(s, { title, emoji }));
      return changed(`Added project ${r.added_project.emoji} ${r.added_project.title} [${r.added_project.id}]`);
    }
    case "section": {
      const [project, ...rest] = args;
      const r = store.apply(`section "${rest.join(" ")}"`, s => T.addSection(s, { project, name: rest.join(" ") }));
      return changed(`Added section ${r.added_section.name} to ${r.added_section.project}`);
    }
    default:
      throw new Error(`Unknown command "${cmd}". Run: jkb help`);
  }
}

try { main(process.argv.slice(2)); }
catch (e) { console.error("Error: " + e.message); process.exit(1); }
