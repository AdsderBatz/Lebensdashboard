// Schlankes SVG-Balkendiagramm (0–100 %), eine Serie, Tippen/Wischen wählt einen Balken.
const NS = "http://www.w3.org/2000/svg";
const el = (tag, attrs = {}, text) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) e.setAttribute(k, v);
  if (text != null) e.textContent = text;
  return e;
};

// Balken mit 4px abgerundetem Kopf, an der Grundlinie eckig
function barPath(x, y, w, hgt, r) {
  r = Math.min(r, w / 2, hgt);
  return `M${x} ${y + hgt}V${y + r}Q${x} ${y} ${x + r} ${y}H${x + w - r}Q${x + w} ${y} ${x + w} ${y + r}V${y + hgt}Z`;
}

/**
 * points: [{ label, value: 0..100 | null, labelClass? }]
 * opts: { width, height, avg, selected, showLabel(i) => bool, onSelect(i|null) }
 */
export function barChart(points, opts) {
  const W = Math.max(260, Math.round(opts.width || 340));
  const H = opts.height || 200;
  const m = { l: 34, r: 4, t: 12, b: 24 };
  const pw = W - m.l - m.r;
  const ph = H - m.t - m.b;
  const n = points.length;
  const slot = pw / n;
  const gap = n > 14 ? 2 : Math.max(6, slot * 0.3);
  const bw = Math.min(40, slot - gap);
  const y = (v) => m.t + ph * (1 - v / 100);

  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: "img", "aria-label": opts.ariaLabel || "Balkendiagramm" });

  // Raster + y-Beschriftung
  for (const v of [0, 50, 100]) {
    svg.append(el("line", { class: "grid", x1: m.l, x2: W - m.r, y1: y(v), y2: y(v) }));
    svg.append(el("text", { class: "axis-label", x: m.l - 8, y: y(v) + 4, "text-anchor": "end" }, v === 100 ? "100 %" : String(v)));
  }

  const bars = [];
  points.forEach((p, i) => {
    const cx = m.l + slot * i + slot / 2;
    const x = cx - bw / 2;
    let node = null;
    if (p.value != null) {
      if (p.value <= 0) {
        node = el("rect", { class: "stub", x, y: y(0) - 2, width: bw, height: 2, rx: 1 });
      } else {
        const top = y(p.value);
        node = el("path", { class: "bar" + (p.value >= 100 ? " full" : ""), d: barPath(x, top, bw, y(0) - top, 4) });
      }
      svg.append(node);
    }
    bars.push(node);
    if (!opts.showLabel || opts.showLabel(i)) {
      svg.append(el("text", { class: "x-label" + (p.labelClass ? " " + p.labelClass : ""), x: cx, y: H - 6, "text-anchor": "middle" }, p.label));
    }
  });

  // Durchschnittslinie
  if (opts.avg != null) {
    const ay = y(opts.avg);
    svg.append(el("line", { class: "avg", x1: m.l, x2: W - m.r, y1: ay, y2: ay }));
  }

  // Trefferflächen (größer als die Balken)
  const hits = el("rect", { class: "hit", x: m.l, y: 0, width: pw, height: H });
  svg.append(hits);

  const wrap = document.createElement("div");
  wrap.className = "chart";
  wrap.append(svg);

  let sel = opts.selected ?? null;
  const apply = () => {
    wrap.classList.toggle("has-sel", sel != null);
    bars.forEach((b, i) => b && b.classList.toggle("sel", i === sel));
  };
  apply();

  const indexAt = (evt) => {
    const r = svg.getBoundingClientRect();
    const px = ((evt.clientX - r.left) / r.width) * W - m.l;
    if (px < 0 || px > pw) return null;
    return Math.min(n - 1, Math.max(0, Math.floor(px / slot)));
  };
  let dragging = false;
  const choose = (i, toggle) => {
    if (toggle && i === sel) i = null;
    if (i === sel && !toggle) return;
    sel = i;
    apply();
    opts.onSelect && opts.onSelect(sel);
  };
  svg.addEventListener("pointerdown", (e) => {
    dragging = true;
    choose(indexAt(e), true);
  });
  svg.addEventListener("pointermove", (e) => {
    if (dragging && e.pointerType !== "mouse") {
      const i = indexAt(e);
      if (i != null) choose(i, false);
    }
  });
  const stop = () => (dragging = false);
  svg.addEventListener("pointerup", stop);
  svg.addEventListener("pointercancel", stop);
  svg.addEventListener("pointerleave", stop);
  return wrap;
}
