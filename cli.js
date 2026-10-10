#!/usr/bin/env node
// jkb — command-line access to the live JKB Ops checklist (your Supabase data, signed in as you).
const store = require("./lib/store");
const T = require("./lib/tasks");

const HELP = `jkb — JKB Ops checklist (reads and edits your live data, the same as the app)

  jkb login                                   Sign in with your JKB Ops email and password
  jkb login --email <you@example.com>         …or email yourself a one-time sign-in link (phone-friendly):
  jkb login --link '<link from the email>'    paste the link here instead of tapping it
  jkb whoami                                  Who you're signed in as
  jkb logout                                  Sign out on this machine

  jkb status                                  Focus, overdue, due soon and progress per project
  jkb list [project] [section] [--open]       Tasks with their ids (--open hides done ones)
  jkb find <text>                             Search tasks
  jkb add <project> <section> <task...> [--priority high|normal|low] [--due YYYY-MM-DD|today|tomorrow]
          [--time HH:MM] [--repeat daily|weekdays|weekly|monthly] [--tags a,b,c] [--focus]
                                              Add a task (unknown section → Inbox)
  jkb done <id...>                            Mark tasks done (recurring ones get their next occurrence)
  jkb undo <id...>                            Mark tasks not done
  jkb edit <id> [text...] [--priority p] [--due d|none] [--time HH:MM|none] [--repeat r|none] [--tags a,b,c|none] [--focus|--unfocus]
          [--project p] [--section s]
  jkb rm <id...>                              Delete tasks
  jkb project <title> [emoji]                 Add a project
  jkb section <project> <name...>             Add a section
  jkb json                                    Print your checklist data as JSON

Projects and sections can be given by id, name or prefix ("safe" = SafeGate, "seo" = SEO).
Changes save straight to your account; open apps update within seconds. A save never overwrites
something you just changed in the app: it re-reads and applies on top instead.`;

// --flag value / --flag parsing that keeps free text intact
function parse(argv) {
  const opts = {}, args = [];
  const valued = new Set(["priority", "due", "time", "repeat", "project", "section", "tags", "email", "link"]);
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
  const bits = [t.priority === "high" ? "high" : "", t.due ? "due " + t.due : "", t.time ? "at " + t.time : "", t.repeat ? "↻ " + t.repeat : "", t.steps ? "steps " + t.steps : "",
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

// Asks on the terminal; hide=true doesn't echo what's typed (for the password).
function ask(question, hide) {
  return new Promise(resolve => {
    const rl = require("readline").createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hide) rl._writeToOutput = s => { if (s.startsWith(question)) process.stdout.write(question); };
    rl.question(question, answer => { rl.close(); if (hide) process.stdout.write("\n"); resolve(answer.trim()); });
  });
}

async function login(opts) {
  if (opts.link) {
    const s = await store.loginWithLink(opts.link);
    return console.log(`Signed in as ${s.email}.`);
  }
  if (opts.email) {
    await store.sendLink(opts.email);
    return console.log(`Sent a sign-in link to ${opts.email}. Don't tap it: long-press it, copy the link, then run:\n  jkb login --link '<the link>'`);
  }
  if (!process.stdin.isTTY) throw new Error("No terminal to type a password into. Use: jkb login --email you@example.com");
  const email = await ask("Email: ");
  const password = await ask("Password: ", true);
  const s = await store.login(email, password);
  console.log(`Signed in as ${s.email}.`);
}

// Saved straight to the live data; say so.
function changed(msg) {
  if (msg) console.log(msg);
  console.log("→ Saved. Open apps update within seconds.");
}

async function main(argv) {
  const { opts, args } = parse(argv);
  const cmd = args.shift();
  switch (cmd) {
    case undefined: case "help": case "-h": case "--help":
      return console.log(HELP);
    case "login":
      return login(opts);
    case "logout":
      await store.logout();
      return console.log("Signed out on this machine.");
    case "whoami": {
      const w = store.whoami();
      return console.log(w.mode === "local file" ? `Using the local file ${w.file}` : w.signed_in_as ? `Signed in as ${w.signed_in_as} (${w.project})` : "Not signed in. Run: jkb login");
    }
    case "status":
      return printStatus(T.status(await store.load()));
    case "list": case "ls": {
      const out = T.list(await store.load(), { project: args[0], section: args[1], openOnly: !!opts.open });
      out.forEach(p => {
        console.log(`\n${p.emoji} ${p.project} [${p.project_id}]`);
        p.sections.forEach(s => { console.log(`  ## ${s.section}`); s.tasks.forEach(t => console.log("    " + line(t))); });
      });
      return;
    }
    case "find": {
      const hits = T.search(await store.load(), args.join(" "));
      if (!hits.length) return console.log("No matches.");
      return hits.forEach(t => console.log(line(t) + `   — ${t.project} › ${t.section}`));
    }
    case "json":
      return console.log(JSON.stringify(await store.load(), null, 2));
    case "add": {
      const [project, section, ...rest] = args;
      if (!project || !section || !rest.length) throw new Error("Usage: jkb add <project> <section> <task...>");
      const r = await store.apply(`add "${rest.join(" ")}"`, s => T.addTask(s, { project, section, text: rest.join(" "), priority: opts.priority, due: opts.due, time: opts.time, repeat: opts.repeat, tags: opts.tags, focus: !!opts.focus }));
      return changed(`Added ${r.added.id}: ${r.added.text}  → ${r.added.project} › ${r.added.section}`);
    }
    case "done": case "undo": {
      if (!args.length) throw new Error(`Usage: jkb ${cmd} <id...>`);
      for (const id of args) {
        const r = await store.apply(`${cmd} ${id}`, s => T.setDone(s, id, cmd === "done"));
        console.log(`${cmd === "done" ? "✔" : "○"} ${r.task.id}  ${r.task.text}${r.next_occurrence ? `  (next: ${r.next_occurrence.id}, due ${r.next_occurrence.due})` : ""}`);
      }
      return changed("");
    }
    case "edit": {
      const [id, ...rest] = args;
      if (!id) throw new Error("Usage: jkb edit <id> [text...] [--priority p] [--due d] [--repeat r] [--tags a,b|none] [--focus|--unfocus] [--project p] [--section s]");
      const changes = {};
      if (rest.length) changes.text = rest.join(" ");
      ["priority", "due", "time", "repeat", "project", "section"].forEach(k => { if (opts[k] !== undefined) changes[k] = opts[k]; });
      if (opts.tags !== undefined) changes.tags = opts.tags === "none" ? [] : opts.tags;
      if (opts.focus) changes.focus = true;
      if (opts.unfocus) changes.focus = false;
      if (!Object.keys(changes).length) throw new Error("Nothing to change. Give new text or a --flag.");
      const r = await store.apply(`edit ${id}`, s => T.editTask(s, id, changes));
      return changed(r.changed.length ? `Updated ${r.task.id} (${r.changed.join(", ")}): ${r.task.text}` : "Nothing changed.");
    }
    case "rm": {
      if (!args.length) throw new Error("Usage: jkb rm <id...>");
      for (const id of args) { const r = await store.apply(`delete ${id}`, s => T.deleteTask(s, id)); console.log(`Deleted ${r.deleted.id}: ${r.deleted.text}`); }
      return changed("");
    }
    case "project": {
      const [title, emoji] = args;
      const r = await store.apply(`project "${title}"`, s => T.addProject(s, { title, emoji }));
      return changed(`Added project ${r.added_project.emoji} ${r.added_project.title} [${r.added_project.id}]`);
    }
    case "section": {
      const [project, ...rest] = args;
      const r = await store.apply(`section "${rest.join(" ")}"`, s => T.addSection(s, { project, name: rest.join(" ") }));
      return changed(`Added section ${r.added_section.name} to ${r.added_section.project}`);
    }
    default:
      throw new Error(`Unknown command "${cmd}". Run: jkb help`);
  }
}

main(process.argv.slice(2)).catch(e => { console.error("Error: " + e.message); process.exit(1); });
