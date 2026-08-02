// Valencia 2026 training plan — reads valencia-plan.json at runtime.
// No hardcoded session data lives here; everything below derives from the fetched plan.

const STORE_PREFIX = "vp:";
const ROLE_CLASS_RE = /\brole-[a-z_]+\b/g;
const QUIET_TYPES = new Set(["rest", "recovery", "shakeout"]);
const WEIGHTED_TYPES = new Set(["mp", "race"]);

const state = {
  plan: null,
  days: [],          // flattened { date, week, day } across all weeks, in order
  todayISO: null,     // device "today" as YYYY-MM-DD
  highlightISO: null, // the plan date actually featured (== todayISO, or nearest if out of range)
  currentWeekIndex: 0,
  activeView: "today",
  noteTargetISO: null,
};

const $ = (id) => document.getElementById(id);

function todayISOLocal() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseISO(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function daysBetween(isoA, isoB) {
  const ms = parseISO(isoB) - parseISO(isoA);
  return Math.round(ms / 86400000);
}

function weekdayName(iso) {
  return parseISO(iso).toLocaleDateString(undefined, { weekday: "long" });
}

function prettyDate(iso) {
  return parseISO(iso).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
}

function dayOfMonth(iso) {
  return parseISO(iso).getDate();
}

// ---------- localStorage ----------

function isDone(iso) {
  return localStorage.getItem(STORE_PREFIX + "done:" + iso) === "1";
}

function setDone(iso, done) {
  const key = STORE_PREFIX + "done:" + iso;
  if (done) localStorage.setItem(key, "1");
  else localStorage.removeItem(key);
}

function getNote(iso) {
  return localStorage.getItem(STORE_PREFIX + "note:" + iso) || "";
}

function setNote(iso, text) {
  const key = STORE_PREFIX + "note:" + iso;
  if (text && text.trim()) localStorage.setItem(key, text);
  else localStorage.removeItem(key);
}

// ---------- data ----------

async function loadPlan() {
  const res = await fetch("valencia-plan.json", { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to load plan: " + res.status);
  return res.json();
}

function flatten(plan) {
  const out = [];
  plan.weeks.forEach((week, wIdx) => {
    week.days.forEach((day) => {
      out.push({ date: day.date, week, weekIndex: wIdx, day });
    });
  });
  out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return out;
}

function findEntry(iso) {
  return state.days.find((e) => e.date === iso);
}

function findNearestEntry(iso) {
  let best = null;
  let bestDist = Infinity;
  for (const e of state.days) {
    const dist = Math.abs(daysBetween(iso, e.date));
    if (dist < bestDist) {
      bestDist = dist;
      best = e;
    }
  }
  return best;
}

function roleFor(type) {
  const st = state.plan.session_types[type];
  return (st && st.color_role) || "neutral";
}

function labelFor(type) {
  const st = state.plan.session_types[type];
  return (st && st.label) || type;
}

function setRoleClass(el, role) {
  el.className = el.className.replace(ROLE_CLASS_RE, "").trim();
  el.classList.add("role-" + role);
}

// ---------- rendering: Today ----------

function renderToday() {
  const entry = findEntry(state.highlightISO) || findNearestEntry(state.highlightISO);
  if (!entry) return;

  const isNearestFallback = entry.date !== state.todayISO;
  $("today-weekday").textContent = isNearestFallback ? "Nearest session" : weekdayName(state.todayISO);
  $("today-date").textContent = isNearestFallback
    ? `${prettyDate(entry.date)} — today is ${prettyDate(state.todayISO)}`
    : prettyDate(state.todayISO);

  const day = entry.day;
  const role = roleFor(day.type);
  const hero = $("today-hero");
  setRoleClass(hero, role);
  hero.classList.toggle("is-weighted", WEIGHTED_TYPES.has(day.type));
  hero.classList.toggle("is-quiet", QUIET_TYPES.has(day.type));
  hero.classList.toggle("is-done", isDone(entry.date));

  const pill = $("today-pill");
  setRoleClass(pill, role);
  pill.textContent = labelFor(day.type);

  $("today-title").textContent = day.title;

  const kmEl = $("today-km");
  if (day.km) {
    kmEl.innerHTML = `${formatKm(day.km)}<span>km</span>`;
  } else {
    kmEl.textContent = "—";
  }

  const paceEl = $("today-pace");
  if (day.pace) {
    paceEl.innerHTML = `<span class="label">Pace</span>${escapeHTML(day.pace)}`;
    paceEl.hidden = false;
  } else {
    paceEl.innerHTML = "";
    paceEl.hidden = true;
  }

  const workoutEl = $("today-workout");
  if (day.workout) {
    workoutEl.textContent = day.workout;
    workoutEl.hidden = false;
  } else {
    workoutEl.hidden = true;
  }

  const noteEl = $("today-note");
  if (day.note) {
    noteEl.textContent = day.note;
    noteEl.hidden = false;
  } else {
    noteEl.hidden = true;
  }

  $("today-done-label").textContent = isDone(entry.date) ? "Done" : "Mark done";

  const savedNote = getNote(entry.date);
  const noteDisplay = $("today-note-display");
  if (savedNote) {
    noteDisplay.textContent = "Your note: " + savedNote;
    noteDisplay.hidden = false;
  } else {
    noteDisplay.hidden = true;
  }

  state.noteTargetISO = entry.date;
  closeNoteEditor();

  renderTomorrow(entry.date);
  renderWeekRemaining(entry);

  state.currentWeekIndex = entry.weekIndex;
}

function formatKm(km) {
  return Number.isInteger(km) ? String(km) : String(km);
}

function escapeHTML(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

function renderTomorrow(fromISO) {
  const nextISO = shiftISO(fromISO, 1);
  const entry = findEntry(nextISO);
  const row = $("tomorrow-row");

  if (!entry) {
    $("tomorrow-day").textContent = "—";
    $("tomorrow-pill").textContent = "";
    $("tomorrow-pill").className = "pill";
    $("tomorrow-title").textContent = "Outside plan range";
    $("tomorrow-pace").textContent = "";
    $("tomorrow-km").textContent = "";
    return;
  }

  const day = entry.day;
  const role = roleFor(day.type);
  $("tomorrow-day").textContent = day.day;
  const pill = $("tomorrow-pill");
  setRoleClass(pill, role);
  pill.textContent = labelFor(day.type);
  $("tomorrow-title").textContent = day.title;
  $("tomorrow-pace").textContent = day.workout || day.pace || "";
  $("tomorrow-km").textContent = day.km ? `${formatKm(day.km)} km` : "";
  row.classList.toggle("is-done", isDone(entry.date));
}

function shiftISO(iso, deltaDays) {
  const d = parseISO(iso);
  d.setDate(d.getDate() + deltaDays);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function renderWeekRemaining(entry) {
  const week = entry.week;
  const remaining = week.days
    .filter((d) => d.date > entry.date)
    .reduce((sum, d) => sum + (d.km || 0), 0);
  $("week-remaining-km").textContent = formatKm(round1(remaining));
  $("week-total-km").textContent = formatKm(week.total_km);
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

// ---------- rendering: Week ----------

function renderWeek(direction) {
  const week = state.plan.weeks[state.currentWeekIndex];
  if (!week) return;

  $("week-label").textContent = week.label;
  $("week-block").textContent = week.block;
  $("week-stat-km").textContent = formatKm(week.total_km) + " km";
  $("week-stat-book").textContent = week.book_range || "—";

  const headlineEl = $("week-headline");
  if (week.headline) {
    headlineEl.textContent = week.headline;
    headlineEl.hidden = false;
  } else {
    headlineEl.hidden = true;
  }

  const list = $("week-days");
  list.innerHTML = "";
  week.days.forEach((day) => {
    list.appendChild(buildDayRow(day));
  });

  $("week-prev").disabled = state.currentWeekIndex <= 0;
  $("week-next").disabled = state.currentWeekIndex >= state.plan.weeks.length - 1;

  const track = $("week-track");
  if (direction) {
    track.classList.remove("sliding-left", "sliding-right");
    // force reflow so the animation restarts
    void track.offsetWidth;
    track.classList.add(direction > 0 ? "sliding-left" : "sliding-right");
  }
}

function buildDayRow(day) {
  const role = roleFor(day.type);
  const row = document.createElement("div");
  row.className = "day-row role-" + role;
  row.dataset.date = day.date;
  if (QUIET_TYPES.has(day.type)) row.classList.add("is-quiet");
  if (isDone(day.date)) row.classList.add("is-done");
  if (day.date === state.highlightISO) row.classList.add("is-today");

  const note = getNote(day.date);
  const sub = day.workout || day.pace || "";

  row.innerHTML = `
    <div class="day-col-date">
      <div class="dow">${day.day}</div>
      <div class="dom num">${dayOfMonth(day.date)}</div>
    </div>
    <div class="day-col-main">
      <p class="title">${escapeHTML(day.title)}${note ? " ✎" : ""}</p>
      <p class="sub">${escapeHTML(sub)}</p>
    </div>
    <div class="day-col-km num">${day.km ? formatKm(day.km) : "—"}<span>km</span></div>
  `;

  attachPressHandlers(row, day.date);
  return row;
}

function attachPressHandlers(row, iso) {
  let pressTimer = null;
  let longPressed = false;
  let startX = 0, startY = 0;

  const clearTimer = () => {
    if (pressTimer) {
      clearTimeout(pressTimer);
      pressTimer = null;
    }
  };

  row.addEventListener("pointerdown", (e) => {
    longPressed = false;
    startX = e.clientX;
    startY = e.clientY;
    pressTimer = setTimeout(() => {
      longPressed = true;
      openNoteEditorFor(iso);
    }, 480);
  });

  row.addEventListener("pointermove", (e) => {
    if (!pressTimer) return;
    if (Math.abs(e.clientX - startX) > 10 || Math.abs(e.clientY - startY) > 10) {
      clearTimer();
    }
  });

  row.addEventListener("pointerup", () => {
    clearTimer();
    if (!longPressed) {
      toggleDone(iso);
    }
  });

  row.addEventListener("pointercancel", clearTimer);
}

// ---------- rendering: Block ----------

function renderBlock() {
  const list = $("block-list");
  list.innerHTML = "";
  const maxKm = Math.max(...state.plan.weeks.map((w) => w.total_km));

  state.plan.weeks.forEach((week, idx) => {
    const row = document.createElement("div");
    row.className = "block-row";
    if (idx === state.currentWeekIndex) row.classList.add("is-current");

    const pct = Math.max(4, Math.round((week.total_km / maxKm) * 100));
    row.innerHTML = `
      <div class="block-row-top">
        <span><span class="wk-label">${escapeHTML(week.label)}</span><span class="wk-block">${escapeHTML(week.block || "")}</span></span>
        <span class="wk-km num">${formatKm(week.total_km)} km</span>
      </div>
      <div class="vol-bar"><i style="width:${pct}%"></i></div>
      <div class="block-row-foot">
        <span>${escapeHTML(week.start)} – ${escapeHTML(week.end)}</span>
        <span>${escapeHTML(week.book_range || "—")}</span>
      </div>
      ${week.headline ? `<div class="block-row-headline">${escapeHTML(week.headline)}</div>` : ""}
    `;
    row.addEventListener("click", () => {
      state.currentWeekIndex = idx;
      switchView("week");
      renderWeek();
    });
    list.appendChild(row);
  });
}

// ---------- rendering: Reference ----------

function renderReference() {
  const paces = $("ref-paces");
  paces.innerHTML = "";
  Object.values(state.plan.paces).forEach((p) => {
    const row = document.createElement("div");
    row.className = "pace-row-wrap";
    row.innerHTML = `
      <div class="pace-top">
        <span class="pace-name">${escapeHTML(p.label)}</span>
        <span class="pace-range num">${escapeHTML(p.range)}${p.hr ? " · HR " + escapeHTML(p.hr) : ""}${p.hr_ceiling ? " · HR ≤" + p.hr_ceiling : ""}</span>
      </div>
      ${p.note ? `<div class="pace-note">${escapeHTML(p.note)}</div>` : ""}
    `;
    paces.appendChild(row);
  });

  const gate = state.plan.gate;
  const gateEl = $("ref-gate");
  gateEl.innerHTML = `
    <p class="pace-note" style="margin-bottom:10px">${escapeHTML(gate.note)}</p>
    ${gate.bands.map((b) => `
      <div class="gate-band">
        <div class="result num">${escapeHTML(b.result)}</div>
        <div class="reads">${escapeHTML(b.reads_as)}</div>
        <div class="mp-after num">MP after: ${escapeHTML(b.mp_after)}</div>
      </div>
    `).join("")}
    <div class="gate-confirmation">${escapeHTML(gate.confirmation)}</div>
  `;

  const rules = $("ref-rules");
  rules.innerHTML = "";
  state.plan.rules.forEach((r) => {
    const li = document.createElement("li");
    li.textContent = r;
    rules.appendChild(li);
  });
}

// ---------- interactions ----------

function toggleDone(iso) {
  setDone(iso, !isDone(iso));
  renderToday();
  renderWeek();
}

function openNoteEditorFor(iso) {
  state.noteTargetISO = iso;
  const editor = $("today-note-editor");
  if (state.activeView === "today" && iso === (findEntry(state.highlightISO) || {}).date) {
    $("today-note-input").value = getNote(iso);
    editor.hidden = false;
    $("today-note-input").focus();
  } else {
    const existing = getNote(iso);
    const text = window.prompt(`Note for ${prettyDate(iso)}:`, existing);
    if (text !== null) {
      setNote(iso, text);
      renderWeek();
      if (iso === state.highlightISO) renderToday();
    }
  }
}

function closeNoteEditor() {
  $("today-note-editor").hidden = true;
}

function switchView(name) {
  state.activeView = name;
  document.querySelectorAll(".view").forEach((v) => {
    v.hidden = v.dataset.view !== name;
  });
  document.querySelectorAll("#tabbar button").forEach((b) => {
    b.setAttribute("aria-current", String(b.dataset.target === name));
  });
  if (name === "week") renderWeek();
  if (name === "block") renderBlock();
  if (name === "reference") renderReference();
}

function wireEvents() {
  $("tabbar").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-target]");
    if (btn) switchView(btn.dataset.target);
  });

  $("today-hero").addEventListener("click", (e) => {
    if (e.target.closest("button, textarea, .note-editor")) return;
    toggleDone(state.noteTargetISO);
  });

  $("today-done-toggle").addEventListener("click", (e) => {
    e.stopPropagation();
    toggleDone(state.noteTargetISO);
  });

  $("today-note-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    $("today-note-input").value = getNote(state.noteTargetISO);
    $("today-note-editor").hidden = false;
    $("today-note-input").focus();
  });

  $("today-note-cancel").addEventListener("click", (e) => {
    e.stopPropagation();
    closeNoteEditor();
  });

  $("today-note-save").addEventListener("click", (e) => {
    e.stopPropagation();
    setNote(state.noteTargetISO, $("today-note-input").value);
    closeNoteEditor();
    renderToday();
  });

  $("week-prev").addEventListener("click", () => {
    if (state.currentWeekIndex > 0) {
      state.currentWeekIndex--;
      renderWeek(-1);
    }
  });
  $("week-next").addEventListener("click", () => {
    if (state.currentWeekIndex < state.plan.weeks.length - 1) {
      state.currentWeekIndex++;
      renderWeek(1);
    }
  });

  const track = $("week-track");
  let swipeStartX = null;
  let swipeStartY = null;
  track.addEventListener("pointerdown", (e) => {
    if (e.target.closest(".day-row")) return; // let row press-handlers own it
    swipeStartX = e.clientX;
    swipeStartY = e.clientY;
  });
  track.addEventListener("pointerup", (e) => {
    if (swipeStartX === null) return;
    const dx = e.clientX - swipeStartX;
    const dy = e.clientY - swipeStartY;
    swipeStartX = null;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      if (dx < 0) $("week-next").click();
      else $("week-prev").click();
    }
  });

  window.addEventListener("online", updateOfflineBanner);
  window.addEventListener("offline", updateOfflineBanner);
}

function updateOfflineBanner() {
  $("offline-banner").classList.toggle("is-visible", !navigator.onLine);
}

function renderCountdown() {
  const raceISO = state.plan.meta.race.date;
  const d = daysBetween(state.todayISO, raceISO);
  const el = $("race-countdown");
  if (d > 0) el.innerHTML = `<strong>${d}</strong>d to Valencia`;
  else if (d === 0) el.innerHTML = `<strong>Race day</strong>`;
  else el.innerHTML = `<strong>Done</strong>`;
}

// ---------- boot ----------

async function boot() {
  state.todayISO = todayISOLocal();
  state.highlightISO = state.todayISO;

  try {
    state.plan = await loadPlan();
  } catch (err) {
    $("today-title").textContent = "Couldn't load the plan";
    $("today-note").textContent = String(err.message || err);
    $("today-note").hidden = false;
    return;
  }

  state.days = flatten(state.plan);
  const exact = findEntry(state.todayISO);
  const featured = exact || findNearestEntry(state.todayISO);
  state.highlightISO = featured ? featured.date : state.todayISO;
  state.currentWeekIndex = featured ? featured.weekIndex : 0;

  renderCountdown();
  renderToday();
  wireEvents();
  updateOfflineBanner();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}

boot();
