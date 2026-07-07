/* Offline unit tests for the reminder due-logic. Run:  node test.js  */
const { dueReminders, wallToMs } = require("./sender.js");

const cfg = { tz: "America/Edmonton", shiftLeadMin: 60, apptMorningHour: 8, apptDayBeforeHour: 18, maxAgeMin: 180 };
let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log("ok   -", name); } else { fail++; console.log("FAIL -", name); } };

// a wall-clock instant in the household's timezone
const on = (y, mo, d) => (h, mi) => wallToMs(y, mo, d, h, mi, cfg.tz);

/* --- one-off shift 5:30pm on Mon 2026-07-13, remind 60 min before (4:30pm) --- */
const at13 = on(2026, 7, 13);
const shift = { _id: "shift:x", kind: "shift", start: "17:30", date: "2026-07-13", repeat: false };
ok("shift due just after fire (4:35pm)",  dueReminders(at13(16, 35), [shift], cfg).some(r => r.title.includes("shift")));
ok("shift NOT due before fire (4:00pm)",  !dueReminders(at13(16, 0), [shift], cfg).length);
ok("shift NOT due hours later (8:00pm)",  !dueReminders(at13(20, 0), [shift], cfg).length);
ok("shift body shows the start time",     (dueReminders(at13(16, 35), [shift], cfg)[0] || {}).body.includes("5:30 PM"));

/* --- repeating Monday shift + skip-this-week --- */
const rep  = { _id: "shift:reg:mon", kind: "shift", start: "17:30", date: "2026-07-06", repeat: true };
const skip = { _id: "shiftskip:shift:reg:mon:2026-07-13", kind: "shiftskip" };
ok("repeating shift fires on a matching Monday", dueReminders(at13(16, 35), [rep], cfg).length === 1);
ok("skip-this-week suppresses it",               dueReminders(at13(16, 35), [rep, skip], cfg).length === 0);

/* --- appointment reminders --- */
const appt = { _id: "appt:1", kind: "appt", title: "Dentist", who: "lindsay", time: "14:30", date: "2026-07-13", remind: "morning" };
ok("appt 'morning' due at 8:10am",   dueReminders(at13(8, 10), [appt], cfg).some(r => r.title.startsWith("Today")));
ok("appt 'morning' not due at 7am",  !dueReminders(at13(7, 0), [appt], cfg).length);
ok("done appt is suppressed",        !dueReminders(at13(8, 10), [{ ...appt, done: true }], cfg).length);

const gym = { _id: "appt:2", kind: "appt", title: "Sam gymnastics", who: "both", time: "10:30", date: "2026-07-13", remind: "dayBefore" };
ok("appt 'dayBefore' due 6:05pm the day before", dueReminders(on(2026, 7, 12)(18, 5), [gym], cfg).some(r => r.title.startsWith("Tomorrow")));

/* --- reminders without a time / no remind set --- */
ok("shift without a start time is ignored", !dueReminders(at13(16, 35), [{ _id: "s", kind: "shift", date: "2026-07-13" }], cfg).length);
ok("appt with remind='none' is ignored",    !dueReminders(at13(8, 10), [{ ...appt, remind: "none" }], cfg).length);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
