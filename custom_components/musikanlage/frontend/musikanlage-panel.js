// Sidebar panel "Musikanlage": routing diagram + quick actions.
// Plain web component, no build step. Reads sensor.<...>_route (attribute "graph").

const PRESETS = [
  ["normal", "Normal"],
  ["lauter", "Lauter"],
  ["party", "Party"],
];

class MusikanlagePanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._sel = { zones: new Set(), source: "", input: "", preset: "normal", mic: true };
    this._msg = null;
    this._busy = false;
    this._sig = "";
  }

  set hass(hass) {
    this._hass = hass;
    const st = this._sensor();
    const sig = st ? st.last_updated + JSON.stringify(st.attributes.graph) : "none";
    if (sig !== this._sig) {
      this._sig = sig;
      this._render();
    }
  }

  set panel(panel) {
    this._panel = panel;
  }

  set narrow(n) {
    this._narrow = n;
  }

  _sensor() {
    if (!this._hass) return null;
    return Object.values(this._hass.states).find(
      (s) => s.entity_id.startsWith("sensor.") && s.attributes && s.attributes.graph && s.attributes.options &&
        s.entity_id.includes("musikanlage"),
    );
  }

  async _call(service, dry) {
    const s = this._sel;
    const data = { zones: [...s.zones], preset: s.preset, mic: s.mic };
    if (service !== "stop") data.source = s.source;
    if (s.input && s.source.startsWith("mixer:")) data.input = s.input;
    if (!data.zones.length) return this._flash("Bitte mindestens eine Zone wählen", true);
    if (service !== "stop" && !data.source) return this._flash("Bitte eine Quelle wählen", true);
    if (dry) service = "plan";
    if (service === "stop") {
      delete data.preset;
      delete data.mic;
    }
    this._busy = true;
    this._render();
    try {
      const res = await this._hass.callService("musikanlage", service, data, undefined, false, true);
      const r = res && res.response ? res.response : {};
      this._msg = {
        error: false,
        title: dry ? "Geplanter Ablauf (nichts geschaltet)" : "Ausgeführt",
        lines: [...(r.warnings || []).map((w) => "⚠ " + w), ...(r.plan || [])],
      };
    } catch (e) {
      this._msg = { error: true, title: "Abgelehnt", lines: [e.message || String(e)] };
    }
    this._busy = false;
    this._render();
  }

  _flash(text, error) {
    this._msg = { error, title: text, lines: [] };
    this._render();
  }

  // ------------------------------------------------------------ diagram
  _diagram(graph) {
    const cols = { mixer: [], interface: [], radio: [], zone: [] };
    for (const n of graph.nodes) (cols[n.type] || (cols[n.type] = [])).push(n);
    const left = [...cols.mixer, ...cols.radio];
    const colX = [20, 250, 480];
    const W = 200, H = 54, GAP = 18;
    const pos = {};
    const place = (list, x) => list.forEach((n, i) => (pos[n.id] = { x, y: 20 + i * (H + GAP) }));
    place(left, colX[0]);
    place(cols.interface, colX[1]);
    place(cols.zone, colX[2]);
    const rows = Math.max(left.length, cols.interface.length, cols.zone.length, 1);
    const height = 40 + rows * (H + GAP);
    const label = (n) => {
      const id = n.id.split(":").slice(1).join(":") || n.id;
      if (n.type === "mixer") return [id, "Mixer"];
      if (n.type === "radio") return ["Webradio", "Sonos-Stream"];
      if (n.type === "interface")
        return [id, `${n.kind === "hdmi" ? "HDMI" : "Line-In"} · Latenz ${n.latency === "low" ? "niedrig" : "75 ms"}`];
      const vol = Math.round((n.volume || 0) * 100);
      return [id, `${n.playing ? "spielt" : "pausiert"} · Vol ${vol}${n.wireless ? " · WLAN" : ""}`];
    };
    const edges = graph.edges
      .filter((e) => pos[e.from] && pos[e.to])
      .map((e) => {
        const a = pos[e.from], b = pos[e.to];
        const x1 = a.x + W, y1 = a.y + H / 2, x2 = b.x, y2 = b.y + H / 2, mx = (x1 + x2) / 2;
        return `<path d="M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}" class="edge ${e.active ? "on" : ""}"/>`;
      })
      .join("");
    const nodes = Object.entries(pos)
      .map(([id, p]) => {
        const n = graph.nodes.find((x) => x.id === id);
        const [t, sub] = label(n);
        const active = n.type === "zone" ? n.playing : graph.edges.some((e) => e.active && (e.from === id || e.to === id));
        return `<g class="node ${n.type} ${active ? "on" : ""}">
          <rect x="${p.x}" y="${p.y}" width="${W}" height="${H}" rx="10"/>
          <text x="${p.x + 12}" y="${p.y + 22}" class="t">${esc(t)}</text>
          <text x="${p.x + 12}" y="${p.y + 41}" class="s">${esc(sub)}</text></g>`;
      })
      .join("");
    return `<svg viewBox="0 0 700 ${height}" role="img" aria-label="Audio-Routing">${edges}${nodes}</svg>`;
  }

  // ------------------------------------------------------------ render
  _render() {
    const st = this._sensor();
    const root = this.shadowRoot;
    if (!st) {
      root.innerHTML = `<style>${CSS}</style><div class="wrap"><h1>Musikanlage</h1>
        <p class="muted">Keine Musikanlage-Instanz gefunden.</p></div>`;
      return;
    }
    const a = st.attributes;
    const o = a.options;
    const s = this._sel;
    const sources = [
      ...o.interfaces.filter((i) => i.mixer).map((i) => [`mixer:${i.id}`, `Mixer ${i.mixer} über ${i.id}`]),
      ...o.favorites.map((f) => [`radio:${f}`, `Radio: ${f}`]),
    ];
    const iface = o.interfaces.find((i) => `mixer:${i.id}` === s.source);
    const inputs = iface ? o.mixer_inputs[iface.mixer] || [] : [];
    if (iface && !inputs.includes(s.input)) s.input = inputs[0] || "";

    root.innerHTML = `<style>${CSS}</style>
      <div class="wrap">
        <header><h1>Musikanlage</h1>
          <span class="state ${st.state}">${{ idle: "bereit", transition: "schaltet …", error: "Fehler" }[st.state] || st.state}</span></header>
        ${a.last_error ? `<div class="msg err"><b>Letzter Fehler</b><div>${esc(a.last_error)}</div></div>` : ""}
        <section class="card"><h2>Aktuelle Verschaltung</h2>${this._diagram(a.graph)}</section>
        <section class="card"><h2>Schnellaktion</h2>
          <div class="row"><label>Zonen</label><div class="chips">
            ${o.zones.map((z) => `<button class="chip ${s.zones.has(z.id) ? "sel" : ""}" data-zone="${z.id}">${esc(z.id)}${z.wireless ? " (WLAN)" : ""}</button>`).join("")}
          </div></div>
          <div class="row"><label for="src">Quelle</label>
            <select id="src"><option value="">– wählen –</option>
              ${sources.map(([v, l]) => `<option value="${esc(v)}" ${v === s.source ? "selected" : ""}>${esc(l)}</option>`).join("")}
            </select></div>
          ${inputs.length ? `<div class="row"><label for="inp">Mixer-Eingang</label><select id="inp">
              ${inputs.map((i) => `<option ${i === s.input ? "selected" : ""}>${esc(i)}</option>`).join("")}</select></div>` : ""}
          <div class="row"><label>Lautstärke</label><div class="chips">
            ${PRESETS.map(([v, l]) => `<button class="chip ${s.preset === v ? "sel" : ""}" data-preset="${v}">${l}</button>`).join("")}
          </div></div>
          ${iface ? `<div class="row"><label for="mic">Mikrofon</label><input id="mic" type="checkbox" ${s.mic ? "checked" : ""}></div>` : ""}
          <div class="actions">
            <button class="btn" id="dry" ${this._busy ? "disabled" : ""}>Ablauf anzeigen</button>
            <button class="btn primary" id="go" ${this._busy || st.state === "transition" ? "disabled" : ""}>Schalten</button>
            <button class="btn" id="stop" ${this._busy ? "disabled" : ""}>Ausblenden &amp; stoppen</button>
          </div>
          ${this._msg ? `<div class="msg ${this._msg.error ? "err" : ""}"><b>${esc(this._msg.title)}</b>
            ${this._msg.lines.length ? `<ol>${this._msg.lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ol>` : ""}</div>` : ""}
        </section>
        ${(a.guard_events || []).length ? `<section class="card"><h2>Lautstärke-Wächter</h2><ul>
          ${a.guard_events.map((g) => `<li>${esc(g)}</li>`).join("")}</ul></section>` : ""}
        ${(a.last_plan || []).length ? `<section class="card"><h2>Letzter Ablauf</h2><ol class="muted">
          ${a.last_plan.map((l) => `<li>${esc(l)}</li>`).join("")}</ol></section>` : ""}
      </div>`;

    root.querySelectorAll("[data-zone]").forEach((b) =>
      b.addEventListener("click", () => {
        const z = b.dataset.zone;
        s.zones.has(z) ? s.zones.delete(z) : s.zones.add(z);
        this._render();
      }),
    );
    root.querySelectorAll("[data-preset]").forEach((b) =>
      b.addEventListener("click", () => {
        s.preset = b.dataset.preset;
        this._render();
      }),
    );
    const on = (id, ev, fn) => root.getElementById(id)?.addEventListener(ev, fn);
    on("src", "change", (e) => {
      s.source = e.target.value;
      this._render();
    });
    on("inp", "change", (e) => (s.input = e.target.value));
    on("mic", "change", (e) => (s.mic = e.target.checked));
    on("dry", "click", () => this._call("route", true));
    on("go", "click", () => this._call("route", false));
    on("stop", "click", () => this._call("stop", false));
  }
}

const esc = (v) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const CSS = `
  :host { display:block; background: var(--primary-background-color); color: var(--primary-text-color);
          min-height:100vh; font-family: var(--paper-font-body1_-_font-family, system-ui, sans-serif); }
  .wrap { max-width: 980px; margin: 0 auto; padding: 16px; box-sizing: border-box; }
  header { display:flex; align-items:center; gap:12px; justify-content:space-between; }
  h1 { font-size: 24px; font-weight: 500; margin: 8px 0 16px; }
  h2 { font-size: 16px; font-weight: 500; margin: 0 0 12px; }
  .card { background: var(--card-background-color); border-radius: 12px; padding: 16px; margin-bottom: 16px;
          box-shadow: var(--ha-card-box-shadow, 0 1px 3px rgba(0,0,0,.15)); }
  .state { padding: 4px 10px; border-radius: 999px; font-size: 13px; background: var(--secondary-background-color); }
  .state.transition { background: var(--warning-color); color: #000; }
  .state.error { background: var(--error-color); color: #fff; }
  .row { display:flex; align-items:center; gap:12px; margin: 10px 0; flex-wrap: wrap; }
  .row > label { width: 120px; color: var(--secondary-text-color); font-size: 14px; }
  select { min-width: 220px; max-width: 100%; padding: 8px; border-radius: 8px; font: inherit;
           background: var(--secondary-background-color); color: var(--primary-text-color); border: 1px solid var(--divider-color); }
  .chips { display:flex; gap:8px; flex-wrap: wrap; }
  .chip { border: 1px solid var(--divider-color); background: transparent; color: var(--primary-text-color);
          border-radius: 999px; padding: 6px 14px; font: inherit; cursor: pointer; }
  .chip.sel { background: var(--primary-color); border-color: var(--primary-color); color: var(--text-primary-color, #fff); }
  .actions { display:flex; gap:8px; flex-wrap: wrap; margin-top: 14px; }
  .btn { padding: 9px 16px; border-radius: 8px; border: 1px solid var(--divider-color); background: transparent;
         color: var(--primary-text-color); font: inherit; cursor: pointer; }
  .btn.primary { background: var(--primary-color); border-color: var(--primary-color); color: var(--text-primary-color, #fff); }
  .btn:disabled { opacity: .5; cursor: default; }
  .msg { margin-top: 14px; padding: 10px 12px; border-radius: 8px; background: var(--secondary-background-color); font-size: 14px; }
  .msg.err { border-left: 4px solid var(--error-color); }
  .muted { color: var(--secondary-text-color); font-size: 14px; }
  ol, ul { margin: 6px 0 0; padding-left: 20px; }
  svg { width: 100%; height: auto; }
  .edge { fill: none; stroke: var(--divider-color); stroke-width: 2; stroke-dasharray: 4 4; }
  .edge.on { stroke: var(--primary-color); stroke-width: 3; stroke-dasharray: none; }
  .node rect { fill: var(--secondary-background-color); stroke: var(--divider-color); }
  .node.on rect { stroke: var(--primary-color); stroke-width: 2; }
  .node .t { fill: var(--primary-text-color); font-size: 14px; font-weight: 500; }
  .node .s { fill: var(--secondary-text-color); font-size: 12px; }
  @media (max-width: 600px) { .row > label { width: 100%; } select { width: 100%; } }
`;

customElements.define("musikanlage-panel", MusikanlagePanel);
