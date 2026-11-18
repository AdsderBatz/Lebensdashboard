import { CONFIG } from "./config.js";
import { LocalStore, SupaStore, errText } from "./store.js";
import { DEFAULT_QUOTES } from "./quotes-default.js";
import * as U from "./util.js";
import { barChart } from "./chart.js";

const { h, icon, toast, sheet } = U;
const APP_VERSION = "1.0.0";

// =====================================================================
// Zustand
// =====================================================================
const S = {
  store: null,
  profile: null,
  today: U.todayStr(),
  todos: [],
  checkSet: new Set(),
  checksFrom: null,
  tasks: [],
  quotes: [],
  focus: [],
  focusLoaded: false,
  route: "heute",
  statsRange: "week",
  statsTable: false,
  statsSel: null,
  editTodos: false,
  addingTodo: false,
  addingTask: false,
  plannedOpen: false,
  focusMinutes: clampMin(Number(localStorage.getItem("ld.focus.min")) || 25),
  installEvt: null,
  hiddenAt: null,
  entered: false,
  recovery: /type=recovery/.test(location.hash),
  loadTried: {},
  androidOpen: false,
};
const view = document.getElementById("view");
const tabbar = document.getElementById("tabbar");
const ck = (todoId, day) => todoId + "|" + day;
function clampMin(m) {
  return Math.min(600, Math.max(1, Math.round(m)));
}

let resolveStore;
const storeReady = new Promise((r) => (resolveStore = r));

// =====================================================================
// Start (Aufruf ganz unten, nachdem alle Module-Konstanten existieren)
// =====================================================================
async function boot() {
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    S.installEvt = e;
    if (S.route === "profil" && S.entered) render();
  });
  window.addEventListener("appinstalled", () => {
    S.installEvt = null;
    toast("App installiert. Starte sie ab jetzt vom Startbildschirm.");
  });
  window.addEventListener("hashchange", () => {
    if (!Focus.active && S.entered) route();
  });
  document.addEventListener("visibilitychange", onVisibility);
  setInterval(checkDayChange, 60_000);
  let rt;
  window.addEventListener("resize", () => {
    clearTimeout(rt);
    rt = setTimeout(() => S.entered && S.route === "statistik" && render(), 150);
  });

  const running = Focus.load();
  if (running) {
    Splash.hideNow();
    Focus.resume(running);
  } else {
    Splash.show(window.__ldQuote || pickQuote(), () => enter());
  }

  try {
    await initStore();
  } catch (e) {
    console.error(e);
    S.store = null;
    view.replaceChildren(
      page("⚠️", "Verbindung fehlgeschlagen", null,
        callout("⚠️", h("p", null, errText(e)), "red"),
        h("button", { class: "btn primary", onclick: () => location.reload() }, "Neu laden"))
    );
  }
  resolveStore();
  refreshQuotes();
  if (running) enter();
}

async function initStore() {
  if (CONFIG.SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY) {
    await loadScript("vendor/supabase.js");
    const client = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
    const store = new SupaStore(client);
    store.onAuth((event) => {
      if (event === "PASSWORD_RECOVERY") S.recovery = true;
      if (event === "SIGNED_OUT" && S.entered) {
        resetUserState();
        renderAuth("login");
      }
    });
    await store.session();
    const authErr = /error_description=([^&]+)/.exec(location.hash);
    if (/access_token|error=|type=/.test(location.hash) || /[?&]code=/.test(location.search)) {
      history.replaceState(null, "", location.pathname + "#/heute");
    }
    if (authErr) setTimeout(() => toast(decodeURIComponent(authErr[1]).replace(/\+/g, " ")), 600);
    S.store = store;
  } else {
    S.store = new LocalStore();
  }
}

function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = res;
    s.onerror = () => rej(new Error("Supabase-Bibliothek konnte nicht geladen werden."));
    document.head.append(s);
  });
}

async function enter() {
  await storeReady;
  if (!S.store) return;
  if (S.store.mode === "supabase" && !S.store.user) {
    renderAuth("login");
    return;
  }
  try {
    await loadAll();
  } catch (e) {
    toast(errText(e), 4000);
  }
  S.entered = true;
  route();
  if (S.recovery) {
    S.recovery = false;
    askNewPassword();
  }
}

function resetUserState() {
  Object.assign(S, {
    profile: null, todos: [], checkSet: new Set(), checksFrom: null, tasks: [], focus: [],
    focusLoaded: false, entered: false, editTodos: false, addingTodo: false, addingTask: false,
  });
}

async function loadAll() {
  S.today = U.todayStr();
  S.profile = await S.store.profile();
  await S.store.rollOver(S.today);
  const [todos, checks, tasks] = await Promise.all([
    S.store.listTodos(),
    S.store.checksBetween(S.today, S.today),
    S.store.listTasksFrom(S.today),
  ]);
  S.todos = todos;
  S.checkSet = new Set(checks.map((c) => ck(c.todo_id, c.day)));
  S.checksFrom = S.today;
  S.tasks = tasks;
}

async function refreshQuotes() {
  await storeReady;
  if (!S.store) return;
  try {
    S.quotes = await S.store.listQuotes();
    const active = S.quotes.filter((q) => q.active).map((q) => ({ text: q.text, author: q.author }));
    localStorage.setItem("ld.quotes.cache", JSON.stringify(active));
    if (S.entered && S.route === "zitate") render();
  } catch (_) {
    /* offline: Cache reicht */
  }
}

function pickQuote() {
  let list = [];
  try {
    list = JSON.parse(localStorage.getItem("ld.quotes.cache")) || [];
  } catch (_) {}
  if (!list.length) list = DEFAULT_QUOTES;
  const last = localStorage.getItem("ld.quotes.last");
  let q = list[Math.floor(Math.random() * list.length)];
  if (list.length > 1) {
    for (let i = 0; i < 6 && q.text === last; i++) q = list[Math.floor(Math.random() * list.length)];
  }
  localStorage.setItem("ld.quotes.last", q.text);
  return q;
}

function onVisibility() {
  if (document.hidden) {
    S.hiddenAt = Date.now();
    Focus.onHidden();
    return;
  }
  if (Focus.active) {
    Focus.onVisible(false);
    return;
  }
  const away = S.hiddenAt ? Date.now() - S.hiddenAt : 0;
  S.hiddenAt = null;
  if (away > 30 * 60_000 && S.entered && !Splash.open) Splash.show(pickQuote(), () => {});
  checkDayChange();
}

async function checkDayChange() {
  if (!S.entered || U.todayStr() === S.today) return;
  try {
    await loadAll();
    render();
  } catch (_) {}
}

// =====================================================================
// Router + Grundgerüst
// =====================================================================
const ROUTES = ["heute", "statistik", "fokus", "profil", "zitate"];
function route() {
  const r = (location.hash.replace(/^#\/?/, "") || "heute").split("?")[0];
  S.route = ROUTES.includes(r) ? r : "heute";
  if (S.route === "zitate" && !S.profile?.is_admin) {
    location.hash = "#/profil";
    return;
  }
  S.statsSel = null;
  S.loadTried = {};
  render();
  window.scrollTo(0, 0);
}

function render() {
  if (!S.entered) return;
  renderTabbar();
  const views = { heute: viewToday, statistik: viewStats, fokus: viewFocus, profil: viewProfile, zitate: viewQuotes };
  const scroll = window.scrollY;
  view.replaceChildren(views[S.route]());
  window.scrollTo(0, scroll);
}

function renderTabbar() {
  const tabs = [
    ["heute", "Heute", "today"],
    ["statistik", "Statistik", "chart"],
    ["fokus", "Fokus", "timer"],
    ["profil", "Profil", "user"],
  ];
  const cur = S.route === "zitate" ? "profil" : S.route;
  tabbar.hidden = false;
  tabbar.replaceChildren(
    h("div", { class: "inner" },
      tabs.map(([id, label, ic]) =>
        h("a", { href: "#/" + id, class: cur === id ? "on" : null, "aria-current": cur === id ? "page" : null }, icon(ic), label)
      ))
  );
}

function page(emoji, title, meta, ...blocks) {
  return h("div", { class: "page" },
    h("div", { class: "cover", role: "img", "aria-label": "Berglandschaft bei Nacht mit Fahne auf dem Gipfel" }),
    h("div", { class: "page-inner" },
      h("div", { class: "page-icon", "aria-hidden": "true" }, emoji),
      h("h1", { class: "page-title" }, title),
      meta ? h("div", { class: "page-meta" }, meta) : null,
      ...blocks));
}

function callout(emoji, body, tone) {
  return h("div", { class: "callout" + (tone ? " " + tone : "") },
    h("div", { class: "callout-icon", "aria-hidden": "true" }, emoji),
    h("div", { class: "callout-body" }, body));
}

function checkbox(checked, label, onToggle) {
  return h("button", { class: "cb", role: "checkbox", "aria-checked": String(checked), "aria-label": label, onclick: onToggle },
    h("span", null, icon("check")));
}

function plural(n, one, many) {
  return n === 1 ? one : many;
}

// =====================================================================
// HEUTE
// =====================================================================
function activeTodos(day) {
  return S.todos.filter((t) => t.created_on <= day && (!t.archived_on || t.archived_on > day));
}

function viewToday() {
  const today = S.today;
  const act = activeTodos(today);
  const done = act.filter((t) => S.checkSet.has(ck(t.id, today))).length;
  const pct = act.length ? Math.round((done / act.length) * 100) : 0;

  // Fortschritt
  let progress;
  if (!act.length) {
    progress = callout("🧭", h("p", null, "Noch keine täglichen To-Dos. Leg fest, was du jeden Tag erledigst – ohne Plan kein Fortschritt."));
  } else {
    const left = act.length - done;
    progress = callout(pct === 100 ? "🏆" : "🔥", [
      h("div", { class: "progress-line" }, h("strong", null, `${done} von ${act.length} erledigt`), h("span", { class: "pct" }, `${pct} %`)),
      h("div", { class: "progress" + (pct === 100 ? " full" : ""), role: "progressbar", "aria-valuenow": pct, "aria-valuemin": 0, "aria-valuemax": 100 },
        h("i", { style: `width:${pct}%` })),
      h("p", { class: "muted" }, pct === 100 ? "Alles erledigt. Morgen wieder." : `${left} offen. Keine Ausreden.`),
    ]);
  }

  // Tägliche To-Dos
  const todoRows = act.map((t, i) => (S.editTodos ? todoEditRow(t, i, act) : todoRow(t)));
  let todoAdd;
  if (S.addingTodo) {
    const inp = h("input", { class: "input", placeholder: "Neues tägliches To-Do", maxlength: 200, enterkeyhint: "done", "aria-label": "Neues tägliches To-Do" });
    const submit = async () => {
      const title = inp.value.trim();
      if (!title) {
        S.addingTodo = false;
        render();
        return;
      }
      inp.value = "";
      try {
        const row = await S.store.addTodo(title, S.today);
        S.todos.push(row);
        render();
        focusSoon(".add-todo input");
      } catch (e) {
        toast(errText(e));
      }
    };
    inp.addEventListener("keydown", (e) => {
      if (e.key === "Enter") submit();
      if (e.key === "Escape") {
        S.addingTodo = false;
        render();
      }
    });
    todoAdd = h("div", { class: "edit-row add-todo" }, inp,
      h("button", { class: "btn primary", onclick: submit }, "Hinzufügen"));
  } else {
    todoAdd = h("button", { class: "add-row", onclick: () => { S.addingTodo = true; render(); focusSoon(".add-todo input"); } }, icon("plus"), "To-Do hinzufügen");
  }

  // Aufgaben heute
  const todayTasks = S.tasks.filter((t) => t.due_date === today).sort((a, b) => Number(a.done) - Number(b.done));
  const moved = todayTasks.filter((t) => !t.done && t.moved_days > 0);
  const planned = S.tasks.filter((t) => t.due_date > today);

  return page("🏔️", "Heute", U.fmtLong(today),
    progress,
    h("h2", { class: "block-h" }, "Tägliche To-Dos",
      act.length ? h("button", { class: "ghost", onclick: () => { S.editTodos = !S.editTodos; S.addingTodo = false; render(); } },
        S.editTodos ? "Fertig" : "Bearbeiten") : null),
    todoRows.length ? todoRows : null,
    S.editTodos ? null : todoAdd,

    h("h2", { class: "block-h" }, "Get-Shit-Done List"),
    moved.length
      ? callout("↻", h("p", null,
          `${moved.length} ${plural(moved.length, "Aufgabe", "Aufgaben")} aus den Vortagen verschoben. Du hast ${plural(moved.length, "sie", "sie")} liegen lassen.`), "red")
      : null,
    todayTasks.length ? todayTasks.map(taskRow) : (S.addingTask ? null : h("div", { class: "empty" }, "Keine Aufgaben für heute.")),
    taskAdd(),
    plannedBlock(planned)
  );
}

function todoRow(t) {
  const done = S.checkSet.has(ck(t.id, S.today));
  const toggle = () => toggleTodo(t);
  return h("div", { class: "todo" + (done ? " done" : "") },
    checkbox(done, t.title, toggle),
    h("button", { class: "todo-text", onclick: toggle, tabindex: -1 }, t.title));
}

async function toggleTodo(t) {
  const k = ck(t.id, S.today);
  const on = !S.checkSet.has(k);
  on ? S.checkSet.add(k) : S.checkSet.delete(k);
  if (on) U.vibrate(12);
  render();
  try {
    await S.store.setCheck(t.id, S.today, on);
  } catch (e) {
    on ? S.checkSet.delete(k) : S.checkSet.add(k);
    render();
    toast(errText(e));
  }
}

function todoEditRow(t, i, list) {
  const inp = h("input", { value: t.title, maxlength: 200, "aria-label": "To-Do umbenennen" });
  inp.addEventListener("change", async () => {
    const v = inp.value.trim();
    if (!v || v === t.title) {
      inp.value = t.title;
      return;
    }
    const old = t.title;
    t.title = v;
    try {
      await S.store.updateTodo(t.id, { title: v });
    } catch (e) {
      t.title = old;
      inp.value = old;
      toast(errText(e));
    }
  });
  inp.addEventListener("keydown", (e) => e.key === "Enter" && inp.blur());
  const move = async (dir) => {
    const other = list[i + dir];
    if (!other) return;
    const a = t.position, b = other.position === a ? a + dir : other.position;
    t.position = b;
    other.position = a;
    S.todos.sort((x, y) => x.position - y.position);
    render();
    try {
      await Promise.all([S.store.updateTodo(t.id, { position: b }), S.store.updateTodo(other.id, { position: a })]);
    } catch (e) {
      toast(errText(e));
    }
  };
  return h("div", { class: "edit-row" },
    inp,
    h("button", { class: "icon-btn", "aria-label": "Nach oben", disabled: i === 0, onclick: () => move(-1) }, icon("up")),
    h("button", { class: "icon-btn", "aria-label": "Nach unten", disabled: i === list.length - 1, onclick: () => move(1) }, icon("down")),
    h("button", { class: "icon-btn danger", "aria-label": "To-Do löschen", onclick: () => confirmDeleteTodo(t) }, icon("trash")));
}

function confirmDeleteTodo(t) {
  sheet("To-Do löschen?", (p, close) => {
    p.append(
      h("p", { style: "margin:0;color:var(--text-2)" }, `„${t.title}“ verschwindet ab heute aus deiner Liste. Die vergangenen Tage im Diagramm bleiben unverändert.`),
      h("div", { class: "actions" },
        h("button", { class: "btn", onclick: close }, "Abbrechen"),
        h("button", { class: "btn danger", onclick: async () => {
          close();
          const prev = t.archived_on;
          t.archived_on = S.today;
          render();
          try {
            await S.store.updateTodo(t.id, { archived_on: S.today });
          } catch (e) {
            t.archived_on = prev;
            render();
            toast(errText(e));
          }
        } }, "Löschen")));
  });
}

function taskRow(t) {
  const toggle = async () => {
    const was = t.done;
    t.done = !was;
    t.done_at = t.done ? new Date().toISOString() : null;
    if (t.done) U.vibrate(12);
    render();
    try {
      await S.store.updateTask(t.id, { done: t.done, done_at: t.done_at });
    } catch (e) {
      t.done = was;
      render();
      toast(errText(e));
    }
  };
  const chips = [];
  if (t.moved_days > 0) chips.push(h("span", { class: "chip red" }, `↻ ${t.moved_days} ${plural(t.moved_days, "Tag", "Tage")} verschoben`));
  return h("div", { class: "todo" + (t.done ? " done" : "") },
    checkbox(t.done, t.title, toggle),
    h("button", { class: "todo-text", onclick: () => editTask(t) },
      t.title,
      chips.length ? h("div", { class: "chips" }, chips) : null));
}

function taskAdd() {
  if (!S.addingTask) {
    return h("button", { class: "add-row", onclick: () => { S.addingTask = true; render(); focusSoon(".add-form input[type=text]"); } },
      icon("plus"), "Aufgabe hinzufügen");
  }
  const title = h("input", { type: "text", class: "input", placeholder: "Was muss erledigt werden?", maxlength: 300, enterkeyhint: "done", "aria-label": "Aufgabe" });
  const date = h("input", { type: "date", class: "input", value: S.today, min: S.today, "aria-label": "Datum" });
  const seg = h("div", { class: "seg", role: "group", "aria-label": "Datum wählen" });
  const quick = [["Heute", 0], ["Morgen", 1]];
  const paintSeg = () => {
    seg.replaceChildren(...quick.map(([l, d]) => {
      const v = U.addDays(S.today, d);
      return h("button", { type: "button", class: date.value === v ? "on" : null, onclick: () => { date.value = v; paintSeg(); } }, l);
    }));
  };
  date.addEventListener("change", paintSeg);
  paintSeg();
  const submit = async () => {
    const t = title.value.trim();
    if (!t) {
      title.focus();
      return;
    }
    const due = date.value && date.value >= S.today ? date.value : S.today;
    try {
      const row = await S.store.addTask(t, due);
      S.tasks.push(row);
      if (due !== S.today) toast(`Geplant für ${U.relDay(due, S.today)}.`);
      render();
      focusSoon(".add-form input[type=text]");
    } catch (e) {
      toast(errText(e));
    }
  };
  title.addEventListener("keydown", (e) => {
    if (e.key === "Enter") submit();
    if (e.key === "Escape") {
      S.addingTask = false;
      render();
    }
  });
  return h("div", { class: "add-form" },
    title,
    h("div", { class: "row" }, seg, date),
    h("div", { class: "row" },
      h("button", { class: "btn primary", onclick: submit }, "Hinzufügen"),
      h("button", { class: "btn", onclick: () => { S.addingTask = false; render(); } }, "Schließen")));
}

function plannedBlock(planned) {
  if (!planned.length) return null;
  const head = h("button", { class: "toggle-head", "aria-expanded": String(S.plannedOpen), onclick: () => { S.plannedOpen = !S.plannedOpen; render(); } },
    icon("tri"), "Geplant", h("span", { class: "count" }, String(planned.filter((t) => !t.done).length)));
  if (!S.plannedOpen) return head;
  const byDay = new Map();
  for (const t of [...planned].sort((a, b) => (a.due_date < b.due_date ? -1 : 1))) {
    if (!byDay.has(t.due_date)) byDay.set(t.due_date, []);
    byDay.get(t.due_date).push(t);
  }
  return [head, h("div", { class: "toggle-body" },
    [...byDay].map(([day, list]) => [h("p", { class: "date-label" }, `${U.relDay(day, S.today)} · ${U.fmtDayMonth(day)}`), list.map(taskRow)]))];
}

function editTask(t) {
  sheet("Aufgabe bearbeiten", (p, close) => {
    const title = h("input", { class: "input", value: t.title, maxlength: 300 });
    const date = h("input", { type: "date", class: "input", value: t.due_date, min: S.today });
    p.append(
      h("div", { class: "field" }, h("label", null, "Aufgabe"), title),
      h("div", { class: "field" }, h("label", null, "Datum"), date),
      t.moved_days > 0 ? h("p", { class: "chip red", style: "margin:2px 0 0" }, `Ursprünglich für ${U.fmtShort(t.original_date)} geplant · ${t.moved_days} ${plural(t.moved_days, "Tag", "Tage")} verschoben`) : null,
      h("div", { class: "actions" },
        h("button", { class: "btn danger", onclick: async () => {
          close();
          const idx = S.tasks.indexOf(t);
          S.tasks.splice(idx, 1);
          render();
          try {
            await S.store.deleteTask(t.id);
          } catch (e) {
            S.tasks.splice(idx, 0, t);
            render();
            toast(errText(e));
          }
        } }, "Löschen"),
        h("button", { class: "btn primary", onclick: async () => {
          const v = title.value.trim();
          if (!v) return title.focus();
          const due = date.value && date.value >= S.today ? date.value : t.due_date;
          close();
          const old = { title: t.title, due_date: t.due_date };
          Object.assign(t, { title: v, due_date: due });
          render();
          try {
            await S.store.updateTask(t.id, { title: v, due_date: due });
          } catch (e) {
            Object.assign(t, old);
            render();
            toast(errText(e));
          }
        } }, "Speichern")));
  });
}

function focusSoon(sel) {
  setTimeout(() => {
    const el = document.querySelector(sel);
    if (el && document.activeElement !== el) el.focus();
  }, 30);
}

// =====================================================================
// STATISTIK
// =====================================================================
function dayStat(day) {
  const act = activeTodos(day);
  if (!act.length) return null;
  const done = act.filter((t) => S.checkSet.has(ck(t.id, day))).length;
  return { day, total: act.length, done, pct: Math.round((done / act.length) * 100) };
}

function yearStart() {
  const d = U.parseDay(S.today);
  return U.toDayStr(new Date(d.getFullYear(), d.getMonth() - 11, 1));
}

async function ensureYearChecks() {
  const from = yearStart();
  if (S.checksFrom && S.checksFrom <= from) return true;
  try {
    const rows = await S.store.checksBetween(from, U.addDays(S.checksFrom || S.today, S.checksFrom ? -1 : 0));
    rows.forEach((c) => S.checkSet.add(ck(c.todo_id, c.day)));
    S.checksFrom = from;
    return true;
  } catch (e) {
    toast(errText(e));
    return false;
  }
}

async function ensureFocus() {
  if (S.focusLoaded) return;
  try {
    S.focus = await S.store.focusList(new Date(Date.now() - 30 * 86400000).toISOString());
    S.focusLoaded = true;
  } catch (e) {
    toast(errText(e));
  }
}

function currentStreak() {
  let day = S.today;
  const t = dayStat(day);
  if (!t || t.pct < 100) day = U.addDays(day, -1);
  let n = 0;
  for (let i = 0; i < 400; i++) {
    const s = dayStat(day);
    if (!s || s.pct < 100) break;
    n++;
    day = U.addDays(day, -1);
  }
  return n;
}

function buildSeries(range) {
  const today = S.today;
  if (range === "year") {
    const d = U.parseDay(today);
    const out = [];
    for (let k = 11; k >= 0; k--) {
      const y = new Date(d.getFullYear(), d.getMonth() - k, 1);
      const yr = y.getFullYear(), mo = y.getMonth();
      const days = new Date(yr, mo + 1, 0).getDate();
      const stats = [];
      for (let dd = 1; dd <= days; dd++) {
        const ds = U.toDayStr(new Date(yr, mo, dd));
        if (ds > today) break;
        const s = dayStat(ds);
        if (s) stats.push(s);
      }
      const avg = stats.length ? Math.round(stats.reduce((a, s) => a + s.pct, 0) / stats.length) : null;
      out.push({
        label: U.monthShort(yr, mo).slice(0, 3),
        value: avg,
        labelClass: k === 0 ? "today" : null,
        title: U.monthLong(yr, mo),
        detail: stats.length ? `Ø aus ${stats.length} ${plural(stats.length, "Tag", "Tagen")} · ${stats.filter((s) => s.pct === 100).length}× 100 %` : "Keine Daten",
        days: stats,
      });
    }
    return out;
  }
  const n = range === "week" ? 7 : 30;
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const day = U.addDays(today, -i);
    const s = dayStat(day);
    out.push({
      label: range === "week" ? U.weekdayShort(day) : String(U.parseDay(day).getDate()),
      value: s ? s.pct : null,
      labelClass: i === 0 ? "today" : null,
      title: i === 0 ? `Heute, ${U.fmtDayMonth(day)}` : U.fmtShort(day),
      detail: s ? `${s.done} von ${s.total} erledigt` : "Keine To-Dos an diesem Tag",
      stat: s,
    });
  }
  return out;
}

function viewStats() {
  const needLoad = !(S.checksFrom && S.checksFrom <= yearStart());
  if ((needLoad || !S.focusLoaded) && !S.loadTried.stats) {
    S.loadTried.stats = true;
    Promise.all([ensureYearChecks(), ensureFocus()]).then(() => S.route === "statistik" && render());
  }

  const range = S.statsRange;
  const series = buildSeries(range);
  const withData = series.filter((p) => p.value != null);
  const avg = withData.length ? Math.round(withData.reduce((a, p) => a + p.value, 0) / withData.length) : null;
  const fullDays = range === "year"
    ? series.reduce((a, p) => a + p.days.filter((s) => s.pct === 100).length, 0)
    : series.filter((p) => p.value === 100).length;
  const rangeName = { week: "7 Tage", month: "30 Tage", year: "12 Monate" }[range];

  const tabs = h("div", { class: "views", role: "tablist", "aria-label": "Zeitraum" },
    [["week", "Woche"], ["month", "Monat"], ["year", "Jahr"]].map(([id, l]) =>
      h("button", { role: "tab", "aria-selected": String(range === id), class: range === id ? "on" : null,
        onclick: () => { S.statsRange = id; S.statsSel = null; render(); } }, l)),
    h("span", { class: "spacer" }),
    h("button", { class: S.statsTable ? "on" : null, "aria-pressed": String(S.statsTable), onclick: () => { S.statsTable = !S.statsTable; render(); } },
      icon(S.statsTable ? "bars" : "table"), S.statsTable ? "Diagramm" : "Tabelle"));

  const readout = h("div", { class: "readout", "aria-live": "polite" });
  const paintReadout = () => {
    const p = S.statsSel != null ? series[S.statsSel] : null;
    if (p) {
      readout.replaceChildren(
        h("div", { class: "big" }, p.value == null ? "–" : `${p.value} %`),
        h("div", { class: "small" }, `${p.title} · ${p.detail}`));
    } else {
      readout.replaceChildren(
        h("div", { class: "big" }, avg == null ? "–" : `Ø ${avg} %`),
        h("div", { class: "small" }, withData.length
          ? `Durchschnitt, letzte ${rangeName} (gestrichelte Linie). Tippe auf einen Balken.`
          : "Noch keine Daten. Leg tägliche To-Dos an und hak sie ab."));
    }
  };
  paintReadout();

  let body;
  if (S.statsTable) {
    const rows = [...series].reverse();
    body = h("div", { class: "table-wrap" },
      h("table", { class: "ntable" },
        h("thead", null, h("tr", null,
          h("th", null, range === "year" ? "Monat" : "Tag"),
          h("th", { class: "num" }, range === "year" ? "Tage" : "Erledigt"),
          h("th", { class: "num" }, range === "year" ? "Ø" : "%"))),
        h("tbody", null, rows.map((p) => h("tr", null,
          h("td", null, p.title),
          h("td", { class: "num" }, range === "year" ? String(p.days.length) : (p.stat ? `${p.stat.done}/${p.stat.total}` : "–")),
          h("td", { class: "num" }, p.value == null ? "–" : `${p.value} %`))))));
  } else {
    const width = Math.min(708, window.innerWidth) - (window.innerWidth >= 760 ? 96 : 44);
    const n = series.length;
    const plotW = width - 38;
    body = barChart(series, {
      width,
      height: 210,
      avg,
      selected: S.statsSel,
      ariaLabel: `Erledigte tägliche To-Dos in Prozent, letzte ${rangeName}`,
      showLabel: (i) => {
        if (n <= 7) return true;
        if (n === 12) return plotW / 12 >= 26 || (n - 1 - i) % 2 === 0;
        return (n - 1 - i) % 5 === 0;
      },
      onSelect: (i) => {
        S.statsSel = i;
        paintReadout();
      },
    });
  }

  // Fokus-Kennzahlen (7 Tage)
  const since = Date.now() - 7 * 86400000;
  const fs = S.focus.filter((f) => new Date(f.started_at).getTime() >= since && f.status !== "running");
  const focusMin = fs.filter((f) => f.status === "completed").reduce((a, f) => a + f.planned_minutes, 0);
  const broken = fs.filter((f) => f.status === "broken" || f.status === "aborted").length;

  return page("📈", "Statistik", "Wie viel du von deinen täglichen To-Dos wirklich durchziehst.",
    tabs,
    readout,
    body,
    h("div", { class: "stats" },
      stat(avg == null ? "–" : `${avg} %`, `Ø ${rangeName}`),
      stat(String(fullDays), "Tage mit 100 %"),
      stat(String(currentStreak()), "Serie (Tage)")),
    h("h2", { class: "block-h" }, "Fokus"),
    h("div", { class: "stats" },
      stat(focusMin ? U.fmtDuration(focusMin) : "0 min", "Fokuszeit, 7 Tage"),
      stat(String(fs.filter((f) => f.status === "completed").length), "Durchgezogen"),
      stat(String(broken), "Gebrochen")));
}

function stat(v, l) {
  return h("div", { class: "stat" }, h("div", { class: "v" }, v), h("div", { class: "l" }, l));
}

// =====================================================================
// FOKUS (Seite)
// =====================================================================
function viewFocus() {
  if (!S.focusLoaded && !S.loadTried.focus) {
    S.loadTried.focus = true;
    ensureFocus().then(() => S.route === "fokus" && render());
  }
  const setMin = (m) => {
    S.focusMinutes = clampMin(m);
    localStorage.setItem("ld.focus.min", S.focusMinutes);
    render();
  };
  const step = (dir) => {
    const m = S.focusMinutes;
    if (dir > 0) setMin(m < 5 ? m + 1 : Math.floor(m / 5) * 5 + 5);
    else setMin(m <= 5 ? m - 1 : Math.ceil(m / 5) * 5 - 5);
  };
  const presets = [15, 25, 45, 60, 90, 120];
  const sessions = S.focus.filter((f) => f.status !== "running").slice(0, 12);

  const androidOpen = !!S.androidOpen;
  const guide = [
    h("button", { class: "toggle-head", "aria-expanded": String(androidOpen), onclick: () => { S.androidOpen = !androidOpen; render(); } },
      icon("tri"), "Echte Sperre auf Android einrichten"),
    androidOpen ? h("div", { class: "toggle-body" },
      h("p", { style: "margin:6px 0;color:var(--text-2);font-size:15px" },
        "Eine Webapp darf andere Apps nicht blockieren. Das übernimmt Android selbst. Menünamen weichen je nach Hersteller leicht ab."),
      h("ol", { class: "steps" },
        h("li", null, h("strong", null, "Fokusmodus: "), "Einstellungen → Digital Wellbeing (Samsung: Digitales Wohlbefinden) → Fokusmodus. Ablenkende Apps auswählen und vor der Session einschalten. Anrufe bleiben erreichbar."),
        h("li", null, h("strong", null, "Nicht stören mit Ausnahmen: "), "Einstellungen → Benachrichtigungen → Nicht stören → Anrufe: Favoriten und wiederholte Anrufer erlauben. So kommen dringende Anrufe durch, der Rest nicht."),
        h("li", null, h("strong", null, "App anpinnen (optional, am härtesten): "), "Einstellungen → Sicherheit → App-Anpinnen aktivieren. Dann in der App-Übersicht auf das Symbol dieser App tippen → Anpinnen. Teste einmal mit einem zweiten Handy, ob Anrufe auf deinem Gerät durchkommen."))) : null,
  ];

  return page("⏳", "Fokus", "Timer stellen. Handy weg. Durchziehen.",
    h("div", { class: "timer-set" },
      h("button", { class: "round-btn", "aria-label": "Weniger Minuten", onclick: () => step(-1) }, icon("minus")),
      h("div", null, h("div", { class: "mins", "aria-live": "polite" }, String(S.focusMinutes)), h("div", { class: "unit" }, "Minuten")),
      h("button", { class: "round-btn", "aria-label": "Mehr Minuten", onclick: () => step(1) }, icon("plus"))),
    h("div", { class: "presets" }, presets.map((m) =>
      h("button", { class: S.focusMinutes === m ? "on" : null, onclick: () => setMin(m) }, `${m} min`))),
    h("button", { class: "btn primary block", style: "min-height:50px;font-size:16px", onclick: () => Focus.start(S.focusMinutes) }, "Sperre starten"),
    callout("🔒", h("p", { class: "muted", style: "font-size:15px" },
      "Bis der Timer abläuft, ist die App gesperrt und der Bildschirm bleibt an. Anrufe kommen weiter durch. Verlässt du die App, musst du beim Zurückkommen angeben, warum. Wechselst du in eine andere App, gilt die Session als gebrochen.")),
    guide,
    h("h2", { class: "block-h" }, "Letzte Sessions"),
    sessions.length ? sessions.map(sessionRow) : h("div", { class: "empty" }, "Noch keine Sessions."));
}

function sessionRow(f) {
  const d = new Date(f.started_at);
  const day = U.toDayStr(d);
  const time = `${U.pad(d.getHours())}:${U.pad(d.getMinutes())}`;
  const chip = {
    completed: h("span", { class: "chip green" }, "Durchgezogen"),
    broken: h("span", { class: "chip red" }, "Gebrochen"),
    aborted: h("span", { class: "chip" }, "Abgebrochen"),
  }[f.status];
  const extra = [];
  if (f.call_exits) extra.push(`${f.call_exits}× Anruf`);
  if (f.exits) extra.push(`${f.exits}× andere App`);
  return h("div", { class: "session" },
    h("div", { class: "when" }, `${U.relDay(day, S.today)}, ${time}`, h("small", null, [`${f.planned_minutes} min`, ...extra].join(" · "))),
    chip);
}

// =====================================================================
// PROFIL + ZITATE
// =====================================================================
function viewProfile() {
  const p = S.profile || {};
  const local = S.store.mode === "local";
  const standalone = matchMedia("(display-mode: standalone)").matches || matchMedia("(display-mode: fullscreen)").matches;
  const prop = (ic, k, v) => h("div", { class: "prop" }, h("div", { class: "k" }, icon(ic), k), h("div", { class: "v" }, v));

  let install = null;
  if (!standalone) {
    install = S.installEvt
      ? h("button", { class: "btn primary block", onclick: async () => {
          S.installEvt.prompt();
          await S.installEvt.userChoice;
          S.installEvt = null;
          render();
        } }, icon("download"), "Zum Startbildschirm hinzufügen")
      : callout("📲", h("p", { class: "muted", style: "font-size:15px" }, "Als App installieren: In Chrome oben rechts auf ⋮ tippen → „App installieren“ bzw. „Zum Startbildschirm hinzufügen“."));
  }

  return page("👤", p.display_name || "Profil", null,
    h("div", { class: "props" },
      prop("user", "Name", h("button", { style: "color:var(--text)", onclick: editName }, p.display_name || "–")),
      local ? null : prop("mail", "E-Mail", S.store.email || "–"),
      prop("shield", "Rolle", h("span", { class: "chip " + (p.is_admin ? "blue" : "") }, p.is_admin ? "Admin" : "Mitglied")),
      prop("cloud", "Speicher", local ? "Nur auf diesem Gerät" : "Online-Konto")),
    local ? callout("🧪", h("p", { class: "muted", style: "font-size:15px" },
      "Lokaler Testmodus: keine Konten, Daten nur in diesem Browser. Für Konten Supabase einrichten und die Zugangsdaten in js/config.js eintragen (siehe Anleitung).")) : null,
    install,
    p.is_admin ? [
      h("h2", { class: "block-h" }, "Verwaltung"),
      h("a", { class: "list-link", href: "#/zitate" }, icon("quote"), h("span", { class: "t" }, "Zitate verwalten"),
        h("span", { class: "sub" }, S.quotes.length ? String(S.quotes.filter((q) => q.active).length) : ""), icon("right")),
    ] : null,
    h("h2", { class: "block-h" }, "App"),
    h("button", { class: "list-link", onclick: () => Splash.show(pickQuote(), () => {}) }, icon("quote"), h("span", { class: "t" }, "Zitat-Bildschirm anzeigen"), icon("right")),
    local ? null : h("button", { class: "list-link", onclick: async () => {
      await S.store.signOut();
      resetUserState();
      renderAuth("login");
    } }, icon("right"), h("span", { class: "t", style: "color:var(--red)" }, "Abmelden")),
    h("p", { style: "color:var(--text-3);font-size:13px;margin-top:28px" }, `Lebensdashboard ${APP_VERSION}`));
}

function editName() {
  sheet("Name ändern", (p, close) => {
    const inp = h("input", { class: "input", value: S.profile?.display_name || "", maxlength: 60 });
    const save = async () => {
      const v = inp.value.trim();
      if (!v) return inp.focus();
      close();
      try {
        await S.store.updateName(v);
        S.profile.display_name = v;
        render();
      } catch (e) {
        toast(errText(e));
      }
    };
    inp.addEventListener("keydown", (e) => e.key === "Enter" && save());
    p.append(h("div", { class: "field" }, inp),
      h("div", { class: "actions" }, h("button", { class: "btn", onclick: close }, "Abbrechen"), h("button", { class: "btn primary", onclick: save }, "Speichern")));
  });
}

function viewQuotes() {
  const qs = S.quotes;
  const active = qs.filter((q) => q.active).length;
  return page("🛡️", "Zitate", `${active} von ${qs.length} aktiv. Nur Admins können hier etwas ändern.`,
    h("button", { class: "add-row", onclick: () => editQuote(null) }, icon("plus"), "Neues Zitat"),
    qs.length ? qs.map((q) =>
      h("div", { class: "quote-row" + (q.active ? "" : " off") },
        checkbox(q.active, `Zitat aktiv: ${q.text}`, async () => {
          q.active = !q.active;
          render();
          try {
            await S.store.updateQuote(q.id, { active: q.active });
            refreshQuotes();
          } catch (e) {
            q.active = !q.active;
            render();
            toast(errText(e));
          }
        }),
        h("button", { class: "q", onclick: () => editQuote(q) }, q.text, h("span", { class: "a" }, q.author ? `— ${q.author}` : "Ohne Autor"))))
      : h("div", { class: "empty" }, "Noch keine Zitate."));
}

function editQuote(q) {
  sheet(q ? "Zitat bearbeiten" : "Neues Zitat", (p, close) => {
    const text = h("textarea", { class: "input", maxlength: 500, placeholder: "Zitat" });
    text.value = q?.text || "";
    const author = h("input", { class: "input", maxlength: 80, placeholder: "Leer lassen, wenn ohne Autor", value: q?.author || "" });
    p.append(
      h("div", { class: "field" }, h("label", null, "Text"), text),
      h("div", { class: "field" }, h("label", null, "Autor"), author),
      h("div", { class: "actions" },
        q ? h("button", { class: "btn danger", onclick: async () => {
          close();
          try {
            await S.store.deleteQuote(q.id);
            S.quotes = S.quotes.filter((x) => x !== q);
            render();
            refreshQuotes();
          } catch (e) {
            toast(errText(e));
          }
        } }, "Löschen") : h("button", { class: "btn", onclick: close }, "Abbrechen"),
        h("button", { class: "btn primary", onclick: async () => {
          const t = text.value.trim();
          const a = author.value.trim() || null;
          if (!t) return text.focus();
          close();
          try {
            if (q) {
              await S.store.updateQuote(q.id, { text: t, author: a });
              Object.assign(q, { text: t, author: a });
            } else {
              S.quotes.push(await S.store.addQuote(t, a));
            }
            render();
            refreshQuotes();
            toast("Gespeichert.");
          } catch (e) {
            toast(errText(e));
          }
        } }, "Speichern")));
  });
}

// =====================================================================
// LOGIN / REGISTRIERUNG
// =====================================================================
function renderAuth(mode) {
  tabbar.hidden = true;
  const isReg = mode === "register";
  const name = h("input", { class: "input", placeholder: "Name", autocomplete: "name", maxlength: 60, "aria-label": "Name" });
  const email = h("input", { class: "input", type: "email", placeholder: "E-Mail", autocomplete: "email", inputmode: "email", "aria-label": "E-Mail" });
  const pw = h("input", { class: "input", type: "password", placeholder: "Passwort", autocomplete: isReg ? "new-password" : "current-password", minlength: 6, "aria-label": "Passwort" });
  const msg = h("div", { class: "err", role: "alert" });
  const btn = h("button", { class: "btn primary block", type: "submit" }, isReg ? "Konto erstellen" : "Anmelden");
  const form = h("form", { novalidate: true }, isReg ? name : null, email, pw, msg, btn);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    msg.className = "err";
    msg.textContent = "";
    if (!email.value.trim() || !pw.value) {
      msg.textContent = "E-Mail und Passwort eingeben.";
      return;
    }
    if (isReg && !name.value.trim()) {
      msg.textContent = "Gib einen Namen ein.";
      return;
    }
    btn.disabled = true;
    try {
      if (isReg) {
        const data = await S.store.signUp(email.value.trim(), pw.value, name.value.trim());
        if (!data.session) {
          msg.className = "ok";
          msg.textContent = "Fast fertig: Öffne den Bestätigungslink in deiner E-Mail. Danach hier anmelden.";
          btn.disabled = false;
          return;
        }
      } else {
        await S.store.signIn(email.value.trim(), pw.value);
      }
      view.replaceChildren();
      await enter();
    } catch (err) {
      msg.textContent = errText(err);
      btn.disabled = false;
    }
  });
  const forgot = isReg ? null : h("button", { type: "button", class: "ghost", style: "align-self:center;margin-top:4px", onclick: async () => {
    if (!email.value.trim()) {
      msg.className = "err";
      msg.textContent = "Gib zuerst deine E-Mail ein.";
      return email.focus();
    }
    try {
      await S.store.resetPassword(email.value.trim());
      msg.className = "ok";
      msg.textContent = "Link zum Zurücksetzen gesendet. Prüfe dein Postfach.";
    } catch (err) {
      msg.className = "err";
      msg.textContent = errText(err);
    }
  } }, "Passwort vergessen?");
  if (forgot) form.append(forgot);

  view.replaceChildren(
    h("div", { class: "auth" },
      h("div", { class: "cover", role: "img", "aria-label": "Berglandschaft bei Nacht" }),
      h("div", { class: "page-inner" },
        h("div", { class: "page-icon", "aria-hidden": "true" }, "🏔️"),
        h("h1", { class: "page-title" }, isReg ? "Konto erstellen" : "Anmelden"),
        h("div", { class: "page-meta" }, isReg ? "Deine Listen und deine Statistik sieht nur du." : "Melde dich an, um deine Listen zu sehen."),
        form,
        h("p", { class: "switch" }, isReg ? "Schon ein Konto? " : "Noch kein Konto? ",
          h("button", { type: "button", onclick: () => renderAuth(isReg ? "login" : "register") }, isReg ? "Anmelden" : "Registrieren")))));
}

function askNewPassword() {
  sheet("Neues Passwort festlegen", (p, close) => {
    const pw = h("input", { class: "input", type: "password", placeholder: "Neues Passwort (mind. 6 Zeichen)", autocomplete: "new-password" });
    p.append(h("div", { class: "field" }, pw),
      h("div", { class: "actions" }, h("button", { class: "btn primary", onclick: async () => {
        try {
          await S.store.updatePassword(pw.value);
          close();
          toast("Passwort geändert.");
        } catch (e) {
          toast(errText(e));
        }
      } }, "Speichern")));
  });
}

// =====================================================================
// STARTBILDSCHIRM: Zitat, 3 Sekunden gedrückt halten
// =====================================================================
const HOLD_MS = 3000;
const Splash = {
  open: false,
  hideNow() {
    const el = document.getElementById("splash");
    if (el) el.remove();
  },
  show(q, onDone) {
    let el = document.getElementById("splash");
    if (!el) {
      el = document.createElement("div");
      el.id = "splash";
      document.body.append(el);
    }
    el.hidden = false;
    el.className = "";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-label", "Zitat. Bildschirm drei Sekunden gedrückt halten, um fortzufahren.");
    const C = 2 * Math.PI * 38;
    el.innerHTML = "";
    const quote = h("figure", { class: "splash-quote" },
      h("blockquote", null, q.text),
      q.author ? h("figcaption", null, "— " + q.author) : null);
    const ring = h("div", { class: "hold-ring", html:
      `<svg viewBox="0 0 84 84"><circle class="track" cx="42" cy="42" r="38" fill="none" stroke-width="3"/>` +
      `<circle class="bar" cx="42" cy="42" r="38" fill="none" stroke-width="3" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${C}"/></svg><div class="dot"></div>` });
    const hold = h("div", { class: "hold" }, ring, h("div", { class: "hold-hint" }, "3 Sekunden gedrückt halten"));
    el.append(quote, hold);
    this.open = true;

    const bar = ring.querySelector(".bar");
    let t0 = 0, raf = 0, pressing = false, finished = false;
    const frame = (now) => {
      if (!pressing) return;
      const p = Math.min(1, (now - t0) / HOLD_MS);
      bar.style.strokeDashoffset = String(C * (1 - p));
      if (p >= 1) return finish();
      raf = requestAnimationFrame(frame);
    };
    const start = (e) => {
      if (finished || pressing) return;
      if (e && e.cancelable) e.preventDefault();
      pressing = true;
      hold.classList.add("pressing");
      t0 = performance.now();
      raf = requestAnimationFrame(frame);
    };
    const cancel = () => {
      if (!pressing || finished) return;
      pressing = false;
      cancelAnimationFrame(raf);
      hold.classList.remove("pressing");
      bar.style.strokeDashoffset = String(C);
    };
    const finish = () => {
      finished = true;
      pressing = false;
      U.vibrate(30);
      cleanup();
      // Finger liegt noch auf dem Display: den Klick beim Loslassen schlucken,
      // sonst landet er auf dem Element unter dem Startbildschirm.
      const swallow = (e) => {
        e.stopPropagation();
        e.preventDefault();
      };
      document.addEventListener("click", swallow, true);
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        setTimeout(() => document.removeEventListener("click", swallow, true), 350);
      };
      window.addEventListener("pointerup", release, { once: true });
      window.addEventListener("pointercancel", release, { once: true });
      window.addEventListener("keyup", release, { once: true });
      setTimeout(release, 5000);
      el.classList.add("out");
      setTimeout(() => {
        el.hidden = true;
        el.classList.remove("out");
      }, 460);
      this.open = false;
      onDone && onDone();
    };
    const onKeyDown = (e) => {
      if ((e.key === " " || e.key === "Enter") && !e.repeat) start(e);
    };
    const onKeyUp = (e) => {
      if (e.key === " " || e.key === "Enter") cancel();
    };
    const noMenu = (e) => e.preventDefault();
    el.addEventListener("pointerdown", start);
    el.addEventListener("pointerup", cancel);
    el.addEventListener("pointercancel", cancel);
    el.addEventListener("pointerleave", cancel);
    el.addEventListener("contextmenu", noMenu);
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("keyup", onKeyUp);
    const cleanup = () => {
      el.removeEventListener("pointerdown", start);
      el.removeEventListener("pointerup", cancel);
      el.removeEventListener("pointercancel", cancel);
      el.removeEventListener("pointerleave", cancel);
      el.removeEventListener("contextmenu", noMenu);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("keyup", onKeyUp);
    };
  },
};

// =====================================================================
// FOKUS-SPERRE
// =====================================================================
const FKEY = "ld.focus.running";
const EMERGENCY_MS = 5000;
const Focus = {
  st: null,
  timer: 0,
  wake: null,
  audio: null,
  el: null,
  card: null,
  get active() {
    return !!this.st;
  },
  load() {
    try {
      const s = JSON.parse(localStorage.getItem(FKEY));
      return s && s.endAt ? s : null;
    } catch (_) {
      return null;
    }
  },
  persist() {
    if (this.st) localStorage.setItem(FKEY, JSON.stringify(this.st));
  },

  async start(minutes) {
    const now = Date.now();
    this.st = { id: null, startedAt: now, endAt: now + minutes * 60000, minutes, exits: 0, callExits: 0, screenOffs: 0, hiddenAt: null, pendingAway: null };
    this.persist();
    try {
      this.audio = new (window.AudioContext || window.webkitAudioContext)();
    } catch (_) {}
    try {
      await document.documentElement.requestFullscreen?.({ navigationUI: "hide" });
    } catch (_) {}
    this.show();
    try {
      const id = await S.store.focusInsert({ started_at: new Date(now).toISOString(), planned_minutes: minutes, status: "running" });
      if (this.st) {
        this.st.id = id;
        this.persist();
      }
    } catch (_) {
      /* offline: wird am Ende nachgetragen */
    }
  },

  resume(st) {
    this.st = st;
    this.show();
    if (st.pendingAway != null) this.ask(st.pendingAway);
    else if (st.hiddenAt) this.onVisible(true);
  },

  show() {
    this.el?.remove();
    const q = pickQuote();
    this.el = h("div", { id: "lock", role: "dialog", "aria-modal": "true", "aria-label": "Fokus-Sperre aktiv" },
      h("div", { class: "lock-label" }, "Fokus läuft"),
      h("div", { class: "lock-time", "aria-live": "off" }, "--:--"),
      h("div", { class: "lock-bar" }, h("i")),
      h("p", { class: "lock-quote" }, q.text, q.author ? h("small", null, "— " + q.author) : null),
      h("div", { class: "lock-meta" }));
    const em = h("button", { class: "emergency", "aria-label": "Notfall-Abbruch: 5 Sekunden gedrückt halten" }, h("i"), h("span", null, "Notfall-Abbruch: 5 s halten"));
    this.el.append(h("div", { class: "lock-bottom" }, em));
    this.bindEmergency(em);
    this.el.addEventListener("contextmenu", (e) => e.preventDefault());
    document.body.append(this.el);
    history.pushState({ lock: 1 }, "");
    window.addEventListener("popstate", this.onPop);
    this.requestWake();
    this.tick();
    clearInterval(this.timer);
    this.timer = setInterval(() => this.tick(), 250);
  },

  onPop: () => {
    if (!Focus.st) return;
    history.pushState({ lock: 1 }, "");
    const t = Focus.el?.querySelector(".lock-time");
    if (t) {
      t.classList.remove("shake");
      void t.offsetWidth;
      t.classList.add("shake");
    }
    U.vibrate(60);
  },

  tick() {
    if (!this.st || !this.el) return;
    const total = this.st.endAt - this.st.startedAt;
    const left = this.st.endAt - Date.now();
    this.el.querySelector(".lock-time").textContent = U.fmtClock(left);
    this.el.querySelector(".lock-bar i").style.width = `${Math.min(100, (1 - left / total) * 100)}%`;
    const meta = this.el.querySelector(".lock-meta");
    const chips = [];
    if (this.st.callExits) chips.push(h("span", { class: "chip" }, `${this.st.callExits}× Anruf`));
    if (this.st.screenOffs) chips.push(h("span", { class: "chip" }, `${this.st.screenOffs}× Bildschirm aus`));
    if (this.st.exits) chips.push(h("span", { class: "chip red" }, `${this.st.exits}× andere App – gebrochen`));
    meta.replaceChildren(...chips);
    if (left <= 0 && !this.card) this.finish("time");
  },

  onHidden() {
    if (!this.st) return;
    this.st.hiddenAt = Date.now();
    this.persist();
  },

  onVisible(fromResume) {
    if (!this.st) return;
    this.requestWake();
    if (!this.st.hiddenAt) return;
    const away = Date.now() - this.st.hiddenAt;
    this.st.hiddenAt = null;
    this.persist();
    if (away < 1500 && !fromResume) return;
    this.ask(away);
  },

  ask(away) {
    this.st.pendingAway = away;
    this.persist();
    this.card?.remove();
    const answer = (kind) => {
      if (kind === "call") this.st.callExits++;
      if (kind === "screen") this.st.screenOffs++;
      if (kind === "app") {
        this.st.exits++;
        toast("Notiert. Diese Session gilt als gebrochen.");
      }
      this.st.pendingAway = null;
      this.persist();
      this.card.remove();
      this.card = null;
      this.tick();
    };
    this.card = h("div", { class: "lock-card", role: "alertdialog", "aria-label": "Warum hast du die App verlassen?" },
      h("h2", null, "Du warst weg."),
      h("p", null, `${U.fmtClock(away)} außerhalb der App. Warum? Sei ehrlich – das wird gespeichert.`),
      h("div", { class: "choices" },
        h("button", { class: "btn", onclick: () => answer("call") }, "Anruf"),
        h("button", { class: "btn", onclick: () => answer("screen") }, "Bildschirm war aus"),
        h("button", { class: "btn danger", onclick: () => answer("app") }, "Andere App geöffnet")));
    this.el.append(this.card);
  },

  bindEmergency(btn) {
    const fill = btn.querySelector("i");
    let t0 = 0, raf = 0, on = false;
    const frame = (now) => {
      if (!on) return;
      const p = Math.min(1, (now - t0) / EMERGENCY_MS);
      fill.style.width = `${p * 100}%`;
      if (p >= 1) {
        on = false;
        this.finish("abort");
        return;
      }
      raf = requestAnimationFrame(frame);
    };
    const start = (e) => {
      e.preventDefault();
      on = true;
      t0 = performance.now();
      raf = requestAnimationFrame(frame);
    };
    const stop = () => {
      on = false;
      cancelAnimationFrame(raf);
      fill.style.width = "0";
    };
    btn.addEventListener("pointerdown", start);
    btn.addEventListener("pointerup", stop);
    btn.addEventListener("pointercancel", stop);
    btn.addEventListener("pointerleave", stop);
  },

  async requestWake() {
    try {
      if ("wakeLock" in navigator && document.visibilityState === "visible" && this.st) {
        this.wake = await navigator.wakeLock.request("screen");
      }
    } catch (_) {}
  },

  beep() {
    try {
      const ctx = this.audio;
      if (!ctx) return;
      ctx.resume?.();
      [0, 0.35].forEach((off) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.frequency.value = 880;
        g.gain.setValueAtTime(0.0001, ctx.currentTime + off);
        g.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + off + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + off + 0.25);
        o.connect(g).connect(ctx.destination);
        o.start(ctx.currentTime + off);
        o.stop(ctx.currentTime + off + 0.3);
      });
    } catch (_) {}
  },

  async finish(reason) {
    if (!this.st) return;
    clearInterval(this.timer);
    const st = this.st;
    this.st = null;
    localStorage.removeItem(FKEY);
    window.removeEventListener("popstate", this.onPop);
    try {
      await this.wake?.release();
    } catch (_) {}
    this.wake = null;
    const status = reason === "abort" ? "aborted" : st.exits > 0 ? "broken" : "completed";
    const endIso = new Date(reason === "abort" ? Date.now() : st.endAt).toISOString();
    const row = { ended_at: endIso, status, exits: st.exits, call_exits: st.callExits };

    if (status === "completed") {
      U.vibrate([200, 100, 200]);
      this.beep();
    }
    const text = {
      completed: ["Durchgezogen.", `${st.minutes} ${plural(st.minutes, "Minute", "Minuten")} Fokus. So sieht Disziplin aus.`],
      broken: ["Gebrochen.", `Du hast ${st.exits}× eine andere App geöffnet. Notiert. Nächstes Mal ohne.`],
      aborted: ["Abgebrochen.", "Notfall-Abbruch. Notiert."],
    }[status];
    this.el.querySelector(".lock-bottom")?.remove();
    this.card?.remove();
    this.card = h("div", { class: "lock-card" },
      h("h2", null, text[0]),
      h("p", null, text[1]),
      h("div", { class: "choices" }, h("button", { class: "btn primary", onclick: () => {
        this.el.remove();
        this.el = null;
        this.card = null;
        try {
          if (document.fullscreenElement) document.exitFullscreen();
        } catch (_) {}
        S.focusLoaded = false;
        if (S.entered) {
          if (location.hash !== "#/fokus") location.hash = "#/fokus";
          else route();
        }
      } }, "Weiter")));
    this.el.append(this.card);

    await storeReady;
    try {
      if (st.id) await S.store.focusUpdate(st.id, row);
      else await S.store.focusInsert({ started_at: new Date(st.startedAt).toISOString(), planned_minutes: st.minutes, ...row });
    } catch (e) {
      toast("Session konnte nicht gespeichert werden: " + errText(e), 4000);
    }
  },
};

boot();
