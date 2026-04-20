// Boo — resource availability calendar (vanilla ES module)

const DAYS_VISIBLE = 14;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const SNAP_MIN = 30;
const SNAP_MS = SNAP_MIN * 60 * 1000;

const PALETTE = [
  "#6366f1", "#8b5cf6", "#ec4899", "#ef4444", "#f59e0b",
  "#10b981", "#14b8a6", "#0ea5e9", "#64748b", "#a855f7",
];
const ICONS = [
  "flask", "server", "cpu", "wifi", "rocket",
  "phone", "car", "camera", "bolt", "user",
];

const state = {
  resources: [],
  bookings: [],
  viewStart: startOfDay(Date.now() - 2 * DAY_MS),
  user: localStorage.getItem("booUser") || "",
  editingResourceId: null,
  editingBookingId: null,
  bookingDefaults: null,
};

// ---------- utilities ----------

function startOfDay(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
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
function viewEnd() { return addDays(state.viewStart, DAYS_VISIBLE); }

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
  renderRangeLabel();
  renderResources();
  renderTimeline();
}

function renderRangeLabel() {
  const start = state.viewStart;
  const end = viewEnd() - DAY_MS;
  document.getElementById("range-label").textContent = `${fmtDate(start)} – ${fmtDate(end)}`;
}

function renderResources() {
  const list = document.getElementById("resource-list");
  list.innerHTML = "";
  for (const r of state.resources) {
    const li = document.createElement("li");
    li.className = "resource-item";
    li.dataset.id = r.id;
    li.dataset.name = r.name;
    li.innerHTML = `
      <span class="swatch" style="background:${r.color}"><svg class="icon"><use href="#i-${r.icon}"/></svg></span>
      <span class="meta">
        <span class="name"></span>
        <span class="desc"></span>
      </span>
      <button class="icon-btn ghost edit" aria-label="Edit resource"><svg class="icon"><use href="#i-pencil"/></svg></button>
    `;
    li.querySelector(".name").textContent = r.name;
    li.querySelector(".desc").textContent = r.description || "";
    li.querySelector(".edit").addEventListener("click", (e) => {
      e.stopPropagation();
      openResourceDialog(r);
    });
    li.addEventListener("click", () => openResourceDialog(r));
    list.appendChild(li);
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

  for (let i = 0; i < DAYS_VISIBLE; i++) {
    const dayTs = addDays(state.viewStart, i);
    const d = new Date(dayTs);
    const div = document.createElement("div");
    div.className = "day-head";
    if (d.getDay() === 0 || d.getDay() === 6) div.classList.add("weekend");
    if (dayTs === today) div.classList.add("today");
    div.innerHTML = `
      <span class="dow">${d.toLocaleDateString(undefined, { weekday: "short" })}</span>
      <span class="dom">${d.getDate()}</span>
      <span class="mon muted">${d.toLocaleDateString(undefined, { month: "short" })}</span>
      <span class="hour-marks"></span>
    `;
    header.appendChild(div);
  }

  const totalHours = DAYS_VISIBLE * 24;
  const totalWidth = totalHours * hourWidth();

  for (const res of state.resources) {
    const row = document.createElement("div");
    row.className = "timeline-row";
    row.dataset.resourceId = res.id;
    row.style.width = `${totalWidth}px`;
    row.style.setProperty("--c", res.color);
    row.innerHTML = `<div class="row-grid"></div><div class="row-surface"></div>`;

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
    openBookingDialog({ booking: b });
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
  badge.innerHTML = `<span class="swatch" style="background:${res.color}"><svg class="icon"><use href="#i-${res.icon}"/></svg></span><span>${escapeHtml(res.name)}</span>`;
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

  dialog.showModal();
  setTimeout(() => form.name.focus(), 40);
}

function renderSwatches(selected) {
  const el = document.getElementById("color-swatches");
  el.innerHTML = "";
  el.dataset.selected = selected;
  for (const color of PALETTE) {
    const b = document.createElement("button");
    b.type = "button";
    b.style.setProperty("--sw", color);
    b.setAttribute("aria-pressed", String(color === selected));
    b.addEventListener("click", () => {
      el.dataset.selected = color;
      el.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    });
    el.appendChild(b);
  }
}

function renderIconPicker(selected) {
  const el = document.getElementById("icon-picker");
  el.innerHTML = "";
  el.dataset.selected = selected;
  for (const icon of ICONS) {
    const b = document.createElement("button");
    b.type = "button";
    b.setAttribute("aria-pressed", String(icon === selected));
    b.innerHTML = `<svg class="icon"><use href="#i-${icon}"/></svg>`;
    b.addEventListener("click", () => {
      el.dataset.selected = icon;
      el.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    });
    el.appendChild(b);
  }
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

// ---------- form submission ----------

async function submitResource(e) {
  e.preventDefault();
  const form = e.target;
  const color = document.getElementById("color-swatches").dataset.selected;
  const icon = document.getElementById("icon-picker").dataset.selected;
  const body = {
    name: form.name.value.trim(),
    description: form.description.value.trim(),
    color, icon,
  };
  try {
    if (state.editingResourceId) {
      await api("PATCH", `/api/resources/${state.editingResourceId}`, body);
      toast("Resource updated");
    } else {
      await api("POST", "/api/resources", body);
      toast("Resource added");
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
  document.getElementById("prev").addEventListener("click", () => {
    state.viewStart = addDays(state.viewStart, -7);
    render();
  });
  document.getElementById("next").addEventListener("click", () => {
    state.viewStart = addDays(state.viewStart, 7);
    render();
  });
  document.getElementById("today").addEventListener("click", () => {
    state.viewStart = startOfDay(Date.now() - 2 * DAY_MS);
    render();
    scrollToNow();
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

  // Resources
  document.getElementById("add-resource").addEventListener("click", () => openResourceDialog(null));
  document.getElementById("empty-add").addEventListener("click", () => openResourceDialog(null));
  document.getElementById("resource-form").addEventListener("submit", submitResource);
  document.getElementById("resource-delete").addEventListener("click", deleteResource);

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

  // Refresh now-line periodically
  setInterval(() => {
    const line = document.querySelector(".now-line");
    if (!line) return;
    const nowOffset = (Date.now() - state.viewStart) / HOUR_MS * hourWidth();
    line.style.left = `${nowOffset}px`;
  }, 60_000);
}

function scrollToNow() {
  const tl = document.getElementById("timeline");
  if (!tl) return;
  const nowOffset = (Date.now() - state.viewStart) / HOUR_MS * hourWidth();
  tl.scrollTo({ left: Math.max(0, nowOffset - tl.clientWidth * 0.3), behavior: "smooth" });
}

init();
