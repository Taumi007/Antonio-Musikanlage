// Hilfsfunktionen ohne Abhängigkeiten (Aufbau wie im Stromnetz-Panel)

export const PRESETS = [["normal", "Normal"], ["lauter", "Lauter"], ["party", "Party"]];

export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "style" && typeof v === "object") {
      for (const [sk, sv] of Object.entries(v)) {
        if (sk.startsWith("--")) el.style.setProperty(sk, sv);
        else el.style[sk] = sv;
      }
    } else if (k === "class") el.className = v;
    else if (k === "dataset") Object.assign(el.dataset, v);
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === "value") el.value = v;
    else if (k in el && typeof v !== "string") el[k] = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function svg(tag, attrs = {}, ...children) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) el.setAttribute(k, v);
  for (const c of children.flat()) if (c) el.append(c);
  return el;
}

export function icon(path, size = 18) {
  return svg("svg", { width: size, height: size, viewBox: "0 0 24 24", "aria-hidden": "true", class: "ico" },
    svg("path", { d: path, fill: "currentColor" }));
}

// MDI-Pfade (Apache 2.0)
export const MDI = {
  speaker: "M12,12A3,3 0 0,0 9,15A3,3 0 0,0 12,18A3,3 0 0,0 15,15A3,3 0 0,0 12,12M12,20A5,5 0 0,1 7,15A5,5 0 0,1 12,10A5,5 0 0,1 17,15A5,5 0 0,1 12,20M12,4A2,2 0 0,1 14,6A2,2 0 0,1 12,8C10.89,8 10,7.1 10,6C10,4.89 10.89,4 12,4M17,2H7C5.89,2 5,2.89 5,4V20A2,2 0 0,0 7,22H17A2,2 0 0,0 19,20V4C19,2.89 18.1,2 17,2Z",
  speakers: "M8,4A2,2 0 0,0 6,6A2,2 0 0,0 8,8A2,2 0 0,0 10,6A2,2 0 0,0 8,4M8,10A4,4 0 0,0 4,14A4,4 0 0,0 8,18A4,4 0 0,0 12,14A4,4 0 0,0 8,10M8,12A2,2 0 0,1 10,14A2,2 0 0,1 8,16A2,2 0 0,1 6,14A2,2 0 0,1 8,12M2,2V20H14V2H2M18,4V20H20V4H18M15,4V20H17V4H15Z",
  mixer: "M3,17V19H9V17H3M3,5V7H13V5H3M13,21V19H21V17H13V15H11V21H13M7,9V11H3V13H7V15H9V9H7M21,13V11H11V13H21M15,9H17V7H21V5H17V3H15V9Z",
  radio: "M20,6A2,2 0 0,1 22,8V20A2,2 0 0,1 20,22H4A2,2 0 0,1 2,20V8C2,7.15 2.53,6.42 3.28,6.13L15.71,1L16.47,2.83L8.83,6H20M20,8H4V12H16V10H18V12H20V8M7,14A3,3 0 0,0 4,17A3,3 0 0,0 7,20A3,3 0 0,0 10,17A3,3 0 0,0 7,14Z",
  hdmi: "M8,6H16V10H18V14L17,16H7L6,14V10H8V6M10,8V10H14V8H10Z",
  linein: "M7,2V6H5V12A4,4 0 0,0 9,16H11V22H13V16H15A4,4 0 0,0 19,12V6H17V2H15V6H9V2H7Z",
  wifi: "M12,21L15.6,16.2C14.6,15.45 13.35,15 12,15C10.65,15 9.4,15.45 8.4,16.2L12,21M12,3C7.95,3 4.21,4.34 1.2,6.6L3,9C5.5,7.12 8.62,6 12,6C15.38,6 18.5,7.12 21,9L22.8,6.6C19.79,4.34 16.05,3 12,3M12,9C9.3,9 6.81,9.89 4.8,11.4L6.6,13.8C8.1,12.67 9.97,12 12,12C14.03,12 15.9,12.67 17.4,13.8L19.2,11.4C17.19,9.89 14.7,9 12,9Z",
  mic: "M12,2A3,3 0 0,1 15,5V11A3,3 0 0,1 12,14A3,3 0 0,1 9,11V5A3,3 0 0,1 12,2M19,11C19,14.53 16.39,17.44 13,17.93V21H11V17.93C7.61,17.44 5,14.53 5,11H7A5,5 0 0,0 12,16A5,5 0 0,0 17,11H19Z",
  play: "M8,5.14V19.14L19,12.14L8,5.14Z",
  stop: "M18,18H6V6H18V18Z",
  plus: "M19,13H13V19H11V13H5V11H11V5H13V11H19V13Z",
  minus: "M19,13H5V11H19V13Z",
  fit: "M5,5H10V7H7V10H5V5M14,5H19V10H17V7H14V5M17,14H19V19H14V17H17V14M10,17V19H5V14H7V17H10Z",
  close: "M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z",
  del: "M19,4H15.5L14.5,3H9.5L8.5,4H5V6H19M6,19A2,2 0 0,0 8,21H16A2,2 0 0,0 18,19V7H6V19Z",
  up: "M7.41,15.41L12,10.83L16.59,15.41L18,14L12,8L6,14L7.41,15.41Z",
  down: "M7.41,8.58L12,13.17L16.59,8.58L18,10L12,16L6,10L7.41,8.58Z",
  info: "M13,9H11V7H13M13,17H11V11H13M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2Z",
  save: "M15,9H5V5H15M12,19A3,3 0 0,1 9,16A3,3 0 0,1 12,13A3,3 0 0,1 15,16A3,3 0 0,1 12,19M17,3H5C3.89,3 3,3.9 3,5V19A2,2 0 0,0 5,21H19A2,2 0 0,0 21,19V7L17,3Z",
  undo: "M12.5,8C9.85,8 7.45,9 5.6,10.6L2,7V16H11L7.38,12.38C8.77,11.22 10.54,10.5 12.5,10.5C16.04,10.5 19.05,12.81 20.1,16L22.47,15.22C21.08,11.03 17.15,8 12.5,8Z",
  menu: "M3,6H21V8H3V6M3,11H21V13H3V11M3,16H21V18H3V16Z",
  note: "M12,3V13.55C11.41,13.21 10.73,13 10,13A4,4 0 0,0 6,17A4,4 0 0,0 10,21A4,4 0 0,0 14,17V7H18V3H12Z",
};

export const ICON_CHOICES = [["", "—"], ["note", "Musik"], ["mixer", "Mixer"], ["radio", "Radio"], ["mic", "Mikrofon"], ["speakers", "Lautsprecher"], ["stop", "Stopp"]];

export function clone(o) {
  return JSON.parse(JSON.stringify(o ?? null));
}

export function slug(text) {
  return String(text).toLowerCase().replace(/ä/g, "a").replace(/ö/g, "o").replace(/ü/g, "u").replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

export function newId(prefix, taken) {
  if (!taken.has(prefix)) return prefix;
  let i = 2;
  while (taken.has(`${prefix}_${i}`)) i++;
  return `${prefix}_${i}`;
}

export function pct(v) {
  if (v === null || v === undefined || Number.isNaN(v)) return "–";
  return `${Math.round(v * 100)}`;
}

export function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export function fireMoreInfo(el, entityId) {
  el.dispatchEvent(new CustomEvent("hass-more-info", { detail: { entityId }, bubbles: true, composed: true }));
}

// Quelle eines Players lesbar machen
export function describeSource(st, topo) {
  if (!st) return "nicht verfügbar";
  const uri = st.attributes.media_content_id ?? "";
  const m = /^x-(rincon-stream|sonos-htastream):(RINCON_[A-Z0-9]+)/i.exec(uri);
  if (m) {
    const kind = m[1].startsWith("sonos") ? "hdmi" : "line_in";
    const iface = Object.entries(topo?.interfaces ?? {}).find(([, i]) => i.kind === kind && i._uid === m[2]);
    if (iface) return `${iface[1].mixer ? `Mixer ${iface[1].mixer}` : "Eingang"} · ${kind === "hdmi" ? "HDMI" : "Line-In"}`;
    return kind === "hdmi" ? "HDMI / TV" : "Line-In";
  }
  return st.attributes.media_channel || st.attributes.media_title || st.attributes.source || (uri ? "Stream" : "–");
}
