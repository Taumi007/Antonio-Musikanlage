// Einstellungen: Schnellaktionen, Geräte, Kalibrierung, Rohdaten
import { ICON_CHOICES, MDI, PRESETS, h, icon, newId, pct, slug } from "./util.js";

const SUBTABS = [["quick", "Schnellaktionen"], ["devices", "Geräte"], ["calibration", "Kalibrierung"], ["raw", "Rohdaten"]];

export function settingsView(p) {
  let sub;
  try { sub = localStorage.getItem("musikanlage.settingstab") ?? "quick"; } catch { sub = p._settingsTab ?? "quick"; }
  const tabs = h("div", { class: "subtabs" }, ...SUBTABS.map(([k, l]) => h("button", {
    class: `chip${sub === k ? " active" : ""}`,
    onclick: () => { p._settingsTab = k; try { localStorage.setItem("musikanlage.settingstab", k); } catch { /* ohne Speicher */ } p.renderView(); },
  }, l)));
  const body = { quick: quickActions, devices, calibration, raw }[sub]?.(p) ?? quickActions(p);
  return h("div", { class: "page" }, tabs, ...[body].flat());
}

// ── Schnellaktionen ─────────────────────────────────────────────────────────
function quickActions(p) {
  const d = p.draft;
  d.quick_actions ??= [];
  const list = d.quick_actions;
  const zones = Object.keys(d.zones ?? {});
  const sources = [["none", "Ausblenden & stoppen"],
    ...Object.entries(d.interfaces ?? {}).filter(([, i]) => i.mixer).map(([id, i]) => [`mixer:${id}`, `Mixer ${i.mixer} über ${id} (${i.kind === "hdmi" ? "HDMI" : "Line-In"})`]),
    ...Object.keys(d.favorites ?? {}).map((f) => [`radio:${f}`, `Webradio ${f}`])];
  const open = p._openQa;
  const rows = list.map((q, idx) => {
    const isOpen = open === q.id;
    const head = h("div", { class: "list-row" },
      icon(MDI[q.icon] ?? MDI.note, 20),
      h("button", { class: "grow", style: { textAlign: "left", background: "none", border: "0", padding: "0" }, onclick: () => { p._openQa = isOpen ? null : q.id; p.renderView(); } },
        h("b", {}, q.name || q.id), " ",
        h("span", { class: "tag" }, q.area || "ohne Bereich"), " ",
        h("span", { class: "muted small" }, `${(q.zones ?? []).map((z) => p.zoneName(z)).join(", ")} · ${sources.find(([v]) => v === q.source)?.[1] ?? q.source}`)),
      h("button", { class: "icon-btn small", "aria-label": "Nach oben", disabled: idx === 0, onclick: () => { list.splice(idx - 1, 0, ...list.splice(idx, 1)); p.changed(); p.renderView(); } }, icon(MDI.up, 16)),
      h("button", { class: "icon-btn small", "aria-label": "Nach unten", disabled: idx === list.length - 1, onclick: () => { list.splice(idx + 1, 0, ...list.splice(idx, 1)); p.changed(); p.renderView(); } }, icon(MDI.down, 16)),
      h("button", { class: "icon-btn small", "aria-label": "Löschen", onclick: () => { if (confirm(`»${q.name}« löschen?`)) { list.splice(idx, 1); p.changed(); p.renderView(); } } }, icon(MDI.del, 16)));
    if (!isOpen) return head;
    return h("div", {}, head, qaForm(p, q, zones, sources));
  });
  return h("section", { class: "card-box full" },
    h("div", { class: "row" }, h("h3", { class: "grow" }, "Schnellaktionen"),
      h("button", { class: "chip", onclick: () => {
        const id = newId("aktion", new Set(list.map((q) => q.id)));
        list.push({ id, name: "Neue Aktion", area: "", icon: "note", zones: zones.slice(0, 1), source: sources[1]?.[0] ?? "none", preset: "normal", mic: false });
        p._openQa = id;
        p.changed();
        p.renderView();
      } }, icon(MDI.plus, 16), " Neue Aktion")),
    h("p", { class: "muted small" }, "Erscheinen im Dashboard im angegebenen Bereich. Jede Aktion läuft über den sicheren Ablauf (Ausblenden, Umschalten mit Gerätebestätigung, Hochfahren)."),
    rows.length ? h("div", {}, ...rows) : h("p", { class: "muted" }, "Noch keine Schnellaktionen."));
}

function qaForm(p, q, zones, sources) {
  const ed = p.editor;
  const zoneChips = h("div", { class: "row wrap" });
  const drawZones = () => zoneChips.replaceChildren(...zones.map((z) => h("button", {
    class: `chip${q.zones.includes(z) ? " active" : ""}`,
    onclick: () => { q.zones = q.zones.includes(z) ? q.zones.filter((x) => x !== z) : [...q.zones, z]; p.changed(); drawZones(); },
  }, p.zoneName(z), p.draft.zones[z]?.wireless ? " (WLAN)" : "")));
  drawZones();
  const iface = q.source?.startsWith("mixer:") ? p.draft.interfaces?.[q.source.slice(6)] : null;
  const inputs = iface?.mixer ? Object.keys(p.draft.mixers?.[iface.mixer]?.inputs ?? {}) : [];
  const dry = h("div");
  return h("div", { class: "box", style: { margin: "4px 0 12px" } },
    h("div", { class: "grid3" },
      ed.text("Name", q, "name"),
      ed.text("Bereich", q, "area", { placeholder: "aus der ersten Zone", list: "ma-qa-areas" }),
      ed.select("Symbol", q, "icon", ICON_CHOICES)),
    h("datalist", { id: "ma-qa-areas" }, ...[...new Set(Object.values(p.draft.zones ?? {}).map((z) => z.area).filter(Boolean))].map((a) => h("option", { value: a }))),
    h("div", { class: "field" }, h("span", { class: "flabel" }, "Zonen"), zoneChips),
    ed.select("Quelle", q, "source", sources, { onchange: () => p.renderView() }),
    inputs.length ? ed.select("Mixer-Eingang", q, "input", [["", "— keiner (nur Mikro) —"], ...inputs.map((i) => [i, i])]) : null,
    q.source !== "none" ? ed.segment("Lautstärke", q, "preset", PRESETS) : null,
    iface ? ed.check("Mikrofon einschalten (WLAN-Zonen werden dann abgelehnt)", q, "mic") : null,
    h("div", { class: "row" },
      h("button", { class: "chip", disabled: p.dirty, title: p.dirty ? "Erst speichern" : "", onclick: async () => {
        const r = await p.dryRun(q.id);
        dry.replaceChildren(r);
      } }, icon(MDI.info, 16), " Ablauf prüfen"),
      p.dirty ? h("span", { class: "muted small" }, "Prüfen und Ausführen erst nach dem Speichern") : null),
    dry);
}

// ── Geräte ───────────────────────────────────────────────────────────────────
function devices(p) {
  const d = p.draft;
  const used = new Set(Object.values(d.zones ?? {}).map((z) => z.player));
  const zoneRows = Object.entries(d.zones ?? {}).map(([id, z]) => {
    const st = p.hass.states[z.player];
    const tr = p.trackers.find((t) => t.mac && p.macOf(z.player) === t.mac);
    const fa = p.data.follow_ap?.find((f) => f.zone === id);
    return h("tr", {},
      h("td", {}, h("button", { class: "chip", onclick: () => { p.tab = "routes"; p.selection = { type: "zone", id }; p.render(); } }, p.zoneName(id))),
      h("td", {}, z.player, h("br"), h("code", {}, p.uidOf(z.player) ?? "?")),
      h("td", {}, st ? `${st.state} · ${pct(st.attributes.volume_level)}` : "nicht verfügbar"),
      h("td", {}, z.wireless ? "WLAN" : "–"),
      h("td", {}, tr ? `${tr.name ?? tr.entity_id}${tr.ap_mac ? ` · AP ${p.trackers.find((a) => a.mac === tr.ap_mac)?.name ?? tr.ap_mac}` : tr.state === "home" ? " · verkabelt" : " · nicht verbunden"}`
        : fa ? `${fa.tracker}` : h("span", { class: "muted" }, "nicht in UniFi")));
  });
  const free = p.players.filter((pl) => !used.has(pl.entity_id));
  return [
    h("section", { class: "card-box full" },
      h("div", { class: "row" }, h("h3", { class: "grow" }, "Zonen"),
        free.length ? (() => {
          const sel = h("select", {}, h("option", { value: "" }, "+ Sonos als Zone hinzufügen …"), ...free.map((pl) => h("option", { value: pl.entity_id }, `${pl.name} (${pl.entity_id})`)));
          sel.addEventListener("change", () => {
            if (!sel.value) return;
            d.zones ??= {};
            const id = newId(slug(sel.value.replace("media_player.", "")), new Set(Object.keys(d.zones)));
            d.zones[id] = { player: sel.value, radio_volume: { normal: 0.1, lauter: 0.15, party: 0.2 }, mixer_volume: {} };
            p.changed();
            p.tab = "routes";
            p.selection = { type: "zone", id };
            p.render();
          });
          return sel;
        })() : null),
      h("table", { class: "dev" }, h("tr", {}, ...["Zone", "Player / RINCON", "Zustand", "Verbindung", "UniFi"].map((t) => h("th", {}, t))), ...zoneRows)),
    h("section", { class: "card-box" },
      h("div", { class: "row" }, h("h3", { class: "grow" }, "Eingänge"),
        h("button", { class: "chip", onclick: () => {
          const name = prompt("Name des Eingangs (z. B. restaurant_hdmi)");
          if (!name) return;
          d.interfaces ??= {};
          const id = newId(slug(name), new Set(Object.keys(d.interfaces)));
          d.interfaces[id] = { player: p.players[0]?.entity_id, kind: "line_in" };
          p.changed();
          p.tab = "routes";
          p.selection = { type: "interface", id };
          p.render();
        } }, icon(MDI.plus, 16), " Eingang")),
      ...Object.entries(d.interfaces ?? {}).map(([id, i]) => h("div", { class: "list-row" },
        icon(i.kind === "hdmi" ? MDI.hdmi : MDI.linein, 18),
        h("div", { class: "grow" }, h("b", {}, id), h("div", { class: "muted small" }, `${i.kind === "hdmi" ? "HDMI" : "Line-In"} · ${p.playerName(i.player)} · ${i.mixer ? `Mixer ${i.mixer}` : "kein Mixer"}`)),
        h("button", { class: "chip", onclick: () => { p.tab = "routes"; p.selection = { type: "interface", id }; p.render(); } }, "Bearbeiten")))),
    h("section", { class: "card-box" },
      h("div", { class: "row" }, h("h3", { class: "grow" }, "Mixer"),
        h("button", { class: "chip", onclick: () => {
          const name = prompt("Name des Mixers (z. B. bar)");
          if (!name) return;
          d.mixers ??= {};
          const id = newId(slug(name), new Set(Object.keys(d.mixers)));
          d.mixers[id] = { type: "behringer_entities", prefix: "", inputs: { pc: [5, 6] }, mic_channel: 1, mic_db: 0, levels: { normal: -24, lauter: -15, party: -6 } };
          p.changed();
          p.tab = "routes";
          p.selection = { type: "mixer", id };
          p.render();
        } }, icon(MDI.plus, 16), " Mixer")),
      ...Object.entries(d.mixers ?? {}).map(([id, m]) => h("div", { class: "list-row" },
        icon(MDI.mixer, 18),
        h("div", { class: "grow" }, h("b", {}, id), h("div", { class: "muted small" }, `${m.type === "virtual" ? "virtuell" : `Behringer · ${m.prefix || "Präfix fehlt"}`} · ${Object.keys(m.inputs ?? {}).length} Eingänge`)),
        h("button", { class: "chip", onclick: () => { p.tab = "routes"; p.selection = { type: "mixer", id }; p.render(); } }, "Bearbeiten")))),
  ];
}

// ── Kalibrierung ─────────────────────────────────────────────────────────────
function calibration(p) {
  const meter = h("i", { style: { width: "0%" } });
  const value = h("span", { class: "big-num" }, "–");
  const peak = h("span", { class: "muted" });
  const status = h("p", { class: "muted small" });
  const results = h("div");
  p._calib ??= [];
  const drawResults = () => results.replaceChildren(...p._calib.map((r, i) => h("div", { class: "list-row" },
    h("b", { class: "grow" }, r.label), h("span", {}, `${r.db.toFixed(1)} dBFS`),
    h("span", { class: "muted small" }, i ? `${(r.db - p._calib[0].db).toFixed(1)} dB zur ersten` : "Referenz"),
    h("button", { class: "icon-btn small", "aria-label": "Entfernen", onclick: () => { p._calib.splice(i, 1); drawResults(); } }, icon(MDI.del, 16)))));
  drawResults();
  let avg = null;
  const start = async () => {
    if (p._mic) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      const ctx = new AudioContext();
      const src = ctx.createMediaStreamSource(stream);
      const an = ctx.createAnalyser();
      an.fftSize = 4096;
      src.connect(an);
      const buf = new Float32Array(an.fftSize);
      let max = -120;
      p._mic = { stream, ctx, stop: () => { stream.getTracks().forEach((t) => t.stop()); ctx.close(); p._mic = null; } };
      const tick = () => {
        if (!p._mic) return;
        an.getFloatTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) sum += v * v;
        const db = 20 * Math.log10(Math.sqrt(sum / buf.length) || 1e-9);
        avg = avg === null ? db : avg * 0.9 + db * 0.1;
        max = Math.max(max, db);
        value.textContent = `${avg.toFixed(1)} dBFS`;
        peak.textContent = `Spitze ${max.toFixed(1)}`;
        meter.style.width = `${Math.min(100, Math.max(0, (avg + 80) * 1.25))}%`;
        requestAnimationFrame(tick);
      };
      tick();
      status.textContent = "Messung läuft. Gerät ruhig halten, gleicher Abstand zum Lautsprecher bei jeder Messung.";
    } catch (err) {
      status.textContent = `Mikrofon nicht verfügbar: ${err.message ?? err}. In der HA-App muss der Mikrofon-Zugriff erlaubt sein, im Browser nur über HTTPS.`;
    }
  };
  return [
    h("section", { class: "card-box" },
      h("h3", {}, "Pegelmesser (Handy-Mikrofon)"),
      h("p", { class: "muted small" }, "Misst relativ (dBFS) über das Mikrofon dieses Geräts, z. B. ein iPhone in der HA-App. Kein geeichtes Messgerät, aber für Vergleiche zwischen Zonen und Quellen gut genug, solange Gerät und Abstand gleich bleiben."),
      h("div", { class: "row" }, value, h("span", { class: "grow" }), peak),
      h("div", { class: "meter" }, meter),
      h("div", { class: "row wrap" },
        h("button", { class: "btn primary", onclick: start }, icon(MDI.mic, 16), h("span", { class: "bl" }, "Messen")),
        h("button", { class: "btn", onclick: () => p._mic?.stop() }, "Stopp"),
        h("button", { class: "btn", onclick: () => {
          if (avg === null) return;
          const label = prompt("Bezeichnung der Messung (z. B. Bar · Mixer PC · Normal)");
          if (!label) return;
          p._calib.push({ label, db: avg });
          drawResults();
        } }, "Wert merken")),
      status,
      results),
    h("section", { class: "card-box" },
      h("h3", {}, "Ablauf der Kalibrierung"),
      h("ol", { class: "plan", style: { fontSize: "13px", color: "var(--ma-text)" } },
        h("li", {}, "Referenz: Webradio in einer Zone auf »Normal« abspielen, an der Hörposition messen, Wert merken."),
        h("li", {}, "Dieselbe Zone auf jeden Mixer-Eingang schalten und den Mixerpegel (Mixer › Musikpegel) so einstellen, dass derselbe Wert erreicht wird."),
        h("li", {}, "Für jede weitere Zone: Webradio-Lautstärke und Mixer-Lautstärke der Zone so anpassen, dass sie an ihrer Hörposition gleich laut ist."),
        h("li", {}, "Lauter und Party analog, jeweils mit festem Abstand zu Normal (z. B. +6 dB / +12 dB).")),
      h("p", { class: "muted small" }, "Später: Testsignal automatisch abspielen und Zone für Zone durchgehen.")),
  ];
}

// ── Rohdaten ─────────────────────────────────────────────────────────────────
function raw(p) {
  const ta = h("textarea", { class: "code", value: JSON.stringify(p.draft, null, 2) });
  const msg = h("p", { class: "muted small" });
  return h("section", { class: "card-box full" },
    h("h3", {}, "Rohdaten der Topologie"),
    h("p", { class: "muted small" }, "Für Sicherung oder größere Änderungen. »Übernehmen« ändert den Entwurf, gespeichert wird erst mit »Speichern«."),
    ta,
    h("div", { class: "row" },
      h("button", { class: "btn", onclick: () => {
        try {
          p.draft = JSON.parse(ta.value);
          p.changed();
          msg.textContent = "Übernommen.";
        } catch (err) {
          msg.textContent = `Kein gültiges JSON: ${err.message}`;
        }
      } }, "Übernehmen"),
      msg));
}
