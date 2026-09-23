const test = require("node:test");
const assert = require("node:assert");
const JKB = require("../shared.js");

test("default state has the four projects", () => {
  const s = JKB.defaultState();
  assert.deepStrictEqual(s.projects.map(p => p.id), ["jkb", "safegate", "cvg", "ceo"]);
  assert.strictEqual(JKB.stats(s).done, 0);
});

test("legacy v3 checks survive migration", () => {
  const s = JKB.normalize({ data: [{ id: "x", emoji: "📌", title: "X", subs: [{ name: "S", items: ["a", "b"] }] }], checked: { "x::0::1": true } });
  assert.deepStrictEqual(s.projects[0].sections[0].tasks.map(t => t.done), [false, true]);
});

test("deleting a task keeps the other checkmarks on the right tasks", () => {
  const s = JKB.defaultState();
  const tasks = s.projects[0].sections[0].tasks;
  const keep = tasks[2].id;
  JKB.applyOp(s, { type: "setDone", taskId: keep, done: true });
  JKB.applyOp(s, { type: "deleteTask", taskId: tasks[0].id });
  assert.strictEqual(JKB.findTask(s, keep).task.done, true);
  assert.strictEqual(JKB.stats(s).done, 1);
});

test("projects and sections resolve by name prefix, case-insensitive", () => {
  const s = JKB.defaultState();
  const t = JKB.applyOp(s, { type: "addTask", project: "safe", section: "seo", text: "Submit sitemap" });
  const found = JKB.findTask(s, t.id);
  assert.strictEqual(found.project.title, "SafeGate");
  assert.strictEqual(found.section.name, "SEO");
});

test("ambiguous and missing refs give helpful errors", () => {
  const s = JKB.defaultState();
  assert.throws(() => JKB.applyOp(s, { type: "addTask", project: "jkb", section: "a", text: "x" }), /more than one section/);
  assert.throws(() => JKB.applyOp(s, { type: "addTask", project: "nope", section: "a", text: "x" }), /No project "nope"/);
});

test("addTask can create a missing section", () => {
  const s = JKB.defaultState();
  JKB.applyOp(s, { type: "addTask", project: "cvg", section: "Launch", text: "Go live", createSection: true });
  assert.strictEqual(JKB.findSection(JKB.findProject(s, "cvg"), "launch").tasks.length, 1);
});

test("client-supplied ids are kept so browser and server agree", () => {
  const s = JKB.defaultState();
  JKB.applyOp(s, { type: "addProject", id: "p_abc", sectionId: "sec1", title: "Atlas" });
  JKB.applyOp(s, { type: "addTask", id: "t1", project: "p_abc", section: "sec1", text: "Wire Telegram" });
  assert.strictEqual(JKB.findTask(s, "t1").project.id, "p_abc");
});

test("setDone records and clears doneAt", () => {
  const s = JKB.defaultState();
  const id = s.projects[2].sections[0].tasks[0].id;
  assert.ok(JKB.applyOp(s, { type: "setDone", taskId: id, done: true }).doneAt);
  assert.strictEqual(JKB.applyOp(s, { type: "setDone", taskId: id, done: false }).doneAt, undefined);
});
