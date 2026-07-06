/*
 * Our Week — UI logic. All data operations go through Store (store.js).
 */

const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const PERSON_COLORS = ["#0ea5e9", "#f97316", "#8b5cf6", "#10b981", "#ef4444", "#eab308"];

let tasks = [];
let weekStart = startOfWeek(new Date());

const $ = (sel) => document.querySelector(sel);

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

/* ---------- dates ---------- */

function startOfWeek(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // back to Monday
  return d;
}

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function dayKey(date) {
  return (
    date.getFullYear() +
    "-" + String(date.getMonth() + 1).padStart(2, "0") +
    "-" + String(date.getDate()).padStart(2, "0")
  );
}

function parseKey(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

const todayKey = () => dayKey(new Date());

function weekLabel() {
  const end = addDays(weekStart, 6);
  const from = MONTHS[weekStart.getMonth()] + " " + weekStart.getDate();
  const to =
    (weekStart.getMonth() === end.getMonth() ? "" : MONTHS[end.getMonth()] + " ") +
    end.getDate();
  const year = end.getFullYear() === new Date().getFullYear() ? "" : ", " + end.getFullYear();
  return `${from} – ${to}${year}`;
}

/* ---------- people ---------- */

function colorFor(email) {
  let hash = 0;
  for (const ch of email) hash = (hash * 31 + ch.charCodeAt(0)) % 997;
  return PERSON_COLORS[hash % PERSON_COLORS.length];
}

const initialOf = (email) => email[0].toUpperCase();

/* ---------- screens ---------- */

function showScreen(name) {
  for (const id of ["screen-loading", "screen-signin", "screen-denied", "app"]) {
    document.getElementById(id).classList.toggle("hidden", id !== name);
  }
}

function onState(state) {
  if (state.mode === "local") {
    $("#local-banner").classList.remove("hidden");
    if (state.status === "ready") showScreen("app");
    return;
  }
  if (state.status === "signedout") showScreen("screen-signin");
  else if (state.status === "denied") showScreen("screen-denied");
  else if (state.status === "ready") {
    renderUser(state.user);
    showScreen("app");
  } else showScreen("screen-loading");
}

function renderUser(user) {
  const area = $("#user-area");
  area.innerHTML = "";
  if (!user) return;
  const dot = el("span", "person-dot", initialOf(user.email));
  dot.style.background = colorFor(user.email);
  dot.title = user.email;
  const signOut = el("button", "btn small", "Sign out");
  signOut.onclick = () => Store.signOut();
  area.append(dot, signOut);
}

/* ---------- rendering ---------- */

function addForm(day) {
  const form = el("form", "add-form");
  const input = el("input", "add-input");
  input.type = "text";
  input.placeholder = "Add a task…";
  input.maxLength = 200;
  form.appendChild(input);
  form.onsubmit = (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    Store.add({ text, day: day || null });
    input.value = "";
  };
  return form;
}

function dayCard(name, sub, key, isToday) {
  const card = el("section", "card day-card" + (isToday ? " today" : ""));
  card.dataset.day = key;
  const head = el("header", "card-head");
  head.append(el("span", "day-name", name), el("span", "day-sub", sub));
  if (isToday) head.appendChild(el("span", "today-pill", "Today"));
  card.append(head, el("ul", "tasks"), addForm(key));
  return card;
}

function renderWeek() {
  const grid = $("#days");
  grid.innerHTML = "";
  for (let i = 0; i < 7; i++) {
    const date = addDays(weekStart, i);
    const key = dayKey(date);
    grid.appendChild(
      dayCard(DAY_NAMES[i], MONTHS[date.getMonth()] + " " + date.getDate(), key, key === todayKey())
    );
  }
  grid.appendChild(dayCard("Anytime", "no particular day", "", false));

  $("#week-label").textContent = weekLabel();
  $("#btn-today").classList.toggle("hidden", dayKey(weekStart) === dayKey(startOfWeek(new Date())));
  renderTasks();
}

function renderTasks() {
  document.querySelectorAll(".day-card").forEach((card) => {
    const key = card.dataset.day; // "" means the Anytime list
    const list = card.querySelector(".tasks");
    const items = tasks
      .filter((t) => (key ? t.day === key : !t.day))
      .sort((a, b) => a.done - b.done || a.createdAt - b.createdAt);
    list.innerHTML = "";
    for (const t of items) list.appendChild(taskRow(t));
    card.classList.toggle("empty", items.length === 0);
  });
}

function taskRow(t) {
  const li = el("li", "task" + (t.done ? " done" : ""));

  const main = el("label", "task-main");
  const checkbox = el("input");
  checkbox.type = "checkbox";
  checkbox.checked = !!t.done;
  checkbox.onchange = () => Store.update(t.id, { done: checkbox.checked });
  main.append(checkbox, el("span", "task-text", t.text));

  if (Store.mode === "cloud" && t.createdBy) {
    const dot = el("span", "person-dot small", initialOf(t.createdBy));
    dot.style.background = colorFor(t.createdBy);
    dot.title = "Added by " + t.createdBy;
    main.appendChild(dot);
  }

  const move = el("button", "btn ghost", "→");
  move.title = t.day ? "Move to next day" : "Move to today";
  move.onclick = () =>
    Store.update(t.id, { day: t.day ? dayKey(addDays(parseKey(t.day), 1)) : todayKey() });

  const del = el("button", "btn ghost", "×");
  del.title = "Delete";
  del.onclick = () => Store.remove(t.id);

  li.append(main, move, del);
  return li;
}

/* ---------- wire up ---------- */

$("#btn-prev").onclick = () => { weekStart = addDays(weekStart, -7); renderWeek(); };
$("#btn-next").onclick = () => { weekStart = addDays(weekStart, 7); renderWeek(); };
$("#btn-today").onclick = () => { weekStart = startOfWeek(new Date()); renderWeek(); };
$("#btn-signin").onclick = () => Store.signIn();
$("#btn-signout-denied").onclick = () => Store.signOut();

renderWeek();
Store.init({
  onTasks: (t) => { tasks = t; renderTasks(); },
  onState,
});
