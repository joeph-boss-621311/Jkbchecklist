// Checklist logic for the jkb CLI and MCP connector.
// It edits the exact document the live app saves (app/state in the claude.ai cloud save),
// so every rule here mirrors app.html: ids come from state.nextId, completing a
// recurring task spawns its next occurrence, unknown sections fall back to "Inbox",
// deleted tasks leave today's focus, and every change bumps savedAt so open apps reload.

const DAY = 86400000;
const REPEATS = ["daily", "weekdays", "weekly", "monthly"];

function dayStr(d = new Date()) {
  const z = n => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + z(d.getMonth() + 1) + "-" + z(d.getDate());
}
function parseDay(s) { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); }
function addDays(s, n) { const d = parseDay(s); d.setDate(d.getDate() + n); return dayStr(d); }
function daysBetween(a, b) { return Math.round((parseDay(b) - parseDay(a)) / DAY); }

function normPri(p) { return p === "high" || p === "low" ? p : "normal"; }
function normDue(d) {
  if (d === null || d === undefined || d === "" || d === "none") return null;
  const s = String(d).toLowerCase();
  if (s === "today") return dayStr();
  if (s === "tomorrow") return addDays(dayStr(), 1);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  throw new Error(`Due date must be YYYY-MM-DD, "today", "tomorrow" or "none" (got "${d}")`);
}
function normRepeat(r) {
  if (r === null || r === undefined || r === "" || r === "none" || r === "never") return null;
  if (!REPEATS.includes(r)) throw new Error(`Repeat must be one of ${REPEATS.join(", ")} or "none" (got "${r}")`);
  return r;
}
function normTags(tags) {
  if (tags === undefined) return undefined;
  const arr = Array.isArray(tags) ? tags : String(tags || "").split(",");
  const seen = new Set();
  arr.map(t => String(t || "").trim().toLowerCase().replace(/^#/, "")).filter(Boolean).forEach(t => seen.add(t.slice(0, 24)));
  return [...seen].slice(0, 8);
}
const PRIORITY_RANK = { high: 0, normal: 1, low: 2 };
// Open tasks first (high priority first within that), then done tasks the same way — used
// everywhere a section's tasks are displayed (the app's project view, the CLI's list/status),
// so priority actually surfaces instead of just sitting wherever it was added.
function sortTasks(tasks) {
  return sortByTask(tasks, t => t);
}
// Same ordering, but for a list of anything that WRAPS a task (e.g. status()'s {t, p, s} entries) —
// pass how to get the task out of each item.
function sortByTask(items, taskOf) {
  return items.map((item, i) => ({ item, i })).sort((a, b) => {
    const ta = taskOf(a.item), tb = taskOf(b.item);
    return (ta.done ? 1 : 0) - (tb.done ? 1 : 0) ||
      (PRIORITY_RANK[ta.priority] ?? 1) - (PRIORITY_RANK[tb.priority] ?? 1) ||
      a.i - b.i;
  }).map(x => x.item);
}
function nextDue(from, r) {
  let d = from;
  if (r === "daily") d = addDays(from, 1);
  else if (r === "weekly") d = addDays(from, 7);
  else if (r === "weekdays") { d = addDays(from, 1); while ([0, 6].includes(parseDay(d).getDay())) d = addDays(d, 1); }
  else if (r === "monthly") { const x = parseDay(from); x.setMonth(x.getMonth() + 1); d = dayStr(x); }
  return daysBetween(dayStr(), d) < 0 ? nextDue(dayStr(), r) : d;
}

function validate(state) {
  if (!state || state.v !== 2 || !Array.isArray(state.projects)) {
    throw new Error("This isn't the JKB Ops app data (expected v:2 with projects). Pull app/state again.");
  }
  if (!state.today) state.today = { date: "", focus: [], note: "" };
  if (!Array.isArray(state.today.focus)) state.today.focus = [];
  return state;
}

function newId(state, prefix) { state.nextId = (state.nextId || 1) + 1; return prefix + state.nextId.toString(36); }
function touch(state) { state.savedAt = Math.max(Date.now(), (state.savedAt || 0) + 1); }

function allTasks(state) {
  const out = [];
  state.projects.forEach(p => p.sections.forEach(s => s.tasks.forEach(t => out.push({ t, p, s }))));
  return out;
}
function findTask(state, id) {
  const x = allTasks(state).find(y => y.t.id === String(id));
  if (!x) throw new Error(`No task with id "${id}". List or search first to get ids.`);
  return x;
}

// "safe" → SafeGate, "ceo" → Weekly CEO Routine: id, exact name, then name/word prefix
function resolve(items, ref, label, nameOf) {
  const q = String(ref || "").trim().toLowerCase();
  if (!q) throw new Error(`Missing ${label}.`);
  const exact = items.filter(i => i.id === ref || nameOf(i).toLowerCase() === q);
  if (exact.length === 1) return exact[0];
  const pre = items.filter(i => nameOf(i).toLowerCase().startsWith(q) || nameOf(i).toLowerCase().split(/[\s—–-]+/).some(w => w && w.startsWith(q)));
  if (pre.length === 1) return pre[0];
  const names = items.map(nameOf).join(", ");
  if (pre.length > 1) throw new Error(`"${ref}" matches more than one ${label}: ${pre.map(nameOf).join(", ")}. Be more specific.`);
  throw new Error(`No ${label} matches "${ref}". Options: ${names}`);
}
function findProject(state, ref) { return resolve(state.projects, ref, "project", p => p.title); }
function findSection(project, ref) { return resolve(project.sections, ref, "section", s => s.name); }
function sectionOrInbox(state, project, ref) {
  if (ref) { try { return findSection(project, ref); } catch (e) { if (/matches more than one/.test(e.message)) throw e; } }
  let s = project.sections.find(x => x.name === "Inbox");
  if (!s) { s = { id: newId(state, "s"), name: "Inbox", tasks: [] }; project.sections.push(s); }
  return s;
}

function todayFocusIds(state) { return state.today && state.today.date === dayStr() ? state.today.focus : []; }
function addFocus(state, id) {
  if (!state.today || state.today.date !== dayStr()) state.today = { date: dayStr(), focus: [], note: "" };
  if (!state.today.focus.includes(id)) state.today.focus.push(id);
}
function removeFocus(state, id) { if (state.today) state.today.focus = state.today.focus.filter(x => x !== id); }

// ---------- views ----------
function taskView(x) {
  const { t, p, s } = x;
  const v = { id: t.id, text: t.text, done: !!t.done, project: p.title, project_id: p.id, section: s.name };
  if (t.priority && t.priority !== "normal") v.priority = t.priority;
  if (t.due) v.due = t.due;
  if (t.repeat) v.repeat = t.repeat;
  if (t.subtasks && t.subtasks.length) v.steps = `${t.subtasks.filter(z => z.done).length}/${t.subtasks.length}`;
  if (t.tags && t.tags.length) v.tags = t.tags;
  if (t.minutes) v.focus_minutes = t.minutes;
  if (t.done && t.doneAt) v.done_on = dayStr(new Date(t.doneAt));
  return v;
}
function completionDays(state) {
  const m = {};
  allTasks(state).forEach(x => { if (x.t.doneAt) { const d = dayStr(new Date(x.t.doneAt)); m[d] = (m[d] || 0) + 1; } });
  return m;
}
function streak(state) {
  const days = completionDays(state);
  let d = days[dayStr()] ? dayStr() : addDays(dayStr(), -1), n = 0;
  while (days[d]) { n++; d = addDays(d, -1); }
  return n;
}
function status(state) {
  validate(state);
  const today = dayStr();
  const all = allTasks(state);
  const open = all.filter(x => !x.t.done);
  const focus = todayFocusIds(state).map(id => all.find(x => x.t.id === id)).filter(Boolean);
  const upcoming = (state.checkins || []).filter(c => (c.status === "pending" || c.status === "scheduled") && new Date(c.at).getTime() > Date.now());
  return {
    today,
    done: all.length - open.length,
    total: all.length,
    done_today: completionDays(state)[today] || 0,
    streak_days: streak(state),
    focus: { planned: state.today.date === today, note: state.today.date === today ? state.today.note || "" : "", tasks: focus.map(taskView) },
    overdue: sortByTask(open.filter(x => x.t.due && daysBetween(today, x.t.due) < 0), x => x.t).map(taskView),
    due_soon: sortByTask(open.filter(x => x.t.due && daysBetween(today, x.t.due) >= 0 && daysBetween(today, x.t.due) <= 3), x => x.t).map(taskView),
    checkins: upcoming.map(c => ({ at: c.at, about: c.about })),
    projects: state.projects.map(p => {
      const ts = p.sections.flatMap(s => s.tasks);
      return { id: p.id, emoji: p.emoji, title: p.title, done: ts.filter(t => t.done).length, total: ts.length,
        high_priority_open: ts.filter(t => !t.done && t.priority === "high").length,
        sections: p.sections.map(s => ({ name: s.name, done: s.tasks.filter(t => t.done).length, total: s.tasks.length })) };
    }),
  };
}
function list(state, { project, section, openOnly } = {}) {
  validate(state);
  const projects = project ? [findProject(state, project)] : state.projects;
  return projects.map(p => ({
    project: p.title, project_id: p.id, emoji: p.emoji,
    sections: (section ? [findSection(p, section)] : p.sections).map(s => ({
      section: s.name,
      tasks: sortTasks(s.tasks.filter(t => !openOnly || !t.done)).map(t => taskView({ t, p, s })),
    })).filter(s => !openOnly || s.tasks.length),
  }));
}
function search(state, query) {
  validate(state);
  const q = String(query || "").trim().toLowerCase();
  if (!q) throw new Error("Search needs some text.");
  return allTasks(state)
    .filter(x => (x.t.text + " " + (x.t.subtasks || []).map(z => z.text).join(" ") + " " + (x.t.tags || []).join(" ")).toLowerCase().includes(q))
    .map(taskView);
}

// ---------- changes (each returns a plain summary and leaves state ready to push) ----------
function addTask(state, { project, section, text, priority, due, repeat, focus, steps, tags }) {
  validate(state);
  const body = String(text || "").trim();
  if (!body) throw new Error("Task text is empty.");
  const p = findProject(state, project);
  const s = sectionOrInbox(state, p, section);
  const t = { id: newId(state, "t"), text: body, done: false, doneAt: null, priority: normPri(priority), due: normDue(due),
    createdAt: Date.now(), repeat: normRepeat(repeat), subtasks: [], tags: normTags(tags) || [], minutes: 0 };
  (steps || []).map(z => String(z).trim()).filter(Boolean).slice(0, 12).forEach(z => t.subtasks.push({ id: newId(state, "u"), text: z, done: false }));
  if (t.repeat && !t.due) t.due = dayStr();
  s.tasks.push(t);
  if (focus) addFocus(state, t.id);
  touch(state);
  return { added: taskView({ t, p, s }) };
}
function setDone(state, id, done = true) {
  validate(state);
  const x = findTask(state, id);
  const { t, s, p } = x;
  let next = null;
  if (!!t.done !== !!done) {
    t.done = !!done;
    t.doneAt = done ? Date.now() : null;
    if (done && t.repeat) {
      next = { id: newId(state, "t"), text: t.text, done: false, doneAt: null, priority: t.priority, due: nextDue(t.due || dayStr(), t.repeat),
        createdAt: Date.now(), repeat: t.repeat, subtasks: (t.subtasks || []).map(z => ({ id: newId(state, "u"), text: z.text, done: false })), tags: [...(t.tags || [])], minutes: 0 };
      t.repeat = null;
      s.tasks.splice(s.tasks.indexOf(t) + 1, 0, next);
    }
    touch(state);
  }
  const out = { task: taskView(x) };
  if (next) out.next_occurrence = taskView({ t: next, p, s });
  return out;
}
function editTask(state, id, changes = {}) {
  validate(state);
  const x = findTask(state, id);
  const t = x.t;
  const changed = [];
  if (changes.text !== undefined) { const v = String(changes.text).trim(); if (!v) throw new Error("Task text can't be empty."); if (v !== t.text) { t.text = v; changed.push("text"); } }
  if (changes.priority !== undefined) { const v = normPri(changes.priority); if (v !== (t.priority || "normal")) { t.priority = v; changed.push("priority"); } }
  if (changes.due !== undefined) { const v = normDue(changes.due); if (v !== (t.due || null)) { t.due = v; changed.push("due"); } }
  if (changes.repeat !== undefined) { const v = normRepeat(changes.repeat); if (v !== (t.repeat || null)) { t.repeat = v; if (v && !t.due) t.due = dayStr(); changed.push("repeat"); } }
  if (changes.focus !== undefined) {
    const inFocus = todayFocusIds(state).includes(t.id);
    if (changes.focus && !inFocus) { addFocus(state, t.id); changed.push("focus"); }
    if (!changes.focus && inFocus) { removeFocus(state, t.id); changed.push("focus"); }
  }
  if (changes.steps && changes.steps.length) {
    t.subtasks = (t.subtasks || []).concat(changes.steps.map(z => String(z).trim()).filter(Boolean).map(z => ({ id: newId(state, "u"), text: z, done: false })));
    changed.push("steps");
  }
  if (changes.tags !== undefined) {
    const v = normTags(changes.tags) || [];
    if (JSON.stringify(v) !== JSON.stringify(t.tags || [])) { t.tags = v; changed.push("tags"); }
  }
  if (changes.project !== undefined || changes.section !== undefined) {
    const p = changes.project !== undefined ? findProject(state, changes.project) : x.p;
    const s = sectionOrInbox(state, p, changes.section);
    if (s !== x.s) { x.s.tasks.splice(x.s.tasks.indexOf(t), 1); s.tasks.push(t); x.p = p; x.s = s; changed.push("moved"); }
  }
  if (changed.length) touch(state);
  return { task: taskView(x), changed };
}
function deleteTask(state, id) {
  validate(state);
  const x = findTask(state, id);
  x.s.tasks.splice(x.s.tasks.indexOf(x.t), 1);
  removeFocus(state, x.t.id);
  touch(state);
  return { deleted: taskView(x) };
}
function addProject(state, { title, emoji }) {
  validate(state);
  const name = String(title || "").trim();
  if (!name) throw new Error("Project needs a title.");
  if (state.projects.some(p => p.title.toLowerCase() === name.toLowerCase())) throw new Error(`Project "${name}" already exists.`);
  const p = { id: newId(state, "p"), emoji: String(emoji || "📌").trim().slice(0, 4) || "📌", title: name, sections: [{ id: newId(state, "s"), name: "General", tasks: [] }] };
  state.projects.push(p);
  touch(state);
  return { added_project: { id: p.id, emoji: p.emoji, title: p.title, sections: ["General"] } };
}
function addSection(state, { project, name }) {
  validate(state);
  const p = findProject(state, project);
  const n = String(name || "").trim();
  if (!n) throw new Error("Section needs a name.");
  if (p.sections.some(s => s.name.toLowerCase() === n.toLowerCase())) throw new Error(`"${p.title}" already has a section called "${n}".`);
  p.sections.push({ id: newId(state, "s"), name: n, tasks: [] });
  touch(state);
  return { added_section: { project: p.title, name: n } };
}

module.exports = {
  REPEATS, dayStr, addDays, validate, allTasks, findTask, findProject, findSection, sortTasks, sortByTask, normTags,
  status, list, search, addTask, setDone, editTask, deleteTask, addProject, addSection,
};
