// A small copy of the app's v2 data shape, for tests.
module.exports = () => ({
  v: 2, nextId: 20, savedAt: 1000,
  projects: [
    { id: "jkb", emoji: "🚀", title: "JKB Global", sections: [
      { id: "s2", name: "Brand & Website", tasks: [
        { id: "t3", text: "Review every page", done: false, doneAt: null, priority: "normal", due: null, createdAt: 1 },
        { id: "t4", text: "Fix bugs", done: true, doneAt: null, priority: "normal", due: null, createdAt: 1 },
      ] },
      { id: "s5", name: "SEO", tasks: [] },
    ] },
    { id: "safegate", emoji: "🛡", title: "SafeGate", sections: [
      { id: "s6", name: "Website", tasks: [{ id: "t7", text: "Test login", done: false, doneAt: null, priority: "high", due: "2020-01-01", createdAt: 1 }] },
      { id: "s8", name: "SEO", tasks: [] },
    ] },
    { id: "ceo", emoji: "📈", title: "Weekly CEO Routine", sections: [{ id: "s9", name: "Routine", tasks: [] }] },
  ],
  today: { date: "", focus: [], note: "" },
  checkins: [],
  sessions: [],
});
