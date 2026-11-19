// Dashboard: Bereiche mit ihren Zonen und Schnellaktionen
import { MDI, PRESETS, describeSource, h, icon, pct } from "./util.js";

export function dashboardView(p) {
  const topo = p.data.topology; // gespeicherter Stand: Schnellaktionen laufen auf diesem
  const zones = Object.keys(topo.zones ?? {});
  const qas = p.data.quick_actions ?? [];
  const areaOf = (zid) => topo.zones[zid]?.area || "Allgemein";
  const areas = [...new Set([...zones.map(areaOf), ...qas.map((q) => q.area || areaOf(q.zones[0]))])];
  const live = [];
  const last = p.data.status.last_route;
  const isActive = (q) => last && q.source !== "none" && last.zones?.length === q.zones.length
    && q.zones.every((z) => last.zones.includes(z))
    && (q.source.startsWith("mixer:") ? last.kind === "mixer" && last.interface === q.source.slice(6) && (last.input ?? null) === (q.input ?? null)
      : last.kind === "radio" && (topo.favorites?.[q.source.slice(6)] ?? q.source.slice(6)) === last.favorite)
    && last.preset === q.preset;

  const zoneRow = (zid) => {
    const z = topo.zones[zid];
    const row = h("div", { class: "zone-row" });
    const ic = h("span", { class: "zi" }, icon(z.wireless ? MDI.wifi : MDI.speaker, 20));
    const sub = h("div", { class: "zs" });
    const val = h("span", { class: "zv" });
    live.push(() => {
      const st = p.hass.states[z.player];
      row.classList.toggle("playing", st?.state === "playing");
      sub.textContent = st ? (st.state === "playing" ? describeSource(st, p.topo) : "pausiert") : "nicht verfügbar";
      val.textContent = pct(st?.attributes?.volume_level);
    });
    row.append(ic, h("div", {}, h("div", { class: "zn" }, p.zoneName(zid)), sub),
      h("span", { class: "muted small" }, (p.data.follow_ap?.find((f) => f.zone === zid)?.ap_name) ?? ""),
      val);
    row.addEventListener("click", () => { p.tab = "routes"; p.selection = { type: "zone", id: zid }; p.render(); });
    return row;
  };

  const qaButton = (q) => {
    const desc = q.source === "none" ? "Ausblenden & stoppen"
      : q.source.startsWith("radio:") ? `Radio ${q.source.slice(6)}`
      : `Mixer${q.input ? ` · ${q.input}` : ""}${q.mic ? " · Mikro" : ""}`;
    const preset = PRESETS.find(([k]) => k === q.preset)?.[1] ?? q.preset;
    const btn = h("button", { class: `qa${isActive(q) ? " active" : ""}`, title: q.zones.map((z) => p.zoneName(z)).join(", ") },
      icon(MDI[q.icon] ?? (q.source.startsWith("radio:") ? MDI.radio : q.source === "none" ? MDI.stop : MDI.mixer), 22),
      h("b", {}, q.name),
      h("span", { class: "muted" }, `${desc}${q.source === "none" ? "" : ` · ${preset}`}`));
    btn.addEventListener("click", () => p.runQuickAction(q, btn));
    btn.addEventListener("contextmenu", (e) => { e.preventDefault(); p.runQuickAction(q, btn, true); });
    return btn;
  };

  const cards = areas.map((area) => {
    const az = zones.filter((z) => areaOf(z) === area);
    const aq = qas.filter((q) => (q.area || areaOf(q.zones[0])) === area);
    return h("section", { class: "card-box" },
      h("div", { class: "row" }, h("h3", { class: "grow" }, area),
        az.length ? h("button", { class: "chip", onclick: () => p.stopZones(az) }, icon(MDI.stop, 16), " Stoppen") : null),
      az.length ? h("div", {}, ...az.map(zoneRow)) : null,
      aq.length ? h("div", { class: "qa-grid" }, ...aq.map(qaButton))
        : h("p", { class: "muted small" }, "Keine Schnellaktionen. Unter Einstellungen › Schnellaktionen anlegen."));
  });

  const s = p.data.status;
  const info = (s.last_error || s.last_warnings?.length || s.guard_events?.length || s.last_plan?.length)
    ? h("section", { class: "card-box" }, h("h3", {}, "Letzter Ablauf"),
        s.last_error ? h("div", { class: "err-line" }, s.last_error) : null,
        ...(s.last_warnings ?? []).map((w) => h("div", { class: "warn-line" }, w)),
        s.last_plan?.length ? h("ol", { class: "plan" }, ...s.last_plan.map((l) => h("li", {}, l))) : null,
        s.guard_events?.length ? h("div", { class: "sec-title" }, "Lautstärke-Wächter") : null,
        ...(s.guard_events ?? []).slice(0, 5).map((g) => h("div", { class: "muted small" }, g)))
    : null;

  const el = h("div", { class: "page" }, ...cards, info,
    h("p", { class: "muted small", style: { gridColumn: "1 / -1" } }, "Tipp: Rechtsklick bzw. langes Drücken auf eine Schnellaktion zeigt nur den Ablauf, ohne zu schalten."));
  queueMicrotask(() => live.forEach((l) => l()));
  return { el, update: () => live.forEach((l) => l()) };
}
