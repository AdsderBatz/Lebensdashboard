import { DEFAULT_QUOTES } from "./quotes-default.js";
import { uid } from "./util.js";

// Gemeinsame Schnittstelle für beide Speicher:
//   profile(), updateName(name)
//   listTodos(), addTodo(title, today), updateTodo(id, patch)
//   checksBetween(from, to), setCheck(todoId, day, on)
//   listTasksFrom(day), addTask(title, due), updateTask(id, patch), deleteTask(id), rollOver(today)
//   listQuotes(), addQuote(text, author), updateQuote(id, patch), deleteQuote(id)
//   focusInsert(row), focusUpdate(id, patch), focusList(sinceIso)

// =====================================================================
// Lokaler Testmodus (localStorage, ein Nutzer, Admin)
// =====================================================================
const LKEY = "ld.local.v1";

export class LocalStore {
  constructor() {
    this.mode = "local";
    let d = null;
    try {
      d = JSON.parse(localStorage.getItem(LKEY));
    } catch (_) {}
    this.d = d || {
      profile: { id: "local", display_name: "Ich", is_admin: true },
      todos: [],
      checks: {},
      tasks: [],
      quotes: DEFAULT_QUOTES.map((q) => ({ id: uid(), active: true, created_at: new Date().toISOString(), ...q })),
      focus: [],
    };
    this.save();
  }
  save() {
    localStorage.setItem(LKEY, JSON.stringify(this.d));
  }
  get email() {
    return null;
  }
  async profile() {
    return { ...this.d.profile };
  }
  async updateName(name) {
    this.d.profile.display_name = name;
    this.save();
  }

  async listTodos() {
    return [...this.d.todos].sort((a, b) => a.position - b.position);
  }
  async addTodo(title, today) {
    const position = this.d.todos.reduce((m, t) => Math.max(m, t.position), 0) + 1;
    const row = { id: uid(), title, position, created_on: today, archived_on: null };
    this.d.todos.push(row);
    this.save();
    return { ...row };
  }
  async updateTodo(id, patch) {
    const t = this.d.todos.find((x) => x.id === id);
    if (t) Object.assign(t, patch);
    this.save();
  }
  async checksBetween(from, to) {
    return Object.keys(this.d.checks)
      .map((k) => {
        const [todo_id, day] = k.split("|");
        return { todo_id, day };
      })
      .filter((c) => c.day >= from && c.day <= to);
  }
  async setCheck(todoId, day, on) {
    const k = todoId + "|" + day;
    if (on) this.d.checks[k] = 1;
    else delete this.d.checks[k];
    this.save();
  }

  async listTasksFrom(day) {
    return this.d.tasks.filter((t) => t.due_date >= day).map((t) => ({ ...t }));
  }
  async addTask(title, due) {
    const row = {
      id: uid(), title, due_date: due, original_date: due, moved_days: 0,
      done: false, done_at: null, created_at: new Date().toISOString(),
    };
    this.d.tasks.push(row);
    this.save();
    return { ...row };
  }
  async updateTask(id, patch) {
    const t = this.d.tasks.find((x) => x.id === id);
    if (t) Object.assign(t, patch);
    this.save();
  }
  async deleteTask(id) {
    this.d.tasks = this.d.tasks.filter((t) => t.id !== id);
    this.save();
  }
  async rollOver(today) {
    let n = 0;
    const dayMs = (s) => new Date(s + "T12:00:00").getTime();
    for (const t of this.d.tasks) {
      if (!t.done && t.due_date < today) {
        t.moved_days += Math.round((dayMs(today) - dayMs(t.due_date)) / 86400000);
        t.due_date = today;
        n++;
      }
    }
    if (n) this.save();
    return n;
  }

  async listQuotes() {
    return this.d.quotes.map((q) => ({ ...q }));
  }
  async addQuote(text, author) {
    const row = { id: uid(), text, author: author || null, active: true, created_at: new Date().toISOString() };
    this.d.quotes.push(row);
    this.save();
    return row;
  }
  async updateQuote(id, patch) {
    const q = this.d.quotes.find((x) => x.id === id);
    if (q) Object.assign(q, patch);
    this.save();
  }
  async deleteQuote(id) {
    this.d.quotes = this.d.quotes.filter((q) => q.id !== id);
    this.save();
  }

  async focusInsert(row) {
    const r = { id: uid(), ...row };
    this.d.focus.push(r);
    this.save();
    return r.id;
  }
  async focusUpdate(id, patch) {
    const r = this.d.focus.find((x) => x.id === id);
    if (r) Object.assign(r, patch);
    this.save();
  }
  async focusList(sinceIso) {
    return this.d.focus.filter((f) => f.started_at >= sinceIso).sort((a, b) => (a.started_at < b.started_at ? 1 : -1));
  }
}

// =====================================================================
// Supabase (Konten, Datenbank)
// =====================================================================
const ERR_DE = [
  [/invalid login credentials/i, "E-Mail oder Passwort falsch."],
  [/email not confirmed/i, "E-Mail noch nicht bestätigt. Öffne den Link in deinem Postfach."],
  [/already registered|already exists/i, "Für diese E-Mail gibt es schon ein Konto."],
  [/password should be at least|password.*(short|length)/i, "Passwort zu kurz (mindestens 6 Zeichen)."],
  [/unable to validate email|invalid email|email address .* is invalid/i, "Diese E-Mail-Adresse ist ungültig."],
  [/rate limit|too many/i, "Zu viele Versuche. Warte kurz und probier es dann nochmal."],
  [/signups not allowed|signup is disabled/i, "Registrierung ist deaktiviert. Frag den Admin."],
  [/failed to fetch|network/i, "Keine Verbindung zum Server. Prüfe dein Internet."],
  [/row-level security|permission denied/i, "Keine Berechtigung für diese Aktion."],
];
export function errText(e) {
  const m = (e && (e.message || e.error_description || String(e))) || "Unbekannter Fehler";
  for (const [re, de] of ERR_DE) if (re.test(m)) return de;
  return m;
}

export class SupaStore {
  constructor(client) {
    this.mode = "supabase";
    this.c = client;
    this.user = null;
  }
  get email() {
    return this.user?.email || null;
  }
  static u({ data, error }) {
    if (error) throw error;
    return data;
  }

  // ----- Auth -----
  async session() {
    const { data } = await this.c.auth.getSession();
    this.user = data.session?.user || null;
    return data.session;
  }
  onAuth(cb) {
    this.c.auth.onAuthStateChange((event, session) => {
      this.user = session?.user || null;
      cb(event, session);
    });
  }
  appUrl() {
    return location.origin + location.pathname;
  }
  async signIn(email, password) {
    const r = await this.c.auth.signInWithPassword({ email, password });
    if (r.error) throw r.error;
    this.user = r.data.user;
    return r.data;
  }
  async signUp(email, password, name) {
    const r = await this.c.auth.signUp({
      email, password,
      options: { data: { display_name: name }, emailRedirectTo: this.appUrl() },
    });
    if (r.error) throw r.error;
    this.user = r.data.session?.user || null;
    return r.data; // data.session === null → E-Mail-Bestätigung nötig
  }
  async signOut() {
    await this.c.auth.signOut();
    this.user = null;
  }
  async resetPassword(email) {
    const r = await this.c.auth.resetPasswordForEmail(email, { redirectTo: this.appUrl() });
    if (r.error) throw r.error;
  }
  async updatePassword(password) {
    const r = await this.c.auth.updateUser({ password });
    if (r.error) throw r.error;
  }

  // ----- Profil -----
  async profile() {
    const p = SupaStore.u(await this.c.from("profiles").select("id, display_name, is_admin").eq("id", this.user.id).maybeSingle());
    return p || { id: this.user.id, display_name: this.user.email, is_admin: false };
  }
  async updateName(name) {
    SupaStore.u(await this.c.from("profiles").update({ display_name: name }).eq("id", this.user.id));
  }

  // ----- Tägliche To-Dos -----
  async listTodos() {
    return SupaStore.u(
      await this.c.from("daily_todos").select("id, title, position, created_on, archived_on").order("position").order("created_at")
    );
  }
  async addTodo(title, today) {
    const { data: last } = await this.c.from("daily_todos").select("position").order("position", { ascending: false }).limit(1);
    const position = (last && last[0] ? last[0].position : 0) + 1;
    return SupaStore.u(
      await this.c.from("daily_todos").insert({ title, position, created_on: today }).select("id, title, position, created_on, archived_on").single()
    );
  }
  async updateTodo(id, patch) {
    SupaStore.u(await this.c.from("daily_todos").update(patch).eq("id", id));
  }
  async checksBetween(from, to) {
    const size = 1000;
    const all = [];
    for (let page = 0; page < 50; page++) {
      const rows = SupaStore.u(
        await this.c.from("daily_checks").select("todo_id, day").gte("day", from).lte("day", to)
          .order("day").order("todo_id").range(page * size, page * size + size - 1)
      );
      all.push(...rows);
      if (rows.length < size) break;
    }
    return all;
  }
  async setCheck(todoId, day, on) {
    if (on) {
      const { error } = await this.c.from("daily_checks").insert({ todo_id: todoId, day });
      if (error && error.code !== "23505") throw error; // 23505 = war schon abgehakt
    } else {
      SupaStore.u(await this.c.from("daily_checks").delete().eq("todo_id", todoId).eq("day", day));
    }
  }

  // ----- Aufgaben -----
  async listTasksFrom(day) {
    return SupaStore.u(await this.c.from("tasks").select("*").gte("due_date", day).order("due_date").order("created_at"));
  }
  async addTask(title, due) {
    return SupaStore.u(await this.c.from("tasks").insert({ title, due_date: due, original_date: due }).select("*").single());
  }
  async updateTask(id, patch) {
    SupaStore.u(await this.c.from("tasks").update(patch).eq("id", id));
  }
  async deleteTask(id) {
    SupaStore.u(await this.c.from("tasks").delete().eq("id", id));
  }
  async rollOver(today) {
    return SupaStore.u(await this.c.rpc("roll_over_tasks", { p_today: today }));
  }

  // ----- Zitate -----
  async listQuotes() {
    return SupaStore.u(await this.c.from("quotes").select("*").order("created_at").order("id"));
  }
  async addQuote(text, author) {
    return SupaStore.u(await this.c.from("quotes").insert({ text, author: author || null }).select("*").single());
  }
  async updateQuote(id, patch) {
    SupaStore.u(await this.c.from("quotes").update(patch).eq("id", id));
  }
  async deleteQuote(id) {
    SupaStore.u(await this.c.from("quotes").delete().eq("id", id));
  }

  // ----- Fokus -----
  async focusInsert(row) {
    return SupaStore.u(await this.c.from("focus_sessions").insert(row).select("id").single()).id;
  }
  async focusUpdate(id, patch) {
    SupaStore.u(await this.c.from("focus_sessions").update(patch).eq("id", id));
  }
  async focusList(sinceIso) {
    return SupaStore.u(
      await this.c.from("focus_sessions").select("*").gte("started_at", sinceIso).order("started_at", { ascending: false }).limit(200)
    );
  }
}
