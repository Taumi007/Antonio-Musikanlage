// Flussdiagramm: Quellen (Mixer, Webradio) → Eingänge (HDMI, Line-In) → Zonen (Sonos)
import { MDI, describeSource, h, icon, pct, svg } from "./util.js";

const W = 240;
const H = 58;
const PITCH = 74;
const COLS = [0, 320, 640];
const TOP = 34;

export class FlowView {
  constructor(panel) {
    this.p = panel;
    this.view = { s: 1, x: 40, y: 30 };
    this.el = h("div", { class: "flow" });
    this.stage = h("div", { class: "stage" });
    this.edges = svg("svg", { class: "edges" });
    this.stage.append(this.edges);
    this.el.append(this.stage, this.controls());
    this.bindPanZoom();
    this.fitted = false;
    this.live = [];
  }

  controls() {
    const b = (path, label, fn) => h("button", { class: "icon-btn", title: label, "aria-label": label, onclick: fn }, icon(path));
    const lg = (color, label) => h("span", {}, h("i", { style: { background: color } }), label);
    return h("div", { class: "flow-controls" },
      b(MDI.plus, "Vergrößern", () => this.zoomBy(1.2)),
      b(MDI.minus, "Verkleinern", () => this.zoomBy(1 / 1.2)),
      b(MDI.fit, "Einpassen", () => this.fit()),
      h("span", { class: "legend" }, lg("var(--ma-hdmi)", "HDMI"), lg("var(--ma-line)", "Line-In"), lg("var(--ma-radio)", "Webradio")));
  }

  // Knoten in drei Spalten
  items() {
    const p = this.p, topo = p.topo, g = p.data.graph;
    const sources = [
      ...Object.entries(topo.mixers ?? {}).map(([id, m]) => ({ key: `mixer:${id}`, col: 0, type: "mixer", id, m })),
    ];
    if (Object.keys(topo.favorites ?? {}).length || g.nodes.some((n) => n.id === "radio"))
      sources.push({ key: "radio", col: 0, type: "radio", id: "radio" });
    const ifaces = Object.entries(topo.interfaces ?? {}).map(([id, i]) => ({ key: `iface:${id}`, col: 1, type: "interface", id, i }));
    const zones = Object.entries(topo.zones ?? {}).map(([id, z]) => ({ key: `zone:${id}`, col: 2, type: "zone", id, z }));
    const rows = Math.max(sources.length, ifaces.length, zones.length, 1);
    const place = (list, col) => {
      const off = ((rows - list.length) * PITCH) / 2;
      list.forEach((it, i) => { it.x = COLS[col]; it.y = TOP + off + i * PITCH; });
    };
    place(sources, 0);
    place(ifaces, 1);
    place(zones, 2);
    return { all: [...sources, ...ifaces, ...zones], rows };
  }

  render() {
    const { all, rows } = this.items();
    this.byKey = new Map(all.map((it) => [it.key, it]));
    this.live = [];
    this.stage.replaceChildren(this.edges);
    this.edges.replaceChildren();
    [["Quellen", 0], ["Eingänge", 1], ["Zonen", 2]].forEach(([t, c]) =>
      this.stage.append(h("div", { class: "col-title", style: { left: `${COLS[c] + 4}px`, top: "4px" } }, t)));
    // Kanten: alle bekannten Verbindungen (Mixer → Eingang) gedämpft, aktive Pfade farbig und animiert
    const graph = this.p.data.graph;
    const active = new Set(graph.edges.filter((e) => e.active).map((e) => `${e.from}>${e.to}`));
    for (const [iid, i] of Object.entries(this.p.topo.interfaces ?? {})) {
      if (i.mixer) this.edge(`mixer:${i.mixer}`, `iface:${iid}`, active.has(`mixer:${i.mixer}>iface:${iid}`), this.kindColor(i.kind));
    }
    for (const e of graph.edges) {
      if (!e.to.startsWith("zone:")) continue;
      const from = e.from === "radio" ? "radio" : e.from;
      const iface = from.startsWith("iface:") ? this.p.topo.interfaces?.[from.slice(6)] : null;
      this.edge(from, e.to, true, from === "radio" ? "var(--ma-radio)" : this.kindColor(iface?.kind));
    }
    for (const it of all) this.stage.append(this.card(it));
    const w = COLS[2] + W + 40, hh = TOP + rows * PITCH + 20;
    this.edges.setAttribute("width", w);
    this.edges.setAttribute("height", hh);
    this.size = { w, h: hh };
    this.applyView();
    this.updateValues();
    if (!this.fitted && this.el.isConnected) {
      this.fitted = true;
      requestAnimationFrame(() => this.fit());
    }
  }

  kindColor(kind) {
    return kind === "hdmi" ? "var(--ma-hdmi)" : kind === "line_in" ? "var(--ma-line)" : "var(--ma-neutral)";
  }

  edge(fromKey, toKey, on, color) {
    const a = this.byKey.get(fromKey), b = this.byKey.get(toKey);
    if (!a || !b) return;
    const x1 = a.x + W, y1 = a.y + H / 2, x2 = b.x, y2 = b.y + H / 2;
    const mx = x1 + (x2 - x1) / 2;
    this.edges.append(svg("path", {
      d: `M ${x1} ${y1} H ${mx} V ${y2} H ${x2}`,
      fill: "none",
      stroke: on ? color : "var(--ma-neutral)",
      "stroke-width": on ? 3 : 1.5,
      "stroke-linejoin": "round",
      "stroke-dasharray": on ? "8 4" : "3 6",
      opacity: on ? 1 : 0.55,
      class: on ? "on" : "",
    }));
  }

  card(it) {
    const p = this.p, sel = p.selection;
    const selected = sel && `${sel.type}:${sel.id}` === `${it.type}:${it.id}`;
    const base = { style: { left: `${it.x}px`, top: `${it.y}px`, width: `${W}px`, height: `${H}px` }, dataset: { key: it.key } };
    let el;
    if (it.type === "mixer") {
      const levels = p.data.graph.nodes.find((n) => n.id === it.key)?.levels_db ?? {};
      const open = Object.values(levels).filter((v) => v > -60).length;
      el = h("div", { ...base, class: "card tinted", style: { ...base.style, "--tint": "var(--ma-mixer)" } },
        h("span", { class: "kicon" }, icon(MDI.mixer, 20)),
        h("div", { class: "txt" }, h("div", { class: "title" }, `Mixer ${it.id}`),
          h("div", { class: "sub" }, `${it.m.type === "virtual" ? "virtuell" : `Behringer · ${it.m.prefix ?? ""}`} · ${open} Kanäle offen`)));
    } else if (it.type === "radio") {
      el = h("div", { ...base, class: "card tinted", style: { ...base.style, "--tint": "var(--ma-radio)" } },
        h("span", { class: "kicon" }, icon(MDI.radio, 20)),
        h("div", { class: "txt" }, h("div", { class: "title" }, "Webradio"),
          h("div", { class: "sub" }, `${Object.keys(p.topo.favorites ?? {}).length} Favoriten`)));
    } else if (it.type === "interface") {
      const player = p.playerName(it.i.player);
      el = h("div", { ...base, class: "card tinted", style: { ...base.style, "--tint": this.kindColor(it.i.kind) } },
        h("span", { class: "kicon" }, icon(it.i.kind === "hdmi" ? MDI.hdmi : MDI.linein, 20)),
        h("div", { class: "txt" }, h("div", { class: "title" }, it.id),
          h("div", { class: "sub" }, `${it.i.kind === "hdmi" ? "HDMI · niedrige Latenz" : "Line-In · 75 ms"} · ${player}`)));
    } else {
      const st = p.hass.states[it.z.player];
      const playing = st?.state === "playing";
      const val = h("span", { class: "val" });
      const bar = h("i");
      const sub = h("div", { class: "sub" });
      this.live.push(() => {
        const s = p.hass.states[it.z.player];
        const v = s?.attributes?.volume_level;
        val.textContent = pct(v);
        bar.style.width = `${Math.round((v ?? 0) * 100)}%`;
        const ap = p.data.follow_ap?.find((f) => f.zone === it.id);
        sub.textContent = [s?.state === "playing" ? describeSource(s, p.topo) : s ? "pausiert" : "nicht verfügbar",
          ap?.ap_name ? `AP ${ap.ap_name}` : null].filter(Boolean).join(" · ");
      });
      el = h("div", { ...base, class: `card zone${playing ? "" : " idle"}${selected ? " selected" : ""}`, style: { ...base.style, "--tint": "var(--ma-accent)" } },
        h("span", { class: "kicon" }, icon(it.z.wireless ? MDI.wifi : MDI.speaker, 20)),
        h("div", { class: "txt" }, h("div", { class: "title" }, p.zoneName(it.id)), sub),
        val, h("span", { class: "vbar" }, bar));
    }
    if (selected) el.classList.add("selected");
    el.addEventListener("click", () => { if (!this.moved) p.select({ type: it.type, id: it.id }); });
    return el;
  }

  updateValues() {
    for (const l of this.live) l();
  }

  applyView() {
    this.stage.style.transform = `translate(${this.view.x}px, ${this.view.y}px) scale(${this.view.s})`;
  }

  zoomBy(f, cx, cy) {
    const r = this.el.getBoundingClientRect();
    cx ??= r.width / 2;
    cy ??= r.height / 2;
    const s = Math.min(Math.max(this.view.s * f, 0.2), 2.5);
    this.view.x = cx - ((cx - this.view.x) * s) / this.view.s;
    this.view.y = cy - ((cy - this.view.y) * s) / this.view.s;
    this.view.s = s;
    this.applyView();
  }

  fit() {
    const r = this.el.getBoundingClientRect();
    if (!r.width || !this.size) return;
    const bottom = 70; // Platz für die Steuerleiste
    this.view.s = Math.min(Math.max(Math.min((r.width - 48) / this.size.w, (r.height - bottom - 24) / this.size.h), 0.2), 1.2);
    this.view.x = (r.width - this.size.w * this.view.s) / 2;
    this.view.y = Math.max(12, (r.height - bottom - this.size.h * this.view.s) / 2);
    this.applyView();
  }

  bindPanZoom() {
    this.el.addEventListener("wheel", (e) => {
      e.preventDefault();
      const r = this.el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey || !e.shiftKey) {
        const step = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
        this.zoomBy(Math.pow(1.0015, -step), e.clientX - r.left, e.clientY - r.top);
      } else {
        this.view.x -= e.deltaY;
        this.applyView();
      }
    }, { passive: false });
    const pts = new Map();
    let pinch = null;
    const rel = (e) => { const r = this.el.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    this.el.addEventListener("pointerdown", (e) => {
      if (e.target.closest(".flow-controls")) return;
      if (!pts.size) this.moved = false;
      pts.set(e.pointerId, rel(e));
      if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        pinch = { d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, m0: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, v0: { ...this.view } };
      }
    }, true);
    this.el.addEventListener("pointermove", (e) => {
      const prev = pts.get(e.pointerId);
      if (!prev) return;
      const cur = rel(e);
      pts.set(e.pointerId, cur);
      if (pinch && pts.size >= 2) {
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y) || 1, m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const s = Math.min(Math.max(pinch.v0.s * (d / pinch.d0), 0.2), 2.5);
        this.view = { s, x: m.x - ((pinch.m0.x - pinch.v0.x) * s) / pinch.v0.s, y: m.y - ((pinch.m0.y - pinch.v0.y) * s) / pinch.v0.s };
        this.moved = true;
        this.applyView();
        return;
      }
      const dx = cur.x - prev.x, dy = cur.y - prev.y;
      if (Math.abs(dx) + Math.abs(dy) > 0) {
        this.view.x += dx;
        this.view.y += dy;
        if (Math.abs(dx) + Math.abs(dy) > 2) this.moved = true;
        this.applyView();
      }
    }, true);
    const end = (e) => {
      pts.delete(e.pointerId);
      if (pts.size < 2) pinch = null;
    };
    this.el.addEventListener("pointerup", end, true);
    this.el.addEventListener("pointercancel", end, true);
  }
}
