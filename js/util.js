// ---------- Datum (immer lokale Zeit, Format YYYY-MM-DD) ----------
export const pad = (n) => String(n).padStart(2, "0");
export const toDayStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const todayStr = () => toDayStr(new Date());
export const parseDay = (s) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};
export const addDays = (s, n) => {
  const d = parseDay(s);
  d.setDate(d.getDate() + n);
  return toDayStr(d);
};
export const diffDays = (a, b) => Math.round((parseDay(a) - parseDay(b)) / 86400000);

const LOC = "de-AT";
export const fmtLong = (s) =>
  parseDay(s).toLocaleDateString(LOC, { weekday: "long", day: "numeric", month: "long" });
export const fmtShort = (s) =>
  parseDay(s).toLocaleDateString(LOC, { weekday: "short", day: "numeric", month: "short" }).replace(/\./g, "");
export const fmtDayMonth = (s) =>
  parseDay(s).toLocaleDateString(LOC, { day: "numeric", month: "short" }).replace(/\./g, "");
export const weekdayShort = (s) =>
  parseDay(s).toLocaleDateString(LOC, { weekday: "short" }).replace(/\./g, "").slice(0, 2);
export const monthShort = (y, m) =>
  new Date(y, m, 1).toLocaleDateString(LOC, { month: "short" }).replace(/\./g, "");
export const monthLong = (y, m) =>
  new Date(y, m, 1).toLocaleDateString(LOC, { month: "long", year: "numeric" });

export function relDay(day, today) {
  const d = diffDays(day, today);
  if (d === 0) return "Heute";
  if (d === 1) return "Morgen";
  if (d === 2) return "Übermorgen";
  if (d === -1) return "Gestern";
  return fmtShort(day);
}

export function fmtDuration(min) {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

export function fmtClock(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

export const uid = () =>
  crypto.randomUUID ? crypto.randomUUID() : "id-" + Date.now().toString(36) + Math.random().toString(36).slice(2);

// ---------- DOM ----------
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "style") el.setAttribute("style", v);
      else if (k === "html") el.innerHTML = v;
      else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === "dataset") Object.assign(el.dataset, v);
      else if (v === true) el.setAttribute(k, "");
      else el.setAttribute(k, v);
    }
  }
  appendChildren(el, children);
  return el;
}
function appendChildren(el, children) {
  for (const c of children) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) appendChildren(el, c);
    else if (c instanceof Node) el.appendChild(c);
    else el.appendChild(document.createTextNode(String(c)));
  }
}

// Kleine Inline-Icons (Linien, 24er Raster)
const P = {
  check: '<path d="M4 12.5l5 5L20 6.5" stroke-width="3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  up: '<path d="M6 14l6-6 6 6"/>',
  down: '<path d="M6 10l6 6 6-6"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 002 2h6a2 2 0 002-2l1-12M9 7V4h6v3"/>',
  tri: '<path d="M8 5l9 7-9 7z" fill="currentColor" stroke="none"/>',
  today: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 12.5l3 3 5-6"/>',
  chart: '<path d="M4 20h16M7 16v-5M12 16V7M17 16v-8"/>',
  timer: '<circle cx="12" cy="13" r="7.5"/><path d="M12 9.5V13l2.5 2M9.5 2.5h5"/>',
  user: '<circle cx="12" cy="8.5" r="4"/><path d="M4.5 20.5c1.2-3.6 4-5.5 7.5-5.5s6.3 1.9 7.5 5.5"/>',
  table: '<rect x="3.5" y="5" width="17" height="14" rx="2"/><path d="M3.5 10h17M9.5 10v9"/>',
  bars: '<path d="M5 19V12M10 19V6M15 19v-9M20 19V9"/>',
  mail: '<rect x="3" y="5.5" width="18" height="13" rx="2"/><path d="M3.5 7l8.5 6 8.5-6"/>',
  shield: '<path d="M12 3l7 3v5.5c0 4.5-3 8-7 9.5-4-1.5-7-5-7-9.5V6z"/>',
  cloud: '<path d="M7 18.5h10a4 4 0 00.6-7.95A6 6 0 006.2 9.6 4.5 4.5 0 007 18.5z"/>',
  quote: '<path d="M7 7h4v4c0 3-1.5 5-4 6M14 7h4v4c0 3-1.5 5-4 6"/>',
  right: '<path d="M9 6l6 6-6 6"/>',
  minus: '<path d="M5 12h14"/>',
  download: '<path d="M12 4v11M7 10.5l5 5 5-5M5 20h14"/>',
};
export function icon(name, extra = "") {
  const span = document.createElement("span");
  span.style.display = "contents";
  span.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${P[name] || ""}</svg>`;
  return span.firstChild;
}

let toastTimer;
export function toast(msg, ms = 2600) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("in");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("in"), ms);
}

// Bottom-Sheet: build(bodyEl, close) befüllt den Inhalt
export function sheet(title, build) {
  const root = document.getElementById("sheet-root");
  const backdrop = h("div", { class: "sheet-backdrop" });
  const panel = h("div", { class: "sheet", role: "dialog", "aria-modal": "true", "aria-label": title });
  const close = () => {
    backdrop.classList.remove("in");
    panel.classList.remove("in");
    setTimeout(() => {
      backdrop.remove();
      panel.remove();
    }, 230);
  };
  backdrop.addEventListener("click", close);
  panel.append(h("div", { class: "grab" }), h("h3", null, title));
  build(panel, close);
  root.append(backdrop, panel);
  requestAnimationFrame(() => {
    backdrop.classList.add("in");
    panel.classList.add("in");
    const f = panel.querySelector("input, textarea");
    if (f) setTimeout(() => f.focus(), 240);
  });
  return close;
}

export function vibrate(p) {
  try {
    navigator.vibrate && navigator.vibrate(p);
  } catch (_) {}
}
