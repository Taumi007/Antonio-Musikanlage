// Styles im Stil des Stromnetz-Panels: nur HA-Theme-Variablen, dadurch automatisch Hell/Dunkel
export const STYLE = `
:host {
  --ma-bg: var(--primary-background-color);
  --ma-card: var(--card-background-color, var(--ha-card-background));
  --ma-text: var(--primary-text-color);
  --ma-sub: var(--secondary-text-color);
  --ma-div: var(--divider-color);
  --ma-accent: var(--primary-color);
  --ma-neutral: var(--disabled-text-color, #8a8f96);
  --ma-raised: color-mix(in srgb, var(--ma-card) 88%, var(--ma-text) 12%);
  --ma-hover: color-mix(in srgb, var(--ma-card) 80%, var(--ma-text) 20%);
  --ma-sel: color-mix(in srgb, var(--ma-card) 75%, var(--ma-accent) 25%);
  --ma-mixer: #8e6cd8;
  --ma-radio: #2a9d8f;
  --ma-hdmi: #e76f51;
  --ma-line: #e9a23b;
  display: flex; flex-direction: column; height: 100vh; height: 100dvh; overflow: hidden; background: var(--ma-bg); color: var(--ma-text);
  font-family: var(--paper-font-body1_-_font-family, Roboto, system-ui, sans-serif); font-size: 14px;
}
* { box-sizing: border-box; }
[hidden] { display: none !important; }
button { font: inherit; color: inherit; cursor: pointer; }
input, select, textarea { font: inherit; color: var(--ma-text); background: var(--ma-raised); border: 1px solid var(--ma-div); border-radius: 8px; padding: 8px 10px; min-width: 0; }
input:focus, select:focus, textarea:focus { outline: 2px solid var(--ma-accent); outline-offset: -1px; }
input[type=checkbox] { width: 18px; height: 18px; padding: 0; accent-color: var(--ma-accent); }
input[type=range] { padding: 0; accent-color: var(--ma-accent); background: none; border: 0; }
.ico { flex: none; }
.muted { color: var(--ma-sub); }
.small { font-size: 12px; }
.grow { flex: 1; min-width: 0; }
.row { display: flex; align-items: center; gap: 8px; }
.row.wrap { flex-wrap: wrap; }
.row.end { justify-content: flex-end; }
.empty { padding: 32px; color: var(--ma-sub); }

header { display: flex; align-items: center; gap: 12px; height: var(--header-height, 56px); padding: 0 12px 0 8px; background: var(--app-header-background-color, var(--ma-card)); color: var(--app-header-text-color, var(--ma-text)); border-bottom: 1px solid var(--ma-div); min-width: 0; overflow: hidden; }
.menu-btn { display: none; }
:host([narrow]) .menu-btn { display: inline-flex; }
.brand { display: flex; align-items: center; gap: 8px; font-size: 20px; font-weight: 400; padding-left: 8px; white-space: nowrap; }
.brand .ico { color: var(--ma-accent); }
.tabs { display: flex; align-self: stretch; margin-left: 12px; }
.tab { background: none; border: 0; border-bottom: 2px solid transparent; padding: 0 14px; color: var(--ma-sub); font-weight: 500; white-space: nowrap; }
.tab.active { color: var(--ma-text); border-bottom-color: var(--ma-accent); }
.tab-select { display: none; }
.btn { display: inline-flex; align-items: center; gap: 6px; height: 36px; padding: 0 14px; border-radius: 18px; border: 1px solid var(--ma-div); background: transparent; font-weight: 500; white-space: nowrap; }
.btn.primary { background: var(--ma-accent); border-color: var(--ma-accent); color: var(--text-primary-color, #fff); }
.btn:disabled { opacity: .45; cursor: default; }
.status { white-space: nowrap; }
.status .busy { color: var(--warning-color, #ffa600); font-weight: 500; }
.status .err { background: none; border: 0; color: var(--error-color, #db4437); font-weight: 500; }
.icon-btn { display: inline-flex; align-items: center; justify-content: center; width: 36px; height: 36px; border-radius: 50%; border: 0; background: transparent; }
.icon-btn:hover { background: var(--ma-hover); }
.icon-btn.small { width: 28px; height: 28px; color: var(--ma-sub); }
.chip { display: inline-flex; align-items: center; gap: 6px; height: 32px; padding: 0 12px; border-radius: 16px; border: 1px solid var(--ma-div); background: var(--ma-card); font-size: 13px; font-weight: 500; white-space: nowrap; }
.chip:hover { background: var(--ma-hover); }
.chip.active { background: var(--ma-sel); border-color: var(--ma-accent); }
.chip.danger, .danger { color: var(--error-color, #db4437); }
.chip.dashed { border-style: dashed; color: var(--ma-sub); }

main { flex: 1; min-height: 0; position: relative; }
.body { position: absolute; inset: 0; display: flex; }
.body > :first-child { flex: 1; min-width: 0; }

/* Fluss */
.flow { position: relative; overflow: hidden; touch-action: none; cursor: grab;
  background-color: var(--ma-bg); background-image: radial-gradient(color-mix(in srgb, var(--ma-text) 14%, transparent) 1px, transparent 1px); background-size: 24px 24px; }
.flow:active { cursor: grabbing; }
.stage { position: absolute; left: 0; top: 0; transform-origin: 0 0; }
.edges { position: absolute; left: 0; top: 0; overflow: visible; pointer-events: none; }
.edges path { stroke-linecap: round; }
.edges path.on { animation: dash 1.2s linear infinite; }
@keyframes dash { to { stroke-dashoffset: -24; } }
.col-title { position: absolute; font-size: 12px; text-transform: uppercase; letter-spacing: .6px; color: var(--ma-sub); }
.card { position: absolute; display: flex; align-items: center; gap: 10px; padding: 0 12px; background: var(--ma-card); border: 1px solid var(--ma-div); border-radius: 10px; font-size: 13px; line-height: 17px; cursor: pointer; user-select: none; box-shadow: 0 1px 2px rgba(0,0,0,.12); }
.card:hover { border-color: var(--ma-sub); }
.card .txt { flex: 1; min-width: 0; }
.card .title { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.card .sub { color: color-mix(in srgb, var(--ma-text) 74%, transparent); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.card .val { font-weight: 700; font-variant-numeric: tabular-nums; white-space: nowrap; }
.card .kicon { color: var(--tint, var(--ma-sub)); display: flex; }
.card.tinted { background: color-mix(in srgb, var(--ma-card) 86%, var(--tint) 14%); border-color: color-mix(in srgb, var(--ma-div) 55%, var(--tint) 45%); }
.card.idle { opacity: .72; }
.card.selected { border: 2px solid var(--ma-accent); background: var(--ma-sel); padding: 0 11px; }
.card .vbar { position: absolute; left: 12px; right: 12px; bottom: 6px; height: 3px; border-radius: 2px; background: var(--ma-raised); overflow: hidden; }
.card .vbar i { display: block; height: 100%; background: var(--tint, var(--ma-accent)); transition: width .3s; }
.flow-controls { position: absolute; left: 16px; right: 16px; bottom: 16px; display: flex; gap: 6px; align-items: center; flex-wrap: wrap; pointer-events: none; }
.flow-controls > * { pointer-events: auto; }
.flow-controls .icon-btn { background: var(--ma-card); border: 1px solid var(--ma-div); border-radius: 8px; }
.legend { display: inline-flex; gap: 12px; align-items: center; height: 32px; padding: 0 12px; border-radius: 16px; background: var(--ma-card); border: 1px solid var(--ma-div); font-size: 12px; color: var(--ma-sub); }
.legend i { display: inline-block; width: 16px; height: 3px; margin-right: 5px; vertical-align: middle; border-radius: 2px; }

/* Seitenpanel */
.drawer { flex: none; width: 0; overflow: hidden; background: var(--ma-card); border-left: 1px solid var(--ma-div); position: relative; transition: width .15s; }
.drawer.open { width: 400px; overflow-y: auto; }
.dnav { position: sticky; top: 0; z-index: 2; display: flex; align-items: center; gap: 4px; padding: 6px 6px 6px 14px; background: var(--ma-card); border-bottom: 1px solid var(--ma-div); }
.crumbs { flex: 1; min-width: 0; font-size: 13px; color: var(--ma-sub); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.form { display: flex; flex-direction: column; gap: 14px; padding: 18px 20px 24px; }
.dtitle { font-size: 18px; font-weight: 500; }
.valuebox { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.valuebox .big { font-size: 26px; font-weight: 700; font-variant-numeric: tabular-nums; }
.field { display: flex; flex-direction: column; gap: 5px; }
.field.check { flex-direction: row; align-items: center; gap: 10px; }
.flabel { font-size: 12px; color: var(--ma-sub); }
.hint { font-size: 12px; color: var(--ma-sub); }
.grid2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.grid3 { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.segment { display: flex; border: 1px solid var(--ma-div); border-radius: 8px; overflow: hidden; }
.segment button { flex: 1; height: 36px; border: 0; background: transparent; color: var(--ma-sub); }
.segment button + button { border-left: 1px solid var(--ma-div); }
.segment button.active { background: var(--ma-sel); color: var(--ma-text); font-weight: 700; }
.segment.wheel { background: var(--ma-card); height: 32px; align-items: stretch; }
.segment.wheel .wl { display: flex; align-items: center; padding: 0 8px 0 10px; font-size: 12px; color: var(--ma-sub); border-right: 1px solid var(--ma-div); }
.segment.wheel button { height: auto; padding: 0 10px; font-size: 12px; flex: none; }
details { border-top: 1px solid var(--ma-div); padding-top: 10px; display: flex; flex-direction: column; gap: 12px; }
details[open] > :not(summary) { margin-top: 12px; }
summary { cursor: pointer; color: var(--ma-sub); font-size: 13px; }
.sec-title { font-size: 13px; font-weight: 600; margin-top: 4px; }
.box { display: flex; flex-direction: column; gap: 10px; padding: 12px; border: 1px solid var(--ma-div); border-radius: 10px; background: color-mix(in srgb, var(--ma-card) 92%, var(--ma-text) 8%); }

/* Seiten (Dashboard, Einstellungen) */
.page { overflow: auto; padding: 16px 24px 32px; display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 16px; align-content: start; }
.page.single { display: flex; flex-direction: column; }
.card-box { background: var(--ma-card); border: 1px solid var(--ma-div); border-radius: 12px; padding: 14px 16px; display: flex; flex-direction: column; gap: 10px; }
.card-box h3 { margin: 0; font-size: 15px; font-weight: 500; }
.card-box p { margin: 0; }
.card-box.full { grid-column: 1 / -1; }
.subtabs { grid-column: 1 / -1; display: flex; gap: 8px; flex-wrap: wrap; }
.zone-row { display: grid; grid-template-columns: 28px minmax(0, 1fr) 110px 40px; gap: 10px; align-items: center; padding: 6px 2px; border-top: 1px solid var(--ma-div); }
.zone-row:first-of-type { border-top: 0; }
.zone-row .zi { color: var(--ma-sub); display: flex; }
.zone-row.playing .zi { color: var(--ma-accent); }
.zone-row .zn { font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.zone-row .zs { font-size: 12px; color: var(--ma-sub); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.zone-row .zv { font-variant-numeric: tabular-nums; text-align: right; font-weight: 600; }
.qa-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 8px; }
.qa { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; min-height: 76px; padding: 10px 12px; border-radius: 12px; border: 1px solid var(--ma-div); background: var(--ma-raised); text-align: left; }
.qa:hover { background: var(--ma-hover); }
.qa .ico { color: var(--ma-accent); }
.qa b { font-weight: 600; }
.qa .muted { font-size: 12px; }
.qa.running { outline: 2px solid var(--ma-accent); }
.qa.active { background: var(--ma-sel); border-color: var(--ma-accent); }
.plan { font-size: 12px; color: var(--ma-sub); margin: 0; padding-left: 18px; }
.warn-line { color: var(--warning-color, #ffa600); font-size: 13px; }
.err-line { color: var(--error-color, #db4437); font-size: 13px; }
.list-row { display: flex; align-items: center; gap: 10px; padding: 8px 2px; border-top: 1px solid var(--ma-div); }
.list-row:first-of-type { border-top: 0; }
.tag { display: inline-block; padding: 1px 8px; border-radius: 10px; font-size: 11px; background: var(--ma-raised); color: var(--ma-sub); }
table.dev { width: 100%; border-collapse: collapse; font-size: 13px; }
table.dev th { text-align: left; font-weight: 500; color: var(--ma-sub); font-size: 12px; padding: 6px 8px 6px 0; border-bottom: 1px solid var(--ma-div); }
table.dev td { padding: 7px 8px 7px 0; border-bottom: 1px solid var(--ma-div); vertical-align: top; }
table.dev code { font-size: 12px; color: var(--ma-sub); }
.meter { height: 14px; border-radius: 7px; background: var(--ma-raised); overflow: hidden; }
.meter i { display: block; height: 100%; background: var(--ma-accent); transition: width .1s; }
.big-num { font-size: 34px; font-weight: 700; font-variant-numeric: tabular-nums; }
textarea.code { width: 100%; font-family: ui-monospace, monospace; font-size: 12px; min-height: 360px; }

.toast { position: fixed; left: 50%; bottom: 24px; transform: translate(-50%, 40px); opacity: 0; transition: .2s; background: var(--ma-text); color: var(--ma-bg); padding: 10px 16px; border-radius: 8px; pointer-events: none; z-index: 30; max-width: 80vw; }
.toast.show { opacity: 1; transform: translate(-50%, 0); }

@media (max-width: 900px) {
  .drawer.open { position: absolute; right: 0; top: 0; bottom: 0; width: min(400px, 100%); z-index: 10; }
  .brand span { display: none; }
  .tab { padding: 0 8px; }
}
@media (max-width: 640px) {
  .tabs { display: none; }
  .tab-select { display: block; }
  .btn .bl { display: none; }
  .btn { padding: 0 10px; }
  .page { padding: 12px 16px 24px; grid-template-columns: minmax(0, 1fr); }
  .legend { display: none; }
}
`;
