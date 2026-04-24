// Boo — resource availability calendar (vanilla ES module)
import Sortable from "https://esm.sh/sortablejs@1.15.6";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const SNAP_MIN = 30;
const SNAP_MS = SNAP_MIN * 60 * 1000;

const MODES = {
  day: { days: 1, minHourWidth: 32 },
  week: { days: 7, minHourWidth: 3 },
};
const DEFAULT_MODE = "week";

const PALETTE = [
  "#6366f1", "#8b5cf6", "#ec4899", "#ef4444", "#f59e0b",
  "#10b981", "#14b8a6", "#0ea5e9", "#64748b", "#a855f7",
];
const ICONS = [
  "flask", "server", "cpu", "wifi", "rocket",
  "phone", "car", "camera", "bolt", "user",
];

const initialMode = MODES[localStorage.getItem("booMode")] ? localStorage.getItem("booMode") : DEFAULT_MODE;

const state = {
  resources: [],
  bookings: [],
  mode: initialMode,
  viewStart: initialMode === "week" ? startOfWeek(Date.now()) : startOfDay(Date.now()),
  user: localStorage.getItem("booUser") || "",
  editingResourceId: null,
  editingBookingId: null,
  bookingDefaults: null,
  sortMode: false,
  sortable: null,
};

// ---------- utilities ----------

function startOfDay(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
function startOfWeek(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  const offset = (d.getDay() + 6) % 7; // Monday = 0
  d.setDate(d.getDate() - offset);
  return d.getTime();
}
function addDays(ts, n) { return ts + n * DAY_MS; }
function fmtDate(ts) {
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}
function fmtLocalInput(ts) {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function parseLocalInput(s) { return new Date(s).getTime(); }
function snap(ts) { return Math.round(ts / SNAP_MS) * SNAP_MS; }
function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
function hourWidth() {
  return parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--hour-width")) || 6;
}
function daysVisible() { return MODES[state.mode].days; }
function viewEnd() { return addDays(state.viewStart, daysVisible()); }

function updateHourWidth() {
  const tl = document.getElementById("timeline");
  if (!tl || !tl.clientWidth) return;
  const { days, minHourWidth } = MODES[state.mode];
  const natural = tl.clientWidth / (days * 24);
  const hw = Math.max(minHourWidth, natural);
  document.documentElement.style.setProperty("--hour-width", `${hw}px`);
}

function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove("show"), 2200);
}

// ---------- API ----------

async function api(method, path, body) {
  const opts = { method, headers: {} };
  if (body !== undefined) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  const r = await fetch(path, opts);
  if (!r.ok) {
    let msg = r.statusText;
    try { msg = (await r.json()).error || msg; } catch {}
    const err = new Error(msg);
    err.status = r.status;
    throw err;
  }
  if (r.status === 204) return null;
  return r.json();
}

async function loadState() {
  const s = await api("GET", "/api/state");
  state.resources = s.resources || [];
  state.bookings = (s.bookings || []).map((b) => ({
    ...b,
    start: new Date(b.start).getTime(),
    end: new Date(b.end).getTime(),
  }));
  render();
}

// ---------- rendering ----------

function render() {
  document.body.dataset.mode = state.mode;
  updateHourWidth();
  renderRangeLabel();
  renderResources();
  renderTimeline();
}

function renderRangeLabel() {
  const start = state.viewStart;
  const end = viewEnd() - DAY_MS;
  const label = document.getElementById("range-label");
  label.textContent = daysVisible() === 1 ? fmtDate(start) : `${fmtDate(start)} – ${fmtDate(end)}`;
}

function isResourceBusy(resourceId) {
  const now = Date.now();
  return state.bookings.some(b => b.resourceId === resourceId && b.start <= now && b.end > now);
}

function renderResources() {
  // Tear down any existing Sortable before replacing the DOM
  if (state.sortable) {
    state.sortable.destroy();
    state.sortable = null;
  }

  const list = document.getElementById("resource-list");
  list.innerHTML = "";
  for (const r of state.resources) {
    const li = document.createElement("li");
    li.className = "resource-item";
    if (isResourceBusy(r.id)) li.classList.add("resource-item--busy");
    li.dataset.id = r.id;
    li.dataset.name = r.name;
    const swatchHTML = (r.icon && r.icon.startsWith("/"))
      ? `<img src="${escapeHtml(r.icon)}" class="resource-picture" alt="">`
      : `<span class="swatch" style="background:${r.color}">${iconHTML(r.icon)}</span>`;
    const linkCount = (r.links || []).length;
    const linkClass = linkCount ? "link-hint has-links" : "link-hint";
    const linkTitle = linkCount ? `${linkCount} link${linkCount === 1 ? "" : "s"}` : "No links — click to add";
    li.innerHTML = `
      <button type="button" class="drag-handle" aria-label="Drag to reorder" title="Drag to reorder" tabindex="-1">
        <svg class="icon"><use href="#i-grip"/></svg>
      </button>
      ${swatchHTML}
      <span class="meta">
        <span class="name"></span>
        <span class="desc"></span>
      </span>
      <span class="${linkClass}" title="${linkTitle}" aria-hidden="true"><svg class="icon"><use href="#i-link"/></svg></span>
      <button class="icon-btn ghost edit" aria-label="Edit resource"><svg class="icon"><use href="#i-pencil"/></svg></button>
    `;
    li.querySelector(".name").textContent = r.name;
    li.querySelector(".desc").textContent = r.description || "";
    li.querySelector(".edit").addEventListener("click", (e) => {
      e.stopPropagation();
      openResourceDialog(r);
    });
    li.addEventListener("click", (e) => {
      if (state.sortMode) return;
      if (e.target.closest(".edit")) return;
      if (e.target.closest(".drag-handle")) return;
      openLinkPopover(r, li);
    });
    list.appendChild(li);
  }

  if (state.sortMode) {
    state.sortable = Sortable.create(list, {
      animation: 180,
      handle: ".drag-handle",
      ghostClass: "resource-item--ghost",
      dragClass: "resource-item--drag",
      forceFallback: true,
      fallbackTolerance: 4,
      onEnd: async (evt) => {
        if (evt.oldIndex === evt.newIndex) return;
        const ids = [...list.querySelectorAll(".resource-item")].map((el) => el.dataset.id);
        const prev = state.resources.slice();
        state.resources = ids.map((id) => prev.find((r) => r.id === id)).filter(Boolean);
        renderTimeline(); // sync row order immediately
        try {
          await api("POST", "/api/resources/order", { ids });
        } catch (err) {
          toast(err.message);
          state.resources = prev;
          render();
        }
      },
    });
  }
}

function renderTimeline() {
  const header = document.getElementById("timeline-header");
  const body = document.getElementById("timeline-body");
  const empty = document.getElementById("empty");

  header.innerHTML = "";
  body.innerHTML = "";

  if (!state.resources.length) {
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");

  const today = startOfDay(Date.now());
  const days = daysVisible();

  for (let i = 0; i < days; i++) {
    const dayTs = addDays(state.viewStart, i);
    const d = new Date(dayTs);
    const div = document.createElement("div");
    div.className = "day-head";
    if (d.getDay() === 0 || d.getDay() === 6) div.classList.add("weekend");
    if (dayTs === today) div.classList.add("today");
    const hours = Array.from({ length: 24 }, (_, h) =>
      `<span class="hour-label">${String(h).padStart(2, "0")}</span>`
    ).join("");
    div.innerHTML = `
      <div class="day-label">
        <span class="dow">${d.toLocaleDateString(undefined, { weekday: "short" })}</span>
        <span class="dom">${d.getDate()}</span>
        <span class="mon muted">${d.toLocaleDateString(undefined, { month: "short" })}</span>
      </div>
      <div class="day-hours">${hours}</div>
    `;
    header.appendChild(div);
  }

  const totalHours = days * 24;
  const totalWidth = totalHours * hourWidth();

  for (const res of state.resources) {
    const row = document.createElement("div");
    row.className = "timeline-row";
    row.dataset.resourceId = res.id;
    row.style.width = `${totalWidth}px`;
    row.style.setProperty("--c", res.color);
    row.innerHTML = `<div class="row-grid"></div><div class="row-surface"></div>`;

    const surface = row.querySelector(".row-surface");
    if (state.mode === "week") {
      for (let i = 0; i < days; i++) {
        const dow = new Date(addDays(state.viewStart, i)).getDay();
        if (dow === 0 || dow === 6) {
          const col = document.createElement("div");
          col.className = "weekend-col";
          col.style.left = `calc(var(--hour-width) * ${i * 24})`;
          col.style.width = `calc(var(--hour-width) * 24)`;
          surface.before(col);
        }
      }
    } else if (state.mode === "day") {
      const WORK_START = 9, WORK_END = 18;
      const morning = document.createElement("div");
      morning.className = "offhours-col";
      morning.style.left = "0";
      morning.style.width = `calc(var(--hour-width) * ${WORK_START})`;
      surface.before(morning);
      const evening = document.createElement("div");
      evening.className = "offhours-col";
      evening.style.left = `calc(var(--hour-width) * ${WORK_END})`;
      evening.style.width = `calc(var(--hour-width) * ${24 - WORK_END})`;
      surface.before(evening);
    }

    const bookings = state.bookings.filter((b) => b.resourceId === res.id);
    for (const b of bookings) {
      const el = bookingEl(b, res);
      if (el) row.appendChild(el);
    }
    attachRowInteractions(row, res);
    body.appendChild(row);
  }

  // now-line
  const nowLine = document.createElement("div");
  nowLine.className = "now-line";
  const nowOffset = (Date.now() - state.viewStart) / HOUR_MS * hourWidth();
  if (nowOffset >= 0 && nowOffset <= totalWidth) {
    nowLine.style.left = `${nowOffset}px`;
    body.appendChild(nowLine);
  }
}

function bookingEl(b, res) {
  const vStart = state.viewStart;
  const vEnd = viewEnd();
  if (b.end <= vStart || b.start >= vEnd) return null;
  const start = Math.max(b.start, vStart);
  const end = Math.min(b.end, vEnd);
  const left = (start - vStart) / HOUR_MS * hourWidth();
  const width = (end - start) / HOUR_MS * hourWidth();

  const el = document.createElement("div");
  el.className = "booking";
  el.dataset.id = b.id;
  el.style.left = `${left}px`;
  el.style.width = `${Math.max(width, 18)}px`;
  el.style.setProperty("--c", res.color);

  const co = b.coBookers && b.coBookers.length ? b.coBookers : [];
  const plus = co.length ? `<span class="b-plus" title="${[b.user, ...co].join(", ")}">+${co.length}</span>` : "";
  el.innerHTML = `
    <span class="b-user"><span class="b-name"></span>${plus}</span>
    <span class="b-meta"></span>
  `;
  el.querySelector(".b-name").textContent = b.user;
  el.querySelector(".b-meta").textContent = `${fmtTime(b.start)} – ${fmtTime(b.end)}${b.note ? " · " + b.note : ""}`;
  el.addEventListener("click", (e) => {
    e.stopPropagation();
    hideBookingTooltip();
    openBookingDialog({ booking: b });
  });
  el.addEventListener("mouseenter", () => {
    clearTimeout(_tooltipTimer);
    _tooltipTimer = setTimeout(() => showBookingTooltip(b, el), 350);
  });
  el.addEventListener("mouseleave", () => {
    clearTimeout(_tooltipTimer);
    hideBookingTooltip();
  });
  return el;
}

// ---------- row interactions: click + drag to create ----------

function attachRowInteractions(row, res) {
  const surface = row.querySelector(".row-surface");
  let dragging = null;

  const pxToTs = (px) => {
    const ts = state.viewStart + (px / hourWidth()) * HOUR_MS;
    return snap(clamp(ts, state.viewStart, viewEnd()));
  };

  surface.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    surface.setPointerCapture(e.pointerId);
    const rect = surface.getBoundingClientRect();
    const startTs = pxToTs(e.clientX - rect.left);
    dragging = { res, startTs, endTs: startTs + HOUR_MS, ghost: null, rect, moved: false };
  });

  surface.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    dragging.moved = true;
    const ts = pxToTs(e.clientX - dragging.rect.left);
    dragging.endTs = ts;
    const lo = Math.min(dragging.startTs, ts);
    const hi = Math.max(dragging.startTs, ts);
    if (!dragging.ghost) {
      dragging.ghost = document.createElement("div");
      dragging.ghost.className = "booking ghost";
      dragging.ghost.style.setProperty("--c", res.color);
      row.appendChild(dragging.ghost);
    }
    const left = (lo - state.viewStart) / HOUR_MS * hourWidth();
    const width = Math.max((hi - lo) / HOUR_MS * hourWidth(), 18);
    dragging.ghost.style.left = `${left}px`;
    dragging.ghost.style.width = `${width}px`;
  });

  const endDrag = (e) => {
    if (!dragging) return;
    try { surface.releasePointerCapture(e.pointerId); } catch {}
    const { moved } = dragging;
    let lo, hi;
    if (moved) {
      lo = Math.min(dragging.startTs, dragging.endTs);
      hi = Math.max(dragging.startTs, dragging.endTs);
    } else {
      lo = dragging.startTs;
      hi = lo + HOUR_MS;
    }
    if (hi - lo < SNAP_MS) hi = lo + SNAP_MS;
    dragging.ghost?.remove();
    const res2 = dragging.res;
    dragging = null;
    openBookingDialog({ resourceId: res2.id, start: lo, end: hi });
  };
  surface.addEventListener("pointerup", endDrag);
  surface.addEventListener("pointercancel", endDrag);
}

// ---------- dialogs ----------

function requireName() {
  if (state.user) return true;
  const d = document.getElementById("name-dialog");
  d.showModal();
  return false;
}

function openBookingDialog({ booking, resourceId, start, end } = {}) {
  if (!requireName()) {
    // Re-open booking dialog after name saved (one-shot).
    state.bookingDefaults = { booking, resourceId, start, end };
    return;
  }

  const dialog = document.getElementById("booking-dialog");
  const form = document.getElementById("booking-form");
  const title = document.getElementById("booking-dialog-title");
  const err = document.getElementById("booking-error");
  const delBtn = document.getElementById("booking-delete");
  const badge = document.getElementById("booking-resource-badge");

  err.hidden = true;
  err.textContent = "";

  const isEdit = !!booking;
  state.editingBookingId = isEdit ? booking.id : null;
  const resId = isEdit ? booking.resourceId : resourceId;
  const res = state.resources.find((r) => r.id === resId);
  if (!res) return;

  title.textContent = isEdit ? "Edit booking" : "New booking";
  delBtn.hidden = !isEdit;
  badge.innerHTML = `<span class="swatch" style="background:${res.color}">${iconHTML(res.icon)}</span><span>${escapeHtml(res.name)}</span>`;
  badge.dataset.resourceId = res.id;

  form.user.value = isEdit ? booking.user : state.user;
  form.start.value = fmtLocalInput(isEdit ? booking.start : start);
  form.end.value = fmtLocalInput(isEdit ? booking.end : end);
  form.note.value = isEdit ? (booking.note || "") : "";
  renderChips(isEdit ? (booking.coBookers || []) : []);

  dialog.showModal();
  setTimeout(() => form.user.focus(), 40);
}

function openResourceDialog(resource) {
  const dialog = document.getElementById("resource-dialog");
  const form = document.getElementById("resource-form");
  const title = document.getElementById("resource-dialog-title");
  const delBtn = document.getElementById("resource-delete");

  state.editingResourceId = resource ? resource.id : null;

  title.textContent = resource ? "Edit resource" : "New resource";
  delBtn.hidden = !resource;
  form.name.value = resource ? resource.name : "";
  form.description.value = resource ? (resource.description || "") : "";

  renderSwatches(resource ? resource.color : PALETTE[0]);
  renderIconPicker(resource ? resource.icon : ICONS[0]);
  renderLinkRows(resource ? (resource.links || []) : []);
  dialog.showModal();
  setTimeout(() => form.name.focus(), 40);
}

let linkSortable = null;

function renderLinkRows(links) {
  if (linkSortable) { linkSortable.destroy(); linkSortable = null; }
  const ul = document.getElementById("link-rows");
  ul.innerHTML = "";
  for (const l of links) addLinkRow(l.url, l.text);
  linkSortable = Sortable.create(ul, {
    animation: 180,
    handle: ".link-drag",
    ghostClass: "link-row--ghost",
    dragClass: "link-row--drag",
    forceFallback: true,
    fallbackTolerance: 4,
  });
}

function addLinkRow(url = "", text = "") {
  const ul = document.getElementById("link-rows");
  const li = document.createElement("li");
  li.className = "link-row";
  li.innerHTML = `
    <button type="button" class="icon-btn ghost link-drag" aria-label="Drag to reorder" title="Drag to reorder">
      <svg class="icon"><use href="#i-grip"/></svg>
    </button>
    <input class="link-text" placeholder="Label" maxlength="80" />
    <input class="link-url" type="text" placeholder="https://…" maxlength="500" />
    <button type="button" class="icon-btn ghost link-remove" aria-label="Remove link">
      <svg class="icon"><use href="#i-trash"/></svg>
    </button>
  `;
  li.querySelector(".link-text").value = text;
  li.querySelector(".link-url").value = url;
  li.querySelector(".link-remove").addEventListener("click", () => li.remove());
  ul.appendChild(li);
}

function getLinkRows() {
  const rows = document.querySelectorAll("#link-rows .link-row");
  const out = [];
  for (const row of rows) {
    const url = row.querySelector(".link-url").value.trim();
    const text = row.querySelector(".link-text").value.trim();
    if (!url && !text) continue;
    out.push({ url, text });
  }
  return out;
}

// ---------- link popover ----------

function openLinkPopover(resource, anchor) {
  closeLinkPopover();
  const pop = document.getElementById("link-popover");
  pop.innerHTML = "";
  const links = resource.links || [];

  if (!links.length) {
    const empty = document.createElement("div");
    empty.className = "link-empty";
    empty.textContent = "No links configured.";
    pop.appendChild(empty);
    const hint = document.createElement("button");
    hint.type = "button";
    hint.className = "link-edit-hint";
    hint.innerHTML = `<svg class="icon"><use href="#i-pencil"/></svg><span>Edit resource</span>`;
    hint.addEventListener("click", () => { closeLinkPopover(); openResourceDialog(resource); });
    pop.appendChild(hint);
  } else {
    for (const l of links) {
      const a = document.createElement("a");
      a.className = "link-item";
      a.href = l.url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = l.text || l.url;
      a.title = l.url;
      a.addEventListener("click", () => closeLinkPopover());
      pop.appendChild(a);
    }
  }

  pop.hidden = false;
  positionPopover(pop, anchor);

  // Close handlers
  const onDocClick = (e) => {
    if (!pop.contains(e.target) && !anchor.contains(e.target)) closeLinkPopover();
  };
  const onKey = (e) => { if (e.key === "Escape") closeLinkPopover(); };
  const onScroll = () => closeLinkPopover();
  setTimeout(() => {
    document.addEventListener("click", onDocClick);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onScroll);
    document.querySelector(".resource-list")?.addEventListener("scroll", onScroll);
    pop._cleanup = () => {
      document.removeEventListener("click", onDocClick);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onScroll);
      document.querySelector(".resource-list")?.removeEventListener("scroll", onScroll);
    };
  }, 0);
}

let _tooltipTimer = null;

function getOrCreateTooltip() {
  let tip = document.getElementById("booking-tooltip");
  if (!tip) {
    tip = document.createElement("div");
    tip.id = "booking-tooltip";
    tip.className = "booking-tooltip";
    tip.hidden = true;
    document.body.appendChild(tip);
  }
  return tip;
}

function showBookingTooltip(b, anchor) {
  const tip = getOrCreateTooltip();
  tip.innerHTML = "";

  const userEl = document.createElement("div");
  userEl.className = "bt-user";
  userEl.textContent = b.user;
  tip.appendChild(userEl);

  const co = b.coBookers && b.coBookers.length ? b.coBookers : [];
  if (co.length) {
    const coEl = document.createElement("div");
    coEl.className = "bt-co";
    coEl.textContent = "Also: " + co.join(", ");
    tip.appendChild(coEl);
  }

  const timeEl = document.createElement("div");
  timeEl.className = "bt-time";
  timeEl.textContent = `${fmtTime(b.start)} – ${fmtTime(b.end)}`;
  tip.appendChild(timeEl);

  if (b.note) {
    const noteEl = document.createElement("div");
    noteEl.className = "bt-note";
    noteEl.textContent = b.note;
    tip.appendChild(noteEl);
  }

  tip.hidden = false;
  tip.style.left = "0px";
  tip.style.top = "0px";
  const rect = anchor.getBoundingClientRect();
  const tw = tip.offsetWidth;
  const th = tip.offsetHeight;
  let left = rect.left + rect.width / 2 - tw / 2;
  left = Math.max(8, Math.min(left, window.innerWidth - tw - 8));
  let top = rect.top - th - 6;
  if (top < 8) top = rect.bottom + 6;
  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
}

function hideBookingTooltip() {
  const tip = getOrCreateTooltip();
  tip.hidden = true;
}

function positionPopover(pop, anchor) {
  const rect = anchor.getBoundingClientRect();
  pop.style.left = "0px";
  pop.style.top = "0px";
  const pw = pop.offsetWidth;
  const ph = pop.offsetHeight;
  let left = rect.right + 8;
  if (left + pw > window.innerWidth - 8) left = Math.max(8, rect.left - pw - 8);
  let top = rect.top;
  if (top + ph > window.innerHeight - 8) top = Math.max(8, window.innerHeight - ph - 8);
  pop.style.left = `${left}px`;
  pop.style.top = `${top}px`;
}

function closeLinkPopover() {
  const pop = document.getElementById("link-popover");
  if (pop.hidden) return;
  pop.hidden = true;
  pop.innerHTML = "";
  if (pop._cleanup) { pop._cleanup(); pop._cleanup = null; }
}

function renderSwatches(selected) {
  const el = document.getElementById("color-swatches");
  el.innerHTML = "";
  el.dataset.selected = selected;
  closeColorPicker();
  const isCustom = !PALETTE.includes(selected);

  for (const color of PALETTE) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "swatch-color";
    b.style.setProperty("--sw", color);
    b.setAttribute("aria-pressed", String(!isCustom && color === selected));
    b.addEventListener("click", () => {
      el.dataset.selected = color;
      closeColorPicker();
      el.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", "false"));
      b.setAttribute("aria-pressed", "true");
      const custom = el.querySelector(".swatch-custom");
      custom.classList.remove("has-color");
      custom.style.removeProperty("--sw");
    });
    el.appendChild(b);
  }

  const custom = document.createElement("button");
  custom.type = "button";
  custom.className = "swatch-custom";
  custom.title = "Custom color";
  if (isCustom) {
    custom.style.setProperty("--sw", selected);
    custom.classList.add("has-color");
    custom.setAttribute("aria-pressed", "true");
  } else {
    custom.setAttribute("aria-pressed", "false");
  }
  custom.addEventListener("click", () => {
    if (document.getElementById("color-picker-host").firstChild) {
      closeColorPicker();
    } else {
      openColorPicker(el.dataset.selected);
    }
  });
  el.appendChild(custom);
}

// ---------- color picker ----------

function hexToRgb(hex) {
  const m = String(hex).replace("#", "").match(/^([0-9a-f]{6}|[0-9a-f]{3})$/i);
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
}
function rgbToHex(r, g, b) {
  return "#" + [r, g, b].map((n) => Math.round(clamp(n, 0, 255)).toString(16).padStart(2, "0")).join("");
}
function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
  }
  h *= 60;
  if (h < 0) h += 360;
  return { h, s: max ? d / max : 0, v: max };
}
function hsvToHex(h, s, v) {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else { r = c; b = x; }
  return rgbToHex((r + m) * 255, (g + m) * 255, (b + m) * 255);
}
function hexToHsv(hex) {
  const rgb = hexToRgb(hex) || { r: 99, g: 102, b: 241 };
  return rgbToHsv(rgb.r, rgb.g, rgb.b);
}

function openColorPicker(initial) {
  const host = document.getElementById("color-picker-host");
  host.innerHTML = "";
  let { h, s, v } = hexToHsv(initial);

  const root = document.createElement("div");
  root.className = "color-picker";
  root.innerHTML = `
    <div class="cp-sv">
      <div class="cp-sv-thumb"></div>
    </div>
    <div class="cp-hue">
      <div class="cp-hue-thumb"></div>
    </div>
    <div class="cp-row">
      <span class="cp-preview"></span>
      <span class="cp-hash">#</span>
      <input type="text" class="cp-hex" maxlength="6" autocomplete="off" spellcheck="false" />
    </div>
  `;
  const sv = root.querySelector(".cp-sv");
  const svThumb = root.querySelector(".cp-sv-thumb");
  const hue = root.querySelector(".cp-hue");
  const hueThumb = root.querySelector(".cp-hue-thumb");
  const preview = root.querySelector(".cp-preview");
  const hexInput = root.querySelector(".cp-hex");

  function paint() {
    const hex = hsvToHex(h, s, v);
    sv.style.setProperty("--cp-h", h);
    svThumb.style.left = `${s * 100}%`;
    svThumb.style.top = `${(1 - v) * 100}%`;
    svThumb.style.background = hex;
    hueThumb.style.left = `${(h / 360) * 100}%`;
    hueThumb.style.background = `hsl(${h} 100% 50%)`;
    preview.style.background = hex;
    if (document.activeElement !== hexInput) {
      hexInput.value = hex.slice(1).toUpperCase();
    }
    return hex;
  }

  function commit() {
    const hex = paint();
    const wrap = document.getElementById("color-swatches");
    wrap.dataset.selected = hex;
    wrap.querySelectorAll(".swatch-color").forEach((b) => b.setAttribute("aria-pressed", "false"));
    const custom = wrap.querySelector(".swatch-custom");
    custom.style.setProperty("--sw", hex);
    custom.classList.add("has-color");
    custom.setAttribute("aria-pressed", "true");
  }

  function attachDrag(el, onMove) {
    el.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      try { el.setPointerCapture(e.pointerId); } catch {}
      onMove(e);
      const move = (ev) => onMove(ev);
      const up = (ev) => {
        try { el.releasePointerCapture(ev.pointerId); } catch {}
        el.removeEventListener("pointermove", move);
        el.removeEventListener("pointerup", up);
        el.removeEventListener("pointercancel", up);
      };
      el.addEventListener("pointermove", move);
      el.addEventListener("pointerup", up);
      el.addEventListener("pointercancel", up);
    });
  }

  attachDrag(sv, (e) => {
    const r = sv.getBoundingClientRect();
    s = clamp((e.clientX - r.left) / r.width, 0, 1);
    v = clamp(1 - (e.clientY - r.top) / r.height, 0, 1);
    commit();
  });
  attachDrag(hue, (e) => {
    const r = hue.getBoundingClientRect();
    h = clamp((e.clientX - r.left) / r.width, 0, 1) * 360;
    commit();
  });
  hexInput.addEventListener("input", () => {
    const cleaned = hexInput.value.replace(/[^0-9a-f]/gi, "").slice(0, 6);
    if (cleaned.length === 6) {
      const hsv = hexToHsv("#" + cleaned);
      h = hsv.h; s = hsv.s; v = hsv.v;
      commit();
    }
  });
  hexInput.addEventListener("blur", () => paint());

  paint();
  host.appendChild(root);
  setTimeout(() => hexInput.focus({ preventScroll: true }), 30);
}

function closeColorPicker() {
  const host = document.getElementById("color-picker-host");
  if (host) host.innerHTML = "";
}

function renderIconPicker(selected) {
  const el = document.getElementById("icon-picker");
  el.innerHTML = "";
  el.dataset.selected = selected;
  const isCustom = selected && selected.startsWith("/");
  for (const icon of ICONS) {
    const b = document.createElement("button");
    b.type = "button";
    b.setAttribute("aria-pressed", String(!isCustom && icon === selected));
    b.innerHTML = `<svg class="icon"><use href="#i-${icon}"/></svg>`;
    b.addEventListener("click", () => {
      el.dataset.selected = icon;
      el.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      // clear any pending upload
      const input = document.getElementById("icon-upload");
      const preview = document.getElementById("icon-upload-preview");
      input.value = "";
      preview.hidden = true;
    });
    el.appendChild(b);
  }

  // Show current custom icon in the preview slot
  const preview = document.getElementById("icon-upload-preview");
  if (isCustom) {
    preview.src = selected;
    preview.hidden = false;
  } else {
    preview.hidden = true;
    preview.src = "";
  }
  // Reset file input
  document.getElementById("icon-upload").value = "";
}

// ---------- co-booker chips ----------

function renderChips(names) {
  const chips = document.getElementById("cobooker-chips");
  chips.innerHTML = "";
  for (const n of names) addChip(n);
}
function addChip(name) {
  const chips = document.getElementById("cobooker-chips");
  if ([...chips.children].some((c) => c.dataset.name === name)) return;
  const li = document.createElement("li");
  li.className = "chip";
  li.dataset.name = name;
  li.innerHTML = `<span></span><button type="button" aria-label="Remove">×</button>`;
  li.querySelector("span").textContent = name;
  li.querySelector("button").addEventListener("click", () => li.remove());
  chips.appendChild(li);
}
function getChips() {
  return [...document.getElementById("cobooker-chips").children].map((c) => c.dataset.name);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function iconHTML(icon, cls = "icon") {
  if (icon && icon.startsWith("/")) {
    return `<img src="${escapeHtml(icon)}" class="${cls} icon-img" alt="">`;
  }
  return `<svg class="${cls}"><use href="#i-${escapeHtml(icon)}"/></svg>`;
}

// ---------- form submission ----------

async function submitResource(e) {
  e.preventDefault();
  const form = e.target;
  const color = document.getElementById("color-swatches").dataset.selected;
  const icon = document.getElementById("icon-picker").dataset.selected;
  const iconFile = document.getElementById("icon-upload").files[0];
  const body = {
    name: form.name.value.trim(),
    description: form.description.value.trim(),
    color, icon,
    links: getLinkRows(),
  };
  try {
    let resource;
    if (state.editingResourceId) {
      resource = await api("PATCH", `/api/resources/${state.editingResourceId}`, body);
      toast("Resource updated");
    } else {
      resource = await api("POST", "/api/resources", body);
      toast("Resource added");
    }
    if (iconFile) {
      const fd = new FormData();
      fd.append("file", iconFile);
      const r = await fetch(`/api/resources/${resource.id}/icon`, { method: "POST", body: fd });
      if (!r.ok) {
        let msg = "Icon upload failed";
        try { msg = (await r.json()).error || msg; } catch {}
        toast(msg);
      }
    }
    document.getElementById("resource-dialog").close();
    await loadState();
  } catch (err) {
    toast(err.message);
  }
}

async function deleteResource() {
  if (!state.editingResourceId) return;
  if (!confirm("Delete this resource and all its bookings?")) return;
  try {
    await api("DELETE", `/api/resources/${state.editingResourceId}`);
    document.getElementById("resource-dialog").close();
    toast("Resource deleted");
    await loadState();
  } catch (err) {
    toast(err.message);
  }
}

async function submitBooking(e) {
  e.preventDefault();
  const form = e.target;
  const entry = document.getElementById("cobooker-entry");
  if (entry.value.trim()) { addChip(entry.value.trim()); entry.value = ""; }
  const resourceId = document.getElementById("booking-resource-badge").dataset.resourceId;
  const body = {
    resourceId,
    user: form.user.value.trim(),
    coBookers: getChips(),
    start: new Date(parseLocalInput(form.start.value)).toISOString(),
    end: new Date(parseLocalInput(form.end.value)).toISOString(),
    note: form.note.value.trim(),
  };
  try {
    if (state.editingBookingId) {
      await api("PATCH", `/api/bookings/${state.editingBookingId}`, body);
      toast("Booking updated");
    } else {
      await api("POST", "/api/bookings", body);
      toast("Booking created");
    }
    document.getElementById("booking-dialog").close();
    await loadState();
  } catch (err) {
    const el = document.getElementById("booking-error");
    el.textContent = err.status === 409 ? "That slot overlaps an existing booking." : err.message;
    el.hidden = false;
  }
}

async function deleteBooking() {
  if (!state.editingBookingId) return;
  try {
    await api("DELETE", `/api/bookings/${state.editingBookingId}`);
    document.getElementById("booking-dialog").close();
    toast("Booking deleted");
    await loadState();
  } catch (err) {
    toast(err.message);
  }
}

// ---------- wire up ----------

function init() {
  document.getElementById("who-name").textContent = state.user || "Set name";

  // Nav
  document.getElementById("prev").addEventListener("click", () => navigate(-1));
  document.getElementById("next").addEventListener("click", () => navigate(1));
  document.getElementById("today").addEventListener("click", () => {
    state.viewStart = state.mode === "week" ? startOfWeek(Date.now()) : startOfDay(Date.now());
    render();
    scrollToNow();
  });

  // Mode switch
  const setMode = (mode) => {
    if (!MODES[mode] || mode === state.mode) return;
    state.mode = mode;
    localStorage.setItem("booMode", mode);
    if (mode === "week") {
      state.viewStart = startOfWeek(state.viewStart);
    } else {
      const today = startOfDay(Date.now());
      const weekEnd = addDays(state.viewStart, 7);
      state.viewStart = today >= state.viewStart && today < weekEnd ? today : startOfDay(state.viewStart);
    }
    updateModeButtons();
    render();
  };
  const updateModeButtons = () => {
    for (const m of Object.keys(MODES)) {
      const btn = document.getElementById(`mode-${m}`);
      if (btn) btn.setAttribute("aria-pressed", String(state.mode === m));
    }
  };
  for (const m of Object.keys(MODES)) {
    document.getElementById(`mode-${m}`)?.addEventListener("click", () => setMode(m));
  }
  updateModeButtons();

  window.addEventListener("resize", () => {
    updateHourWidth();
  });

  // Who
  const nameDialog = document.getElementById("name-dialog");
  const nameInput = document.getElementById("name-input");
  document.getElementById("who-btn").addEventListener("click", () => {
    nameInput.value = state.user;
    nameDialog.showModal();
    setTimeout(() => nameInput.focus(), 40);
  });
  nameDialog.addEventListener("close", () => {
    if (nameInput.value.trim()) {
      state.user = nameInput.value.trim();
      localStorage.setItem("booUser", state.user);
      document.getElementById("who-name").textContent = state.user;
      toast(`Hi ${state.user} 👻`);
      if (state.bookingDefaults) {
        const d = state.bookingDefaults;
        state.bookingDefaults = null;
        openBookingDialog(d);
      }
    }
  });

  // Icon upload preview
  document.getElementById("icon-upload").addEventListener("change", (e) => {
    const file = e.target.files[0];
    const preview = document.getElementById("icon-upload-preview");
    const picker = document.getElementById("icon-picker");
    if (!file) { preview.hidden = true; return; }
    const url = URL.createObjectURL(file);
    preview.src = url;
    preview.hidden = false;
    // deselect all predefined icon buttons
    picker.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", "false"));
  });

  // Resources
  document.getElementById("sort-toggle").addEventListener("click", () => {
    state.sortMode = !state.sortMode;
    document.body.dataset.sortMode = String(state.sortMode);
    document.getElementById("sort-toggle").setAttribute("aria-pressed", String(state.sortMode));
    closeLinkPopover();
    renderResources(); // destroys/creates Sortable and refreshes drag handles
  });
  document.getElementById("add-resource").addEventListener("click", () => openResourceDialog(null));
  document.getElementById("empty-add").addEventListener("click", () => openResourceDialog(null));
  document.getElementById("resource-form").addEventListener("submit", submitResource);
  document.getElementById("resource-delete").addEventListener("click", deleteResource);
  document.getElementById("link-add").addEventListener("click", () => addLinkRow());

  // Bookings
  document.getElementById("booking-form").addEventListener("submit", submitBooking);
  document.getElementById("booking-delete").addEventListener("click", deleteBooking);
  document.getElementById("fab").addEventListener("click", () => {
    if (!state.resources.length) { openResourceDialog(null); return; }
    const now = snap(Date.now());
    openBookingDialog({ resourceId: state.resources[0].id, start: now, end: now + HOUR_MS });
  });

  // Co-booker input
  const coEntry = document.getElementById("cobooker-entry");
  coEntry.addEventListener("keydown", (e) => {
    if ((e.key === "Enter" || e.key === ",") && coEntry.value.trim()) {
      e.preventDefault();
      addChip(coEntry.value.trim());
      coEntry.value = "";
    } else if (e.key === "Backspace" && !coEntry.value) {
      const chips = document.getElementById("cobooker-chips");
      chips.lastElementChild?.remove();
    }
  });

  // Close buttons
  document.querySelectorAll("[data-close]").forEach((btn) => {
    btn.addEventListener("click", () => btn.closest("dialog").close());
  });

  // Escape clears ghost drags + closes via dialog.close default
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      document.querySelectorAll(".booking.ghost").forEach((g) => g.remove());
    }
  });

  // Boot
  if (!state.user) {
    nameDialog.showModal();
  }
  loadState().then(scrollToNow);
  connectSSE();

  // Refresh now-line periodically
  setInterval(() => {
    const line = document.querySelector(".now-line");
    if (!line) return;
    const nowOffset = (Date.now() - state.viewStart) / HOUR_MS * hourWidth();
    line.style.left = `${nowOffset}px`;
  }, 60_000);
}

function connectSSE() {
  const es = new EventSource("/api/events");

  function normalizeBooking(b) {
    return { ...b, start: new Date(b.start).getTime(), end: new Date(b.end).getTime() };
  }

  es.addEventListener("booking:add", (e) => {
    const b = normalizeBooking(JSON.parse(e.data));
    if (!state.bookings.some((x) => x.id === b.id)) {
      state.bookings.push(b);
      renderTimeline();
    }
  });

  es.addEventListener("booking:update", (e) => {
    const b = normalizeBooking(JSON.parse(e.data));
    const idx = state.bookings.findIndex((x) => x.id === b.id);
    if (idx >= 0) {
      state.bookings[idx] = b;
      renderTimeline();
    }
  });

  es.addEventListener("booking:delete", (e) => {
    const { id } = JSON.parse(e.data);
    const idx = state.bookings.findIndex((x) => x.id === id);
    if (idx >= 0) {
      state.bookings.splice(idx, 1);
      renderTimeline();
    }
  });
}

let navAnimating = false;
async function navigate(direction) {
  if (navAnimating) return;
  navAnimating = true;
  const header = document.getElementById("timeline-header");
  const body = document.getElementById("timeline-body");
  const dx = direction > 0 ? -48 : 48;

  const outOpts = { duration: 140, easing: "cubic-bezier(0.4, 0, 1, 1)", fill: "forwards" };
  const outKf = [{ transform: "translateX(0)", opacity: 1 }, { transform: `translateX(${dx}px)`, opacity: 0 }];
  const outAnims = [header.animate(outKf, outOpts), body.animate(outKf, outOpts)];
  await Promise.all(outAnims.map((a) => a.finished));

  state.viewStart = addDays(state.viewStart, direction * daysVisible());
  render();

  const inOpts = { duration: 200, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" };
  const inKf = [{ transform: `translateX(${-dx}px)`, opacity: 0 }, { transform: "translateX(0)", opacity: 1 }];
  const inAnims = [header.animate(inKf, inOpts), body.animate(inKf, inOpts)];
  await Promise.all(inAnims.map((a) => a.finished));

  outAnims.forEach((a) => a.cancel());
  navAnimating = false;
}

function scrollToNow() {
  const tl = document.getElementById("timeline");
  if (!tl) return;
  const nowOffset = (Date.now() - state.viewStart) / HOUR_MS * hourWidth();
  tl.scrollTo({ left: Math.max(0, nowOffset - tl.clientWidth * 0.3), behavior: "smooth" });
}

init();
