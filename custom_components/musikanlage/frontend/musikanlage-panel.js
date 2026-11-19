// Panel »Musikanlage«: Dashboard, Routen (Fluss + Seitenpanel), Einstellungen. Aufbau wie das Stromnetz-Panel.
import { dashboardView } from "./dashboard.js";
import { Editor } from "./editor.js";
import { FlowView } from "./flow.js";
import { settingsView } from "./settings.js";
import { STYLE } from "./style.js";
import { MDI, clone, debounce, h, icon } from "./util.js";

const TABS = [["dashboard", "Dashboard"], ["routes", "Routen"], ["settings", "Einstellungen"]];

class MusikanlagePanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    try { this.tab = localStorage.getItem("musikanlage.tab") ?? "dashboard"; } catch { this.tab = "dashboard"; }
    this.dirty = false;
    this.selection = null;
    this.data = null;
    this.draft = null;
    this.errors = [];
    this.validate = debounce(() => this.revalidate(), 500);
    this.refresh = debounce(() => this.reload(), 400);
    this.liveTick = debounce(() => this.updateValues(), 200);
  }

  connectedCallback() {
    this._fit = () => {
      const vh = window.visualViewport?.height ?? window.innerHeight;
      this.style.height = `${Math.max(240, Math.floor(vh - Math.max(0, this.getBoundingClientRect().top)))}px`;
    };
    this._fit();
    requestAnimationFrame(this._fit);
    window.addEventListener("resize", this._fit);
    window.visualViewport?.addEventListener("resize", this._fit);
  }

  disconnectedCallback() {
    window.removeEventListener("resize", this._fit);
    window.visualViewport?.removeEventListener("resize", this._fit);
    this._mic?.stop();
  }

  set hass(hass) {
    const first = !this._hass;
    const old = this._hass;
    this._hass = hass;
    if (first) {
      this.load();
      return;
    }
    // Server-Zustand (Graph, Status) neu holen, wenn sich der Routen-Sensor ändert
    const id = this._sensorId ??= Object.keys(hass.states).find((k) => k.startsWith("sensor.") && hass.states[k].attributes?.graph && k.includes("musikanlage"));
    if (id && old?.states[id] !== hass.states[id]) this.refresh();
    this.liveTick();
  }

  get hass() {
    return this._hass;
  }

  set narrow(v) {
    this.toggleAttribute("narrow", !!v);
  }

  set panel(v) {
    this._panel = v;
  }

  // ── Daten ─────────────────────────────────────────────────────────────────
  async load() {
    this.renderShell();
    try {
      await this.reload(true);
      this.render();
    } catch (err) {
      this.main.replaceChildren(h("p", { class: "empty" }, `Musikanlage konnte nicht geladen werden: ${err.message ?? err}`));
    }
  }

  async reload(force = false) {
    const data = await this.hass.callWS({ type: "musikanlage/get" });
    this.data = data;
    this.players = data.players ?? [];
    this.trackers = data.trackers ?? [];
    if (!this.dirty || force) this.draft = clone(data.topology);
    if (!force) {
      // Fluss und Dashboard zeigen Live-Zustand; Seitenpanel und Einstellungen nicht neu bauen (Eingaben bleiben erhalten)
      if (this.tab === "routes") this.flow?.render();
      if (this.tab === "dashboard") this.renderView();
      this.renderStatus();
    }
  }

  // Topologie mit RINCON-Kennungen für die Anzeige
  get topo() {
    const t = this.draft ?? {};
    for (const i of Object.values(t.interfaces ?? {})) Object.defineProperty(i, "_uid", { value: i.uid || this.uidOf(i.player), enumerable: false, configurable: true });
    return t;
  }

  uidOf(player) {
    return this.players?.find((p) => p.entity_id === player)?.uid ?? null;
  }

  macOf(player) {
    return this.players?.find((p) => p.entity_id === player)?.mac ?? null;
  }

  playerName(player) {
    return this.hass.states[player]?.attributes?.friendly_name ?? player ?? "?";
  }

  zoneName(id) {
    return this.draft?.zones?.[id]?.name || this.data?.names?.[id] || id;
  }

  changed() {
    this.dirty = true;
    this.renderStatus();
    this.validate();
    if (this.tab === "routes") this.flow.render();
  }

  async revalidate() {
    try {
      const res = await this.hass.callWS({ type: "musikanlage/validate", topology: this.draft });
      this.errors = res.errors ?? [];
    } catch (err) {
      this.errors = [String(err.message ?? err)];
    }
    this.renderStatus();
  }

  async save() {
    try {
      const res = await this.hass.callWS({ type: "musikanlage/save", topology: this.draft });
      if (!res.saved) {
        this.errors = res.errors ?? [];
        this.renderStatus();
        this.toast(`Nicht gespeichert: ${this.errors[0] ?? "Fehler"}`);
        return;
      }
      this.dirty = false;
      this.errors = [];
      this.toast("Gespeichert. Die Musikanlage wird neu geladen.");
      setTimeout(() => this.reload(true).then(() => this.render()).catch(() => this.toast("Neu laden fehlgeschlagen")), 1500);
      this.renderStatus();
    } catch (err) {
      this.toast(`Speichern fehlgeschlagen: ${err.message ?? err}`);
    }
  }

  discard() {
    this.draft = clone(this.data.topology);
    this.dirty = false;
    this.errors = [];
    this.render();
  }

  // ── Aktionen ──────────────────────────────────────────────────────────────
  async runQuickAction(q, btn, dry = false) {
    btn?.classList.add("running");
    try {
      const r = await this.hass.callWS({ type: "musikanlage/quick_action", action: q.id, dry_run: dry });
      this.toast(dry ? `${q.name}: ${r.plan.length} Schritte geplant` : `${q.name} ausgeführt`);
      if (dry) this.showPlan(q.name, r);
    } catch (err) {
      this.toast(`${q.name}: ${err.message ?? err}`);
    } finally {
      btn?.classList.remove("running");
      this.refresh();
    }
  }

  async dryRun(id) {
    try {
      const r = await this.hass.callWS({ type: "musikanlage/quick_action", action: id, dry_run: true });
      return h("div", {}, ...r.warnings.map((w) => h("div", { class: "warn-line" }, w)), h("ol", { class: "plan" }, ...r.plan.map((l) => h("li", {}, l))));
    } catch (err) {
      return h("div", { class: "err-line" }, err.message ?? String(err));
    }
  }

  showPlan(title, r) {
    alert(`${title}\n\n${[...r.warnings.map((w) => `⚠ ${w}`), ...r.plan.map((l, i) => `${i + 1}. ${l}`)].join("\n")}`);
  }

  async stopZones(zones) {
    try {
      await this.hass.callService("musikanlage", "stop", { zones });
      this.toast("Ausgeblendet und gestoppt");
    } catch (err) {
      this.toast(`Stoppen fehlgeschlagen: ${err.message ?? err}`);
    }
  }

  async follow(zone, target) {
    try {
      const r = await this.hass.callWS({ type: "musikanlage/follow", zone, target });
      this.toast(r.plan.join(" · "));
    } catch (err) {
      this.toast(err.message ?? String(err));
    }
  }

  select(target) {
    const wasOpen = !!this.selection;
    this.selection = target;
    if (this.tab !== "routes") return;
    this.flow.render();
    this.editor.render(target);
    // Seitenpanel geht auf oder zu: Diagramm an die neue Breite anpassen
    if (wasOpen !== !!target) setTimeout(() => this.flow.fit(), 200); // nach der Breiten-Animation
  }

  // ── Darstellung ───────────────────────────────────────────────────────────
  renderShell() {
    this.shadowRoot.replaceChildren();
    this.saveBtn = h("button", { class: "btn primary", title: "Speichern", onclick: () => this.save() }, icon(MDI.save, 18), h("span", { class: "bl" }, "Speichern"));
    this.discardBtn = h("button", { class: "btn", title: "Verwerfen", onclick: () => this.discard() }, icon(MDI.undo, 18), h("span", { class: "bl" }, "Verwerfen"));
    this.status = h("span", { class: "status" });
    this.tabsEl = h("nav", { class: "tabs" });
    this.tabSelect = h("select", { class: "tab-select", "aria-label": "Ansicht" });
    this.tabSelect.addEventListener("change", () => this.setTab(this.tabSelect.value));
    this.main = h("main", {}, h("p", { class: "empty" }, "Lade …"));
    this.toastEl = h("div", { class: "toast" });
    const menuBtn = h("button", { class: "icon-btn menu-btn", "aria-label": "Seitenleiste", onclick: () => this.dispatchEvent(new Event("hass-toggle-menu", { bubbles: true, composed: true })) }, icon(MDI.menu));
    this.shadowRoot.append(h("style", {}, STYLE),
      h("header", {}, menuBtn,
        h("div", { class: "brand" }, icon(MDI.speakers, 22), h("span", {}, "Musikanlage")),
        this.tabsEl, this.tabSelect, h("div", { class: "grow" }), this.status, this.discardBtn, this.saveBtn),
      this.main, this.toastEl);
  }

  setTab(t) {
    this.tab = t;
    try { localStorage.setItem("musikanlage.tab", t); } catch { /* ohne Speicher */ }
    this.render();
  }

  render() {
    if (!this.data) return;
    this.tabsEl.replaceChildren(...TABS.map(([k, l]) => h("button", { class: `tab${this.tab === k ? " active" : ""}`, onclick: () => this.setTab(k) }, l)));
    this.tabSelect.replaceChildren(...TABS.map(([k, l]) => h("option", { value: k, selected: this.tab === k }, l)));
    this.renderStatus();
    this.renderView();
  }

  renderStatus() {
    if (!this.saveBtn || !this.data) return;
    this.saveBtn.disabled = !this.dirty || this.errors.length > 0;
    this.discardBtn.hidden = !this.dirty;
    const s = this.data.status;
    this.status.replaceChildren(
      this.errors.length ? h("button", { class: "err", title: this.errors.join("\n"), onclick: () => alert(this.errors.join("\n")) }, `${this.errors.length} Fehler`)
        : s.busy ? h("span", { class: "busy" }, "schaltet …")
        : this.dirty ? h("span", { class: "muted" }, "ungespeichert") : "");
  }

  renderView() {
    if (!this.data) return;
    const body = h("div", { class: `body tab-${this.tab}` });
    this.dash = null;
    if (this.tab === "routes") {
      this.flow ??= new FlowView(this);
      this.editor ??= new Editor(this);
      this.flow.render();
      this.editor.render(this.selection);
      body.append(this.flow.el, this.editor.el);
    } else if (this.tab === "settings") {
      this.editor ??= new Editor(this); // Formular-Bausteine
      body.append(settingsView(this));
    } else {
      this.dash = dashboardView(this);
      body.append(this.dash.el);
    }
    const scroll = this.main.firstChild?.firstChild?.scrollTop;
    this.main.replaceChildren(body);
    if (scroll && this.tab !== "routes" && body.firstChild) body.firstChild.scrollTop = scroll;
  }

  updateValues() {
    if (!this.data) return;
    if (this.tab === "routes") {
      this.flow?.updateValues();
      this.editor?.updateValues();
    }
    this.dash?.update();
  }

  toast(text) {
    this.toastEl.textContent = text;
    this.toastEl.classList.add("show");
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => this.toastEl.classList.remove("show"), 3500);
  }
}

if (!customElements.get("musikanlage-panel")) customElements.define("musikanlage-panel", MusikanlagePanel);
