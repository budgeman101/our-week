/* Our Week — reminder sender.
 *
 * Runs on a schedule (GitHub Actions cron, see .github/workflows/reminders.yml),
 * reads each household's shifts + appointments from Firestore, works out which
 * reminders are due right now, and pushes them to every phone that turned
 * reminders on. Serves one household (HOUSEHOLD_CODE) or several
 * (HOUSEHOLD_CODES, comma-separated). Free: no server to run, no card.
 * Full setup in REMINDERS-SETUP.md.
 *
 * All the date logic lives in the pure `dueReminders()` function so it can be
 * unit-tested offline (node test.js) with no network.
 */
const webpush = require("web-push");

const CFG = {
  projectId: process.env.FIREBASE_PROJECT_ID,
  apiKey: process.env.FIREBASE_API_KEY,
  // One code (HOUSEHOLD_CODE) or a comma-separated list (HOUSEHOLD_CODES) —
  // every listed household gets its own reminders. Codes are secrets: they
  // are never printed in logs (this repo's Action logs are public).
  households: String(process.env.HOUSEHOLD_CODES || process.env.HOUSEHOLD_CODE || "")
    .split(/[,\s]+/).map((s) => s.trim()).filter(Boolean),
  tz: process.env.TIMEZONE || "America/Edmonton",
  vapidPublic: process.env.VAPID_PUBLIC_KEY,
  vapidPrivate: process.env.VAPID_PRIVATE_KEY,
  vapidSubject: process.env.VAPID_SUBJECT || "mailto:nobody@example.com",
  shiftLeadMin: Number(process.env.SHIFT_LEAD_MIN || 60),   // remind this long before a shift starts
  apptMorningHour: Number(process.env.APPT_MORNING_HOUR || 8),
  apptDayBeforeHour: Number(process.env.APPT_DAYBEFORE_HOUR || 18),
  maxAgeMin: Number(process.env.MAX_AGE_MIN || 180),         // don't fire reminders older than this (missed runs)
};

/* ------------------------- timezone helpers ------------------------ */
function partsInTZ(ms, tz) {
  const dtf = new Intl.DateTimeFormat("en-CA", { timeZone: tz, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const p = {};
  for (const part of dtf.formatToParts(new Date(ms))) if (part.type !== "literal") p[part.type] = part.value;
  return p; // {year,month,day,hour,minute,second} as strings
}
// epoch ms for a wall-clock time (y, mo 1-12, d, h, mi) interpreted in tz
function wallToMs(y, mo, d, h, mi, tz) {
  const guess = Date.UTC(y, mo - 1, d, h, mi, 0);
  const p = partsInTZ(guess, tz);
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return guess - (asUTC - guess);
}
function localDateStr(ms, tz) { const p = partsInTZ(ms, tz); return `${p.year}-${p.month}-${p.day}`; }
function addDaysISO(iso, n) { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function weekdayMon0(iso) { return (new Date(iso + "T00:00:00Z").getUTCDay() + 6) % 7; }
function mondayISO(iso) { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() - weekdayMon0(iso)); return d.toISOString().slice(0, 10); }

/* ---------------- pure logic: what's due right now ----------------- */
// Each household names its own people (meta:members, or the older
// meta:names pair). Falls back to the original defaults so reminders
// never say the wrong family's names.
function memberNames(items) {
  const map = {};
  let count = 0;
  const md = items.find((t) => (t._id || t.id) === "meta:members");
  if (md && Array.isArray(md.list)) {
    md.list.forEach((m) => { if (m && m.id && m.name) { map[m.id] = String(m.name); count++; } });
  }
  if (!count) {
    const n = items.find((t) => (t._id || t.id) === "meta:names") || {};
    map.ben = n.ben || "Ben"; map.lindsay = n.lindsay || "Lindsay"; count = 2;
  }
  map.both = count > 2 ? "Everyone" : "Both";
  return map;
}
// Each household lives in its own timezone: the app saves the phone's
// zone as a meta:tz doc, and reminders fire on THAT clock. Falls back
// to the workflow's TIMEZONE setting for households that predate it.
function householdTz(items, fallback) {
  const d = items.find((t) => (t._id || t.id) === "meta:tz");
  if (d && d.tz) {
    try { new Intl.DateTimeFormat("en-CA", { timeZone: d.tz }); return d.tz; }
    catch (e) { /* unknown zone name — use the fallback */ }
  }
  return fallback;
}
// items: array of plain objects (kind, ...). now: epoch ms.
// returns every reminder whose fire-time is in the window [now-maxAge, now];
// the caller filters out ones already sent. Pure — no network, no clock reads.
function dueReminders(now, items, cfg) {
  const tz = householdTz(items, cfg.tz);
  const names = memberNames(items);
  const out = [];
  const within = (fireMs) => fireMs <= now && (now - fireMs) < cfg.maxAgeMin * 60000;
  const has = (id) => items.some((t) => t._id === id || t.id === id);
  const skipKey = (shiftId, iso) => "shiftskip:" + shiftId + ":" + mondayISO(iso);
  const adoneKey = (apptId, iso) => "adone:" + apptId + ":" + mondayISO(iso);

  // candidate local dates: yesterday / today / tomorrow (covers lead times + missed runs)
  const today = localDateStr(now, tz);
  const dates = [addDaysISO(today, -1), today, addDaysISO(today, 1)];

  for (const t of items) {
    if (t._gone) continue;

    if (t.kind === "shift" && t.start) {
      for (const D of dates) {
        const occurs = t.repeat ? weekdayMon0(D) === weekdayMon0(t.date) : t.date === D;
        if (!occurs) continue;
        if (t.repeat && has(skipKey(t._id || t.id, D))) continue;      // skipped that week
        const [h, m] = String(t.start).split(":").map(Number);
        const startMs = wallToMs(+D.slice(0, 4), +D.slice(5, 7), +D.slice(8, 10), h, m, tz);
        const fireMs = startMs - cfg.shiftLeadMin * 60000;
        const key = "shift:" + (t._id || t.id) + ":" + D;
        if (within(fireMs)) {
          const label = t.label ? " (" + t.label + ")" : "";
          // shifts saved before people-lists carried no owner — they were
          // always the original household's second slot ("lindsay")
          const owner = names[t.who || "lindsay"];
          out.push({ key, title: (owner ? owner + "'s shift" : "Work shift") + label, body: "Starts at " + fmt12(t.start) + " — heads up." });
        }
      }
    }

    if (t.kind === "appt" && t.remind && t.remind !== "none") {
      for (const D of dates) {
        const occurs = t.repeat ? weekdayMon0(D) === weekdayMon0(t.date) : t.date === D;
        if (!occurs) continue;
        if (t.repeat ? has(adoneKey(t._id || t.id, D)) : t.done) continue;   // already ticked off
        const who = names[t.who] || names.both;
        const timeStr = t.time ? " at " + fmt12(t.time) : "";
        if (t.remind === "morning") {
          const fireMs = wallToMs(+D.slice(0, 4), +D.slice(5, 7), +D.slice(8, 10), cfg.apptMorningHour, 0, tz);
          const key = "appt:" + (t._id || t.id) + ":" + D + ":morning";
          if (within(fireMs)) out.push({ key, title: "Today: " + (t.title || "Appointment"), body: who + timeStr + "." });
        } else if (t.remind === "dayBefore") {
          const day = addDaysISO(D, -1);
          const fireMs = wallToMs(+day.slice(0, 4), +day.slice(5, 7), +day.slice(8, 10), cfg.apptDayBeforeHour, 0, tz);
          const key = "appt:" + (t._id || t.id) + ":" + D + ":dayBefore";
          if (within(fireMs)) out.push({ key, title: "Tomorrow: " + (t.title || "Appointment"), body: who + timeStr + "." });
        }
      }
    }
  }
  return out;
}
function fmt12(hhmm) {
  let [h, m] = String(hhmm).split(":").map(Number);
  const ap = h < 12 ? "AM" : "PM"; h = h % 12; if (h === 0) h = 12;
  return h + ":" + String(m).padStart(2, "0") + " " + ap;
}

/* ---------------------- Firestore REST access --------------------- */
const BASE = () => `https://firestore.googleapis.com/v1/projects/${CFG.projectId}/databases/(default)/documents`;
function fval(v) {
  if (v == null) return null;
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("nullValue" in v) return null;
  if ("timestampValue" in v) return v.timestampValue;
  if ("mapValue" in v) return Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, fval(x)]));
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(fval);
  return null;
}
function docToObj(doc) {
  const o = { _id: doc.name.split("/").pop() };
  for (const [k, v] of Object.entries(doc.fields || {})) o[k] = fval(v);
  return o;
}
async function listCollection(hh, coll) {
  const out = [];
  let pageToken = "";
  do {
    const url = `${BASE()}/households/${hh}/${coll}?key=${CFG.apiKey}&pageSize=300` + (pageToken ? `&pageToken=${pageToken}` : "");
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Firestore ${coll} read failed: ${res.status} ${await res.text()}`);
    const j = await res.json();
    (j.documents || []).forEach((d) => out.push(docToObj(d)));
    pageToken = j.nextPageToken || "";
  } while (pageToken);
  return out;
}
async function markSent(hh, key, whenMs) {
  const id = key.replace(/[^A-Za-z0-9_.-]/g, "_");
  const url = `${BASE()}/households/${hh}/sent/${id}?key=${CFG.apiKey}`;
  await fetch(url, { method: "PATCH", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fields: { ts: { integerValue: String(whenMs) } } }) });
}

/* ------------------------------ main ------------------------------ */
async function runHousehold(hh, label) {
  const now = Date.now();
  const [items, subs, sentDocs] = await Promise.all([listCollection(hh, "items"), listCollection(hh, "push"), listCollection(hh, "sent")]);
  const sentIds = new Set(sentDocs.map((d) => d._id));   // ids are the sanitised reminder keys
  const isSent = (key) => sentIds.has(key.replace(/[^A-Za-z0-9_.-]/g, "_"));

  const due = dueReminders(now, items, CFG);
  const fresh = due.filter((r) => !isSent(r.key));

  console.log(`[${label}] ${items.length} items, ${subs.length} subscriptions, ${due.length} due, ${fresh.length} to send`);
  if (!subs.length) { console.log(`[${label}] No phones subscribed yet — nothing to send.`); return; }

  for (const r of fresh) {
    const payload = JSON.stringify({ title: r.title, body: r.body, tag: r.key, url: "./" });
    let ok = 0;
    for (const s of subs) {
      const sub = { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } };
      try { await webpush.sendNotification(sub, payload); ok++; }
      catch (e) {
        if (e.statusCode === 404 || e.statusCode === 410) {
          // subscription gone (app deleted / permission revoked) — clean it up
          await fetch(`${BASE()}/households/${hh}/push/${s._id}?key=${CFG.apiKey}`, { method: "DELETE" }).catch(() => {});
        } else console.error(`[${label}] push failed:`, e.statusCode || e.message);
      }
    }
    await markSent(hh, r.key, now);
    console.log(`[${label}] sent "${r.title}" to ${ok}/${subs.length} phones`);
  }
}
async function main() {
  const missing = ["projectId", "apiKey", "vapidPublic", "vapidPrivate"].filter((k) => !CFG[k]);
  if (!CFG.households.length) missing.push("HOUSEHOLD_CODES (or HOUSEHOLD_CODE)");
  if (missing.length) { console.error("Missing config:", missing.join(", ")); process.exit(1); }
  webpush.setVapidDetails(CFG.vapidSubject, CFG.vapidPublic, CFG.vapidPrivate);

  // Each family gets its own run; one family's hiccup never blocks another's
  // reminders. Codes stay out of the logs — households are numbered instead.
  let failed = 0;
  for (let i = 0; i < CFG.households.length; i++) {
    const label = `household ${i + 1}/${CFG.households.length}`;
    try { await runHousehold(CFG.households[i], label); }
    catch (e) { failed++; console.error(`[${label}]`, e.message || e); }
  }
  if (failed) process.exit(1);   // red run = something needs a look
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
module.exports = { dueReminders, memberNames, householdTz, wallToMs, localDateStr, weekdayMon0, mondayISO, fmt12 };
