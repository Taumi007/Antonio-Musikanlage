// Seitenpanel: Einstellungen des gewählten Knotens (Zone, Eingang, Mixer, Webradio)
import { MDI, PRESETS, describeSource, h, icon, pct } from "./util.js";

export class Editor {
  constructor(panel) {
    this.p = panel;
    this.el = h("aside", { class: "drawer" });
    this.live = [];
  }

  get d() {
    return this.p.draft;
  }

  render(target) {
    this.live = [];
    if (!target) {
      this.el.replaceChildren();
      this.el.classList.remove("open");
      return;
    }
    const body = { zone: () => this.zone(target.id), interface: () => this.iface(target.id),
                   mixer: () => this.mixer(target.id), radio: () => this.radio() }[target.type]?.();
    if (!body) {
      this.p.select(null);
      return;
    }
    const crumb = { zone: "Zone", interface: "Eingang", mixer: "Mixer", radio: "Webradio" }[target.type];
    this.el.classList.add("open");
    this.el.replaceChildren(
      h("div", { class: "dnav" },
        h("div", { class: "crumbs" }, `${crumb} › ${target.id}`),
        h("button", { class: "icon-btn", "aria-label": "Schließen", onclick: () => this.p.select(null) }, icon(MDI.close))),
      body);
    this.updateValues();
  }

  updateValues() {
    for (const l of this.live) l();
  }

  // ── Bausteine ──────────────────────────────────────────────────────────────
  field(label, input, hint) {
    return h("label", { class: "field" }, h("span", { class: "flabel" }, label), input, hint ? h("span", { class: "hint" }, hint) : null);
  }

  text(label, obj, key, { placeholder, hint, list } = {}) {
    const inp = h("input", { value: obj[key] ?? "", placeholder, list });
    inp.addEventListener("change", () => {
      const v = inp.value.trim();
      if (v) obj[key] = v;
      else delete obj[key];
      this.p.changed();
    });
    return this.field(label, inp, hint);
  }

  // Zahl; scale 100 zeigt 0..1 als Prozent
  number(label, obj, key, { min, max, step = 1, scale = 1, hint, placeholder } = {}) {
    const cur = obj[key];
    const inp = h("input", { type: "number", min, max, step, placeholder, value: cur === undefined || cur === null ? "" : String(Math.round(cur * scale * 100) / 100) });
    inp.addEventListener("change", () => {
      if (inp.value === "") delete obj[key];
      else obj[key] = Number(inp.value) / scale;
      this.p.changed();
    });
    return this.field(label, inp, hint);
  }

  select(label, obj, key, options, { hint, onchange } = {}) {
    const sel = h("select", {}, ...options.map(([v, l]) => h("option", { value: v ?? "", selected: (obj[key] ?? "") === (v ?? "") }, l)));
    sel.addEventListener("change", () => {
      if (sel.value === "") delete obj[key];
      else obj[key] = sel.value;
      this.p.changed();
      onchange?.(sel.value);
    });
    return this.field(label, sel, hint);
  }

  check(label, obj, key) {
    const inp = h("input", { type: "checkbox", checked: !!obj[key] });
    inp.addEventListener("change", () => { obj[key] = inp.checked; this.p.changed(); });
    return h("label", { class: "field check" }, inp, h("span", {}, label));
  }

  segment(label, obj, key, options) {
    const wrap = h("div", { class: "segment" });
    const draw = () => wrap.replaceChildren(...options.map(([v, l]) => h("button", {
      class: obj[key] === v ? "active" : "", "aria-pressed": obj[key] === v ? "true" : "false",
      onclick: () => { obj[key] = v; this.p.changed(); draw(); },
    }, l)));
    draw();
    return this.field(label, wrap);
  }

  removeBtn(label, fn) {
    return h("div", { class: "row end" }, h("button", { class: "chip danger", onclick: () => { if (confirm(`${label}?`)) fn(); } }, icon(MDI.del, 16), ` ${label}`));
  }

  // ── Zone ──────────────────────────────────────────────────────────────────
  zone(id) {
    const z = this.d.zones?.[id];
    if (!z) return null;
    const p = this.p;
    z.radio_volume ??= {};
    z.mixer_volume ??= {};
    const big = h("span", { class: "big" });
    const srcLine = h("div", { class: "muted small" });
    const slider = h("input", { type: "range", min: 0, max: 100, step: 1, class: "grow" });
    slider.addEventListener("change", () => p.hass.callService("media_player", "volume_set", { entity_id: z.player, volume_level: Number(slider.value) / 100 }));
    this.live.push(() => {
      const st = p.hass.states[z.player];
      const v = st?.attributes?.volume_level;
      big.textContent = pct(v);
      if (this.p.shadowRoot.activeElement !== slider) slider.value = Math.round((v ?? 0) * 100);
      srcLine.textContent = st ? `${st.state === "playing" ? "spielt" : st.state} · ${describeSource(st, p.topo)}` : "nicht verfügbar";
    });
    const mixers = Object.keys(this.d.mixers ?? {});
    const areas = [...new Set(Object.values(this.d.zones ?? {}).map((x) => x.area).filter(Boolean))];
    return h("div", { class: "form" },
      h("div", {}, h("div", { class: "dtitle" }, p.zoneName(id)), h("div", { class: "muted" }, `${z.player} · ${p.uidOf(z.player) ?? "?"}`)),
      h("div", { class: "box" },
        h("div", { class: "valuebox" }, big, h("button", { class: "chip", onclick: () => p.stopZones([id]) }, icon(MDI.stop, 16), " Ausblenden & stoppen")),
        srcLine,
        h("div", { class: "row" }, h("span", { class: "flabel" }, "Live"), slider),
        h("div", { class: "hint" }, "Live-Regler wirkt sofort am Lautsprecher, ohne Ablauf. Für Quellwechsel die Schnellaktionen verwenden.")),
      h("div", { class: "grid2" },
        this.text("Anzeigename", z, "name", { placeholder: id }),
        this.text("Bereich", z, "area", { placeholder: "z. B. Restaurant", list: "ma-areas" })),
      h("datalist", { id: "ma-areas" }, ...areas.map((a) => h("option", { value: a }))),
      this.select("Sonos-Player", z, "player", p.players.map((pl) => [pl.entity_id, `${pl.name} (${pl.entity_id})`])),
      this.check("WLAN-Lautsprecher (höhere Latenz, nicht bei Mikrofon)", z, "wireless"),
      h("div", { class: "sec-title" }, "Webradio-Lautstärke (%)"),
      h("div", { class: "grid3" }, ...PRESETS.map(([k, l]) => this.number(l, z.radio_volume, k, { min: 0, max: 100, scale: 100 }))),
      mixers.length ? h("div", { class: "sec-title" }, "Lautstärke bei Mixer-Quelle (%)") : null,
      mixers.length ? h("div", { class: "grid3" }, ...mixers.map((m) => this.number(`Mixer ${m}`, z.mixer_volume, m, { min: 0, max: 100, scale: 100 }))) : null,
      this.followAp(id, z),
      this.removeBtn("Zone entfernen", () => {
        delete this.d.zones[id];
        for (const q of this.d.quick_actions ?? []) q.zones = (q.zones ?? []).filter((x) => x !== id);
        p.select(null);
        p.changed();
      }));
  }

  followAp(id, z) {
    const p = this.p;
    const on = !!z.follow_ap;
    const det = h("details", { open: on },
      h("summary", {}, "Folgt dem WLAN-Access-Point (UniFi)"));
    if (!on) {
      det.append(h("p", { class: "hint" }, "Für tragbare Lautsprecher: Sobald der Lautsprecher an einem anderen Access Point hängt, tritt er der Gruppe der zugeordneten Zone bei."),
        h("button", { class: "chip", onclick: () => { z.follow_ap = { tracker: "", auto: true, aps: {} }; p.changed(); this.render({ type: "zone", id }); } }, icon(MDI.wifi, 16), " Einrichten"));
      return det;
    }
    const fa = z.follow_ap;
    fa.aps ??= {};
    const clients = p.trackers.filter((t) => !t.is_ap);
    const aps = p.trackers.filter((t) => t.is_ap);
    const zones = Object.keys(this.d.zones ?? {}).filter((x) => x !== id);
    const info = p.data.follow_ap?.find((f) => f.zone === id);
    const rows = h("div", { class: "box" });
    const drawRows = () => rows.replaceChildren(
      h("div", { class: "flabel" }, "Access Point → Zone, der beigetreten wird"),
      ...Object.entries(fa.aps).map(([mac, target]) => h("div", { class: "row" },
        h("span", { class: "grow" }, aps.find((a) => a.mac === mac)?.name ?? mac),
        (() => {
          const sel = h("select", {}, ...zones.map((x) => h("option", { value: x, selected: x === target }, p.zoneName(x))));
          sel.addEventListener("change", () => { fa.aps[mac] = sel.value; p.changed(); });
          return sel;
        })(),
        h("button", { class: "icon-btn small", "aria-label": "Entfernen", onclick: () => { delete fa.aps[mac]; p.changed(); drawRows(); } }, icon(MDI.del, 16)))),
      (() => {
        const free = aps.filter((a) => !(a.mac in fa.aps));
        if (!free.length || !zones.length) return null;
        const sel = h("select", {}, h("option", { value: "" }, "+ Access Point hinzufügen …"), ...free.map((a) => h("option", { value: a.mac }, a.name ?? a.mac)));
        sel.addEventListener("change", () => { if (sel.value) { fa.aps[sel.value] = zones[0]; p.changed(); drawRows(); } });
        return sel;
      })());
    drawRows();
    det.append(
      this.select("UniFi-Client des Lautsprechers", fa, "tracker", [["", "— wählen —"], ...clients.map((t) => [t.entity_id, `${t.name ?? t.entity_id}${t.ap_mac ? "" : " (nicht im WLAN)"}`])],
        { hint: "Der Lautsprecher muss in der UniFi-Integration als Client erfasst sein." }),
      info ? h("div", { class: "hint" }, info.connected
        ? `Aktuell: ${info.ap_name ?? info.ap_mac ?? "unbekannter AP"}${info.target ? ` → ${p.zoneName(info.target)}` : " (keine Zuordnung)"}`
        : "Aktuell nicht verbunden") : null,
      this.check("Automatisch beitreten, wenn der Access Point wechselt", fa, "auto"),
      rows,
      info?.target ? h("button", { class: "chip", onclick: () => p.follow(id, info.target) }, icon(MDI.wifi, 16), ` Jetzt ${p.zoneName(info.target)} beitreten`) : null,
      h("button", { class: "chip danger", onclick: () => { delete z.follow_ap; p.changed(); this.render({ type: "zone", id }); } }, "Folgen ausschalten"));
    return det;
  }

  // ── Eingang ───────────────────────────────────────────────────────────────
  iface(id) {
    const i = this.d.interfaces?.[id];
    if (!i) return null;
    const p = this.p;
    return h("div", { class: "form" },
      h("div", {}, h("div", { class: "dtitle" }, id), h("div", { class: "muted" }, i.kind === "hdmi" ? "HDMI-Eingang: nur das eigene Gerät spielt ihn, andere treten seiner Gruppe bei" : "Analog-Eingang: kann von jedem Sonos abgespielt werden (75 ms Puffer)")),
      this.segment("Art", i, "kind", [["hdmi", "HDMI / Toslink"], ["line_in", "Line-In (Cinch)"]]),
      this.select("Gerät mit dem Eingang", i, "player", p.players.map((pl) => [pl.entity_id, `${pl.name} (${pl.entity_id})`])),
      this.select("Angeschlossener Mixer", i, "mixer", [["", "— keiner —"], ...Object.keys(this.d.mixers ?? {}).map((m) => [m, `Mixer ${m}`])]),
      this.removeBtn("Eingang entfernen", () => {
        delete this.d.interfaces[id];
        for (const q of this.d.quick_actions ?? []) if (q.source === `mixer:${id}`) q.source = "none";
        p.select(null);
        p.changed();
      }));
  }

  // ── Mixer ─────────────────────────────────────────────────────────────────
  mixer(id) {
    const m = this.d.mixers?.[id];
    if (!m) return null;
    const p = this.p;
    m.levels ??= {};
    m.inputs ??= {};
    const levels = p.data.graph.nodes.find((n) => n.id === `mixer:${id}`)?.levels_db ?? {};
    const inputs = h("div", { class: "box" });
    const drawInputs = () => inputs.replaceChildren(
      h("div", { class: "flabel" }, "Eingänge (Name → Kanäle, Stereo z. B. 5,6)"),
      ...Object.entries(m.inputs).map(([name, ch]) => {
        const inp = h("input", { value: (ch ?? []).join(","), style: { width: "110px" } });
        inp.addEventListener("change", () => { m.inputs[name] = inp.value.split(/[ ,;]+/).filter(Boolean).map(Number); p.changed(); });
        const cur = (ch ?? []).map((c) => levels[c]).filter((v) => v !== undefined);
        return h("div", { class: "row" }, h("b", { class: "grow" }, name),
          h("span", { class: "muted small" }, cur.length ? `${Math.round(Math.max(...cur))} dB` : ""),
          inp,
          h("button", { class: "icon-btn small", "aria-label": `${name} entfernen`, onclick: () => { delete m.inputs[name]; p.changed(); drawInputs(); } }, icon(MDI.del, 16)));
      }),
      h("button", { class: "chip dashed", onclick: () => {
        const name = prompt("Name des Eingangs (z. B. pc)");
        if (!name) return;
        m.inputs[name] = [];
        p.changed();
        drawInputs();
      } }, "+ Eingang"));
    drawInputs();
    return h("div", { class: "form" },
      h("div", {}, h("div", { class: "dtitle" }, `Mixer ${id}`), h("div", { class: "muted" }, m.type === "virtual" ? "Virtuell (zum Testen ohne Hardware)" : "Behringer X Air über die HA-Integration")),
      this.segment("Anbindung", m, "type", [["behringer_entities", "Behringer-Integration"], ["virtual", "Virtuell"]]),
      m.type === "behringer_entities" ? this.text("Entity-Präfix", m, "prefix", { placeholder: "restaurant_mixer", hint: "number.<präfix>_channel_<n>_fader" }) : null,
      inputs,
      h("div", { class: "grid2" },
        this.number("Mikrofon-Kanal", m, "mic_channel", { min: 1, max: 16 }),
        this.number("Mikrofon-Pegel (dB)", m, "mic_db", { min: -90, max: 10, step: 0.5 })),
      h("div", { class: "sec-title" }, "Musikpegel am Mixer (dB)"),
      h("div", { class: "grid3" }, ...PRESETS.map(([k, l]) => this.number(l, m.levels, k, { min: -90, max: 10, step: 0.5 }))),
      h("p", { class: "hint" }, "Ducking per Sidechain bleibt im Mixer. Die Integration fasst die Dynamics nicht an."),
      this.removeBtn("Mixer entfernen", () => {
        delete this.d.mixers[id];
        for (const i of Object.values(this.d.interfaces ?? {})) if (i.mixer === id) delete i.mixer;
        p.select(null);
        p.changed();
      }));
  }

  // ── Webradio ──────────────────────────────────────────────────────────────
  radio() {
    const p = this.p;
    this.d.favorites ??= {};
    const fav = this.d.favorites;
    const list = h("div", { class: "box" });
    const draw = () => list.replaceChildren(
      h("div", { class: "flabel" }, "Favoriten (Name → Sonos-Favorit, z. B. FV:2/36)"),
      ...Object.entries(fav).map(([name, fv]) => {
        const inp = h("input", { value: fv, style: { width: "110px" } });
        inp.addEventListener("change", () => { fav[name] = inp.value.trim(); p.changed(); });
        return h("div", { class: "row" }, h("b", { class: "grow" }, name), inp,
          h("button", { class: "icon-btn small", "aria-label": `${name} entfernen`, onclick: () => { delete fav[name]; p.changed(); draw(); } }, icon(MDI.del, 16)));
      }),
      h("button", { class: "chip dashed", onclick: () => {
        const name = prompt("Name des Senders");
        if (!name) return;
        const fv = prompt("Sonos-Favoriten-ID (FV:2/…)");
        if (!fv) return;
        fav[name] = fv;
        p.changed();
        draw();
      } }, "+ Sender"));
    draw();
    return h("div", { class: "form" },
      h("div", {}, h("div", { class: "dtitle" }, "Webradio"), h("div", { class: "muted" }, "Sonos-Favoriten. Startet immer bei Lautstärke 0 und blendet auf das Preset der Zone hoch.")),
      list,
      this.number("Wächter: Höchstlautstärke für Nicht-Mixer-Quellen (%)", this.d, "max_radio_volume", { min: 0, max: 100, scale: 100,
        hint: "Startet etwas außerhalb der Musikanlage lauter, wird sofort auf Normal heruntergeregelt." }));
  }
}
