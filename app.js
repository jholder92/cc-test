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
  expandedDate: null, // which day-row's breakdown is open in Week view
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

function round1(n) {
  return Math.round(n * 10) / 10;
}

function formatKm(km) {
  return String(round1(km));
}

function escapeHTML(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
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

// ---------- workout breakdown parser ----------
// The JSON has no separate structured-intervals field — only a `workout` string,
// a `note`, and the day's total km. Everything below is derived from those three
// things. Anything not literally stated in the plan (e.g. how a leftover distance
// splits between warm-up and cool-down) is left unsplit and flagged as such.

function parseWorkout(day, plan) {
  if (!day.workout) return null;
  const text = day.workout.trim();
  const note = day.note || "";

  let m;

  // Hill sprints + strides combo
  if ((m = text.match(/^(\d+)(?:-(\d+))?x(\d+)\s*sec\s*hill sprints\s*\+\s*(\d+)x(\d+)m\s*strides$/i))) {
    const [, lo, hi, sec, strideReps, strideDist] = m;
    const hillReps = hi ? `${lo}-${hi}` : lo;
    return {
      kind: "accessory",
      steps: [
        { tag: "Hills", body: `${hillReps} × ${sec} sec @ max effort`, note: plan.paces.hills.note },
        { tag: "Strides", body: `${strideReps} × ${strideDist}m @ ${plan.paces.strides.range}`, note: plan.paces.strides.note },
      ],
      accessoryKm: (Number(hi || lo) * 0.05) + (Number(strideReps) * Number(strideDist)) / 1000,
    };
  }

  // Strides only
  if ((m = text.match(/^(\d+)x(\d+)m\s*strides$/i))) {
    const [, reps, dist] = m;
    return {
      kind: "accessory",
      steps: [{ tag: "Strides", body: `${reps} × ${dist}m @ ${plan.paces.strides.range}`, note: plan.paces.strides.note }],
      accessoryKm: (Number(reps) * Number(dist)) / 1000,
    };
  }

  // Reps x km @ pace, e.g. "6x1 km @ 3:54-4:00"
  if ((m = text.match(/^(\d+)x([\d.]+)\s*km\s*@\s*([\d:]+-[\d:]+)$/i))) {
    const [, reps, dist, pace] = m;
    return buildIntervalBreakdown(day, plan, note, {
      reps: Number(reps),
      distanceLabel: `${dist} km`,
      distanceKm: Number(dist),
      pace,
    });
  }

  // Reps x meters @ pace, e.g. "5x600 @ 3:52-3:58" (track intervals, meters implied)
  if ((m = text.match(/^(\d+)x(\d+)\s*@\s*([\d:]+-[\d:]+)$/i))) {
    const [, reps, meters, pace] = m;
    return buildIntervalBreakdown(day, plan, note, {
      reps: Number(reps),
      distanceLabel: `${meters}m`,
      distanceKm: Number(meters) / 1000,
      pace,
    });
  }

  // Continuous distance @ pace, e.g. "23 km @ MP* 4:04-4:13" or "3 km @ MP*"
  if ((m = text.match(/^([\d.]+)\s*km\s*@\s*(MP\*?\s*)?([\d:]+-[\d:]+)?$/i))) {
    const [, dist, mpFlag, pace] = m;
    const paceLabel = pace || (mpFlag ? plan.paces.mp.range : "");
    const distanceKm = Number(dist);
    const remainder = Math.max(0, round1(day.km - distanceKm));
    return {
      kind: "continuous-distance",
      steps: [
        remainder > 0 ? { tag: "Easy", body: `≈ ${remainder} km easy (warm-up + cool-down, not split in the plan)` } : null,
        { tag: "Main set", body: `${dist} km continuous @ ${paceLabel}${mpFlag ? " (MP*)" : ""}` },
      ].filter(Boolean),
      caveat: remainder > 0 ? "Warm-up/cool-down split is your call — the plan gives the total only." : null,
    };
  }

  // Continuous duration @ pace, e.g. "20-25' @ 4:10-4:16"
  if ((m = text.match(/^(\d+)-(\d+)'\s*@\s*([\d:]+-[\d:]+)$/i))) {
    const [, lo, hi, pace] = m;
    const approx = note.match(/about\s+([\d.]+)(?:-([\d.]+))?\s*km/i);
    const approxLabel = approx ? `≈ ${approx[1]}${approx[2] ? "-" + approx[2] : ""} km at this effort` : null;
    return {
      kind: "continuous-duration",
      steps: [
        { tag: "Main set", body: `${lo}-${hi} min continuous @ ${pace}`, note: approxLabel },
      ],
      caveat: `Total session is ${formatKm(day.km)} km including warm-up/cool-down — the plan doesn't split out how much is tempo.`,
    };
  }

  return { kind: "raw", steps: [{ tag: "Workout", body: text }] };
}

function buildIntervalBreakdown(day, plan, note, { reps, distanceLabel, distanceKm, pace }) {
  const recoveryMatch = note.match(/Jog[^—]*/i);
  const recovery = recoveryMatch ? recoveryMatch[0].trim().replace(/[.,;]+$/, "") : null;

  const mainKm = reps * distanceKm;
  const remainder = Math.max(0, round1(day.km - mainKm));

  const steps = [];
  if (remainder > 0) {
    steps.push({ tag: "Easy", body: `≈ ${remainder} km easy (warm-up + cool-down, not split in the plan)` });
  }
  steps.push({
    tag: "Main set",
    body: `${reps} × ${distanceLabel} @ ${pace}`,
    note: recovery ? `Recovery: ${recovery}` : null,
  });

  return {
    kind: "intervals",
    steps,
    caveat: remainder > 0 ? "Warm-up/cool-down split is your call — the plan gives the total only." : null,
  };
}

function renderBreakdownHTML(parsed) {
  if (!parsed) return "";
  const stepsHTML = parsed.steps
    .map(
      (s) => `
      <div class="breakdown-step">
        <span class="step-tag">${escapeHTML(s.tag)}</span>
        <span class="step-body">${s.body}${s.note ? `<span class="step-note">${escapeHTML(s.note)}</span>` : ""}</span>
      </div>`
    )
    .join("");
  const caveat = parsed.caveat ? `<div class="breakdown-caveat">${escapeHTML(parsed.caveat)}</div>` : "";
  return stepsHTML + caveat;
}

// ---------- rendering: Today ----------

function renderToday() {
  const entry = findEntry(state.highlightISO) || findNearestEntry(state.highlightISO);
  if (!entry) return;

  const isNearestFallback = entry.date !== state.todayISO;
  $("today-weekday").textContent = isNearestFallback ? "Nearest" : weekdayName(state.todayISO);
  $("today-date").textContent = isNearestFallback
    ? `${prettyDate(entry.date)} — today is ${prettyDate(state.todayISO)}`
    : prettyDate(state.todayISO);

  const day = entry.day;
  const role = roleFor(day.type);
  const hero = $("today-hero");
  hero.className = "hero";
  hero.classList.toggle("is-weighted", WEIGHTED_TYPES.has(day.type));
  hero.classList.toggle("is-quiet", QUIET_TYPES.has(day.type));
  hero.classList.toggle("is-done", isDone(entry.date));

  const dot = $("today-dot");
  setRoleClass(dot, role);
  const typeLabel = $("today-type-label");
  setRoleClass(typeLabel, role);
  typeLabel.textContent = labelFor(day.type);

  $("today-title").textContent = day.title;

  const kmEl = $("today-km");
  kmEl.innerHTML = day.km ? `${formatKm(day.km)}<span>km</span>` : "—";

  const paceStat = $("today-pace-stat");
  if (day.pace) {
    $("today-pace").textContent = day.pace;
    paceStat.hidden = false;
  } else {
    paceStat.hidden = true;
  }

  const workoutBox = $("today-workout-box");
  const parsed = parseWorkout(day, state.plan);
  if (parsed) {
    workoutBox.hidden = false;
    $("today-workout").textContent = day.workout;
    $("today-breakdown").innerHTML = renderBreakdownHTML(parsed);
  } else {
    workoutBox.hidden = true;
  }
  $("today-breakdown").hidden = true;
  $("today-workout-toggle").setAttribute("aria-expanded", "false");

  const noteEl = $("today-note");
  if (day.note) {
    noteEl.textContent = day.note;
    noteEl.hidden = false;
  } else {
    noteEl.hidden = true;
  }

  $("today-done-label").textContent = isDone(entry.date) ? "Done" : "Mark done";
  $("today-done-box").textContent = isDone(entry.date) ? "×" : "";

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

function renderTomorrow(fromISO) {
  const nextISO = shiftISO(fromISO, 1);
  const entry = findEntry(nextISO);

  if (!entry) {
    $("tomorrow-day").textContent = "—";
    $("tomorrow-dot").className = "dot";
    $("tomorrow-title").textContent = "Outside plan range";
    $("tomorrow-pace").textContent = "";
    $("tomorrow-km").textContent = "";
    return;
  }

  const day = entry.day;
  const role = roleFor(day.type);
  $("tomorrow-day").textContent = day.day;
  setRoleClass($("tomorrow-dot"), role);
  $("tomorrow-title").textContent = day.title;
  $("tomorrow-pace").textContent = day.workout || day.pace || "";
  $("tomorrow-km").textContent = day.km ? `${formatKm(day.km)} km` : "";
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
  $("week-remaining-km").textContent = formatKm(remaining);
  $("week-total-km").textContent = formatKm(week.total_km);
}

// ---------- rendering: Week ----------

function renderWeek() {
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
  week.days.forEach((day) => list.appendChild(buildDayRow(day)));

  $("week-prev").disabled = state.currentWeekIndex <= 0;
  $("week-next").disabled = state.currentWeekIndex >= state.plan.weeks.length - 1;
}

function buildDayRow(day) {
  const role = roleFor(day.type);
  const wrap = document.createElement("div");
  wrap.className = "day-row role-" + role;
  wrap.dataset.date = day.date;
  if (QUIET_TYPES.has(day.type)) wrap.classList.add("is-quiet");
  if (WEIGHTED_TYPES.has(day.type)) wrap.classList.add("is-weighted");
  if (isDone(day.date)) wrap.classList.add("is-done");
  if (day.date === state.highlightISO) wrap.classList.add("is-today");

  const note = getNote(day.date);
  const sub = day.workout || day.pace || "";
  const parsed = parseWorkout(day, state.plan);
  const isExpanded = state.expandedDate === day.date;

  wrap.innerHTML = `
    <div class="day-col-date">
      <div class="dow">${day.day}</div>
      <div class="dom num">${dayOfMonth(day.date)}</div>
    </div>
    <div class="day-col-main">
      <span class="dot"></span>
      <span class="title">${escapeHTML(day.title)}${note ? " ✎" : ""}</span>
      <span class="sub">${escapeHTML(sub)}</span>
    </div>
    <div class="day-col-km num">${day.km ? formatKm(day.km) : "—"}<span>km</span></div>
    <button class="day-expand-btn" aria-expanded="${isExpanded}" ${parsed ? "" : "disabled"} aria-label="Show workout breakdown">+</button>
    <div class="day-row-detail" ${isExpanded && parsed ? "" : "hidden"}>${parsed ? renderBreakdownHTML(parsed) : ""}</div>
  `;

  const dot = wrap.querySelector(".day-col-main .dot");
  setRoleClass(dot, role);

  const expandBtn = wrap.querySelector(".day-expand-btn");
  if (parsed) {
    expandBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      state.expandedDate = isExpanded ? null : day.date;
      renderWeek();
    });
  }

  attachPressHandlers(wrap, day.date);
  return wrap;
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
    if (e.target.closest("button, .day-row-detail")) return;
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
    if (Math.abs(e.clientX - startX) > 10 || Math.abs(e.clientY - startY) > 10) clearTimer();
  });

  row.addEventListener("pointerup", (e) => {
    clearTimer();
    if (e.target.closest("button, .day-row-detail")) return;
    if (!longPressed) toggleDone(iso);
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
    <p class="gate-note">${escapeHTML(gate.note)}</p>
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
  const featured = findEntry(state.highlightISO) || {};
  if (state.activeView === "today" && iso === featured.date) {
    $("today-note-input").value = getNote(iso);
    $("today-note-editor").hidden = false;
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
  document.querySelectorAll("#pillnav button").forEach((b) => {
    b.setAttribute("aria-current", String(b.dataset.target === name));
  });
  if (name === "week") renderWeek();
  if (name === "block") renderBlock();
  if (name === "reference") renderReference();
}

function wireEvents() {
  $("pillnav").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-target]");
    if (btn) switchView(btn.dataset.target);
  });

  $("today-hero").addEventListener("click", (e) => {
    if (e.target.closest("button, textarea, .workout-box")) return;
    toggleDone(state.noteTargetISO);
  });

  $("today-done-toggle").addEventListener("click", (e) => {
    e.stopPropagation();
    toggleDone(state.noteTargetISO);
  });

  $("today-workout-toggle").addEventListener("click", (e) => {
    e.stopPropagation();
    const btn = e.currentTarget;
    const expanded = btn.getAttribute("aria-expanded") === "true";
    btn.setAttribute("aria-expanded", String(!expanded));
    $("today-breakdown").hidden = expanded;
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
      state.expandedDate = null;
      renderWeek();
    }
  });
  $("week-next").addEventListener("click", () => {
    if (state.currentWeekIndex < state.plan.weeks.length - 1) {
      state.currentWeekIndex++;
      state.expandedDate = null;
      renderWeek();
    }
  });

  const track = $("week-track");
  let swipeStartX = null;
  let swipeStartY = null;
  track.addEventListener("pointerdown", (e) => {
    if (e.target.closest(".day-row")) return;
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
  if (d > 0) el.innerHTML = `<strong>${d}</strong> days<br>to Valencia`;
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
