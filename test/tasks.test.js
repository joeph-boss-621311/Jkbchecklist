const test = require("node:test");
const assert = require("node:assert");
const T = require("../lib/tasks");
const fixture = require("./fixture");

test("new tasks use the app's id counter and bump savedAt", () => {
  const s = fixture();
  const r = T.addTask(s, { project: "safe", section: "website", text: "Test escrow flow" });
  assert.strictEqual(r.added.id, "t" + (21).toString(36));
  assert.strictEqual(s.nextId, 21);
  assert.ok(s.savedAt > 1000);
});

test("unknown section falls back to Inbox, like the app", () => {
  const s = fixture();
  const r = T.addTask(s, { project: "ceo", section: "nope", text: "Call Tunde" });
  assert.strictEqual(r.added.section, "Inbox");
  assert.ok(s.projects[2].sections.some(x => x.name === "Inbox"));
});

test("ambiguous names are refused instead of guessed", () => {
  const s = fixture();
  assert.strictEqual(T.findProject(s, "safe").id, "safegate");
  T.addProject(s, { title: "SafeGate Ads" });
  assert.throws(() => T.findProject(s, "safe"), /more than one/);
  assert.strictEqual(T.findProject(s, "SafeGate").id, "safegate", "an exact name still wins");
  assert.strictEqual(T.findProject(s, "ceo").id, "ceo");
  assert.strictEqual(T.findSection(s.projects[1], "seo").name, "SEO");
});

test("completing a recurring task spawns the next one", () => {
  const s = fixture();
  const { added } = T.addTask(s, { project: "ceo", section: "routine", text: "Gym", repeat: "daily" });
  const r = T.setDone(s, added.id, true);
  assert.ok(r.next_occurrence);
  assert.strictEqual(r.next_occurrence.repeat, "daily");
  assert.strictEqual(r.next_occurrence.due, T.addDays(T.dayStr(), 1));
  assert.ok(!T.findTask(s, added.id).t.repeat, "old copy stops repeating");
});

test("done sets doneAt so the app's streak counts it; undo clears it", () => {
  const s = fixture();
  T.setDone(s, "t3", true);
  assert.ok(T.findTask(s, "t3").t.doneAt > 0);
  assert.strictEqual(T.status(s).done_today, 1);
  T.setDone(s, "t3", false);
  assert.strictEqual(T.findTask(s, "t3").t.doneAt, null);
});

test("deleting a focus task removes it from today's focus", () => {
  const s = fixture();
  T.editTask(s, "t3", { focus: true });
  assert.deepStrictEqual(s.today.focus, ["t3"]);
  T.deleteTask(s, "t3");
  assert.deepStrictEqual(s.today.focus, []);
});

test("edit moves, reprioritises and adds steps", () => {
  const s = fixture();
  const r = T.editTask(s, "t3", { priority: "high", due: "tomorrow", project: "safe", section: "seo", steps: ["a", "b"] });
  assert.deepStrictEqual(r.changed.sort(), ["due", "moved", "priority", "steps"]);
  const x = T.findTask(s, "t3");
  assert.strictEqual(x.p.id, "safegate"); assert.strictEqual(x.s.name, "SEO"); assert.strictEqual(x.t.subtasks.length, 2);
});

test("status reports overdue and bad input is rejected", () => {
  const s = fixture();
  assert.strictEqual(T.status(s).overdue[0].id, "t7");
  assert.throws(() => T.addTask(s, { project: "jkb", text: "x", due: "next friday" }), /Due date/);
  assert.throws(() => T.validate({ data: [] }), /v:2/);
});

test("tags are normalized, deduped and capped on add and edit", () => {
  const s = fixture();
  const r = T.addTask(s, { project: "jkb", section: "seo", text: "Talk to designer", tags: ["Client", "#Client", " URGENT ", "a", "b", "c", "d", "e", "f", "g"] });
  assert.deepStrictEqual(r.added.tags, ["client", "urgent", "a", "b", "c", "d", "e", "f"]);
  const r2 = T.editTask(s, r.added.id, { tags: ["client", "safegate"] });
  assert.deepStrictEqual(r2.task.tags, ["client", "safegate"]);
  assert.ok(r2.changed.includes("tags"));
  const r3 = T.editTask(s, r.added.id, { tags: ["client", "safegate"] });
  assert.ok(!r3.changed.includes("tags"), "re-setting the same tags is a no-op");
});

test("search matches tags too", () => {
  const s = fixture();
  const { added } = T.addTask(s, { project: "jkb", section: "seo", text: "Chase invoice", tags: ["billing"] });
  assert.deepStrictEqual(T.search(s, "billing").map(t => t.id), [added.id]);
});

test("a recurring task's tags carry over to its next occurrence", () => {
  const s = fixture();
  const { added } = T.addTask(s, { project: "ceo", section: "routine", text: "Gym", repeat: "daily", tags: ["health"] });
  const r = T.setDone(s, added.id, true);
  assert.deepStrictEqual(r.next_occurrence.tags, ["health"]);
});

test("a task's time is validated and carries over to its next occurrence", () => {
  const s = fixture();
  const r = T.addTask(s, { project: "ceo", section: "routine", text: "Gym", repeat: "daily", time: "07:30" });
  assert.strictEqual(r.added.time, "07:30");
  assert.throws(() => T.addTask(s, { project: "jkb", text: "x", time: "7:30am" }), /Time must be/);
  const done = T.setDone(s, r.added.id, true);
  assert.strictEqual(done.next_occurrence.time, "07:30", "the reminder time carries to the next occurrence");
  const e = T.editTask(s, r.added.id, { time: "none" });
  assert.strictEqual(e.task.time, undefined, "clearing the time drops it from the view");
  assert.ok(e.changed.includes("time"));
});

test("list() and status() put high priority first, done tasks last, otherwise stable", () => {
  const s = fixture();
  const sec = s.projects[0].sections[0]; // Brand & Website: t3 (normal, open), t4 (normal, done)
  T.addTask(s, { project: "jkb", section: "brand", text: "Urgent fix", priority: "high" });
  T.addTask(s, { project: "jkb", section: "brand", text: "Someday idea", priority: "low" });
  const ids = T.list(s, { project: "jkb", section: "brand" })[0].sections[0].tasks.map(t => t.id);
  // open tasks (high, then the original normal one, then low) before the done one
  assert.deepStrictEqual(ids, [sec.tasks[2].id, "t3", sec.tasks[3].id, "t4"]);
});
