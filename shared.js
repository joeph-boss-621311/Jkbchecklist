// Shared checklist logic — used by the browser app, server, CLI and MCP connector.
// Every change to the checklist goes through applyOp() so all four stay in sync.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.JKB = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const LEGACY_DEFAULTS = [
    { id:"jkb", emoji:"🚀", title:"JKB Global", subs:[
      { name:"Brand & Website", items:["Review every page","Fix bugs","Improve loading speed","Improve mobile responsiveness","Update portfolio","Add recent projects","Improve service descriptions","Strengthen CTAs","Add client inquiry form","Connect analytics"]},
      { name:"Content System", items:["Redesign poster templates","Create 10 reusable templates","Design carousel templates","Create video templates","Add branded music","Create intro/outro animations"]},
      { name:"AI Automation", items:["Build Anything + Cloud Code workflow","Auto-generate posters","Auto-generate captions","Auto-generate hashtags","Auto-generate videos","Auto-post to social media","Auto-save generated content","Test automation","Remove workflow errors"]},
      { name:"Posting Strategy", items:["Hourly posts","Hourly videos","Weekly content calendar","Monthly campaign calendar"]},
      { name:"Content Pillars", items:["AI","Websites","Branding","Automation","Business tips","Client projects","Tutorials","Behind the scenes","Success stories","Development updates"]},
      { name:"Marketing", items:["AI content generator","AI trend finder","AI caption generator","AI comment assistant","AI reply assistant"]},
      { name:"Advertising", items:["Research Meta Ads","Research Instagram Ads","Research Google Ads","Research TikTok Ads","Create audiences","Design creatives","Write 10 ad copies","Create landing pages","Install Meta Pixel","Install Google Analytics","Install Microsoft Clarity","Launch first test campaign","Optimize weekly"]},
      { name:"Lead Generation", items:["Improve contact page","Add WhatsApp CTA","Build email list","Add newsletter","Offer free consultation","Build downloadable resources"]},
      { name:"Social Proof", items:["Post completed projects","Post testimonials","Share client wins","Show before/after work","Build in public"]},
      { name:"Analytics", items:["Track followers","Track reach","Track website visitors","Track inquiries","Track conversions","Weekly review"]},
    ]},
    { id:"safegate", emoji:"🛡", title:"SafeGate", subs:[
      { name:"Website", items:["Test every page","Fix every bug","Test buyer flow","Test seller flow","Test escrow flow","Test registration","Test login","Test email notifications","Test mobile responsiveness","Improve speed","Improve UI/UX"]},
      { name:"Trust Building", items:["Improve FAQ","Explain escrow process clearly","Add trust badges","Add security information","Add privacy policy","Improve Terms of Service","Add testimonials (when available)","Add case studies"]},
      { name:"SEO", items:["Check indexed pages","Add sitemap","Improve metadata","Improve internal linking","Research Nigerian escrow keywords","Publish SEO blog posts"]},
      { name:"AI Automation", items:["Automated poster creation","Automated captions","Automated hashtags","Automated videos","Automated posting","Automated content calendar"]},
      { name:"Content — Educational", items:["WhatsApp scams","Instagram scams","Facebook Marketplace scams","Telegram scams","Online buying tips","Escrow education"]},
      { name:"Content — Product", items:["Feature videos","Walkthrough videos","Product updates","Behind the scenes","User tutorials"]},
      { name:"Advertising Research", items:["Research Meta Ads","Research Google Search Ads","Research TikTok Ads","Research YouTube Ads","Study competitors","Research best-performing escrow ads","Build customer personas"]},
      { name:"Advertising Assets", items:["Landing pages","Video ads","Image ads","Carousel ads","10 ad copies","Install Meta Pixel","Install Google Analytics","Install Microsoft Clarity","Set conversion tracking"]},
      { name:"Growth", items:["Referral program","Email marketing","Affiliate program","Partnership strategy","Influencer outreach","Campus ambassador program"]},
      { name:"Analytics", items:["Track users","Track transactions","Track conversions","Track abandoned signups","Weekly growth report"]},
    ]},
    { id:"cvg", emoji:"💻", title:"CVG", subs:[
      { name:"Core", items:["Make CVG fully usable","Fix bugs","Improve UI","Test on mobile","Connect to JKB Global","Start posting about CVG"]},
    ]},
    { id:"ceo", emoji:"📈", title:"Weekly CEO Routine", subs:[
      { name:"Routine", items:["Review analytics","Review AI workflows","Review content performance","Improve one workflow","Improve one landing page","Launch one new feature","Publish at least one case study","Plan next week's content","Follow up with leads","Reach out to potential clients"]},
    ]},
  ];

  function uid() {
    return Math.random().toString(36).slice(2, 8).padEnd(6, "0");
  }

  function allTaskIds(state) {
    const ids = new Set();
    state.projects.forEach(p => p.sections.forEach(s => s.tasks.forEach(t => ids.add(t.id))));
    return ids;
  }

  function freshId(state) {
    const used = allTaskIds(state);
    let id = uid();
    while (used.has(id)) id = uid();
    return id;
  }

  // Converts the old v3 format ({data, checked}) where checks were keyed by index.
  function fromLegacy(data, checked) {
    checked = checked || {};
    return {
      version: 4,
      rev: 0,
      projects: data.map(g => ({
        id: g.id,
        emoji: g.emoji,
        title: g.title,
        sections: g.subs.map((s, si) => ({
          id: uid(),
          name: s.name,
          tasks: s.items.map((text, ii) => ({ id: uid(), text, done: !!checked[g.id + "::" + si + "::" + ii] })),
        })),
      })),
    };
  }

  function defaultState() {
    return fromLegacy(LEGACY_DEFAULTS, {});
  }

  function normalize(obj) {
    if (obj && Array.isArray(obj.projects)) return obj;
    if (obj && Array.isArray(obj.data)) return fromLegacy(obj.data, obj.checked);
    throw new Error("Not a JKB checklist file");
  }

  function norm(s) { return String(s).trim().toLowerCase(); }

  // Matches by exact id, then exact name, then name prefix.
  function matchOne(list, ref, nameKey, kind) {
    const r = norm(ref);
    const hit = list.find(x => x.id === ref) ||
      list.find(x => norm(x[nameKey]) === r) ||
      list.filter(x => norm(x[nameKey]).startsWith(r));
    if (Array.isArray(hit)) {
      if (hit.length === 1) return hit[0];
      const names = list.map(x => x[nameKey]).join(", ");
      throw new Error(hit.length ? `"${ref}" matches more than one ${kind}: ${hit.map(x => x[nameKey]).join(", ")}`
                                 : `No ${kind} "${ref}". Options: ${names}`);
    }
    return hit;
  }

  function findProject(state, ref) { return matchOne(state.projects, ref, "title", "project"); }
  function findSection(project, ref) { return matchOne(project.sections, ref, "name", "section"); }

  function findTask(state, taskId) {
    for (const project of state.projects)
      for (const section of project.sections) {
        const index = section.tasks.findIndex(t => t.id === taskId);
        if (index !== -1) return { project, section, task: section.tasks[index], index };
      }
    throw new Error(`No task with id "${taskId}"`);
  }

  function count(tasks) {
    return { done: tasks.filter(t => t.done).length, total: tasks.length };
  }
  function sectionStats(section) { return count(section.tasks); }
  function projectStats(project) { return count(project.sections.flatMap(s => s.tasks)); }
  function stats(state) {
    return count(state.projects.flatMap(p => p.sections.flatMap(s => s.tasks)));
  }

  function now() { return new Date().toISOString(); }

  // Applies one change to the state in place and returns what was created/changed.
  function applyOp(state, op) {
    switch (op.type) {
      case "addProject": {
        const title = String(op.title || "").trim();
        if (!title) throw new Error("Project title is required");
        const project = { id: op.id || "p_" + uid(), emoji: op.emoji || "📌", title,
          sections: [{ id: op.sectionId || uid(), name: "General", tasks: [] }] };
        state.projects.push(project);
        return project;
      }
      case "addSection": {
        const project = findProject(state, op.project);
        const name = String(op.name || "").trim();
        if (!name) throw new Error("Section name is required");
        const section = { id: op.id || uid(), name, tasks: [] };
        project.sections.push(section);
        return section;
      }
      case "removeSection": {
        const project = findProject(state, op.project);
        const section = findSection(project, op.section);
        project.sections.splice(project.sections.indexOf(section), 1);
        return section;
      }
      case "addTask": {
        const project = findProject(state, op.project);
        let section;
        try { section = findSection(project, op.section); }
        catch (e) {
          if (!op.createSection) throw e;
          section = applyOp(state, { type: "addSection", project: project.id, name: op.section, id: op.sectionId });
        }
        const text = String(op.text || "").trim();
        if (!text) throw new Error("Task text is required");
        const task = { id: op.id || freshId(state), text, done: false, createdAt: now() };
        section.tasks.push(task);
        return task;
      }
      case "editTask": {
        const text = String(op.text || "").trim();
        if (!text) throw new Error("Task text is required");
        const { task } = findTask(state, op.taskId);
        task.text = text;
        return task;
      }
      case "setDone": {
        const { task } = findTask(state, op.taskId);
        task.done = !!op.done;
        if (task.done) task.doneAt = now(); else delete task.doneAt;
        return task;
      }
      case "deleteTask": {
        const { section, task, index } = findTask(state, op.taskId);
        section.tasks.splice(index, 1);
        return task;
      }
      case "resetChecks": {
        state.projects.forEach(p => p.sections.forEach(s => s.tasks.forEach(t => { t.done = false; delete t.doneAt; })));
        return null;
      }
      case "importState": {
        state.projects = normalize(op.state).projects;
        return null;
      }
      default:
        throw new Error("Unknown operation: " + op.type);
    }
  }

  return { defaultState, normalize, fromLegacy, applyOp, findProject, findSection, findTask, stats, projectStats, sectionStats };
});
