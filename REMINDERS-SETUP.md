# 🔔 Turn on real reminders (free)

This makes **Our Week** actually buzz your phones — "Lindsay's shift starts at
5:30," "Dentist today" — even when the app is closed. It's free: no server bill,
no credit card. A tiny job runs on **GitHub Actions** (free) every 15 minutes,
checks what's coming up, and pushes a notification to any phone that turned
reminders on.

## Before you start

Reminders sit on top of the sharing setup, so these must be done first:

1. **Live sync is on** — you've finished **Option 2** in `SETUP-GUIDE.md`
   (Firebase keys pasted into `app.js`, header shows "Synced").
2. **The app is on GitHub and hosted** on GitHub Pages (Part F of the setup guide).
3. **Each phone has the app on its Home Screen** — on iPhone this is required
   for notifications to work at all (Safari → Share → *Add to Home Screen*).

## Step 1 — Turn reminders on, on each phone

Open the app (the Home-Screen one), tap **⚙ Settings → Turn on reminders**, and
allow notifications when your phone asks. Do this on both your phone and
Lindsay's. That's the only per-phone step.

*(The VAPID public key is already in `app.js`. If you'd rather generate your own
keypair, run `npm run keys` in the `reminders` folder and put the new public key
in `app.js` — see `reminders/secrets.local.txt`.)*

## Step 2 — Give the sender its secrets (one time)

On github.com, open your repo → **Settings → Secrets and variables → Actions →
New repository secret**, and add these (values are in
`reminders/secrets.local.txt`, plus your Firebase ones):

| Secret name | Value |
|---|---|
| `VAPID_PUBLIC_KEY`  | from `reminders/secrets.local.txt` |
| `VAPID_PRIVATE_KEY` | from `reminders/secrets.local.txt` — **keep this private** |
| `VAPID_SUBJECT`     | `mailto:budgeman101@gmail.com` |
| `FIREBASE_PROJECT_ID` | your `projectId` from `firebaseConfig` in `app.js` |
| `FIREBASE_API_KEY`  | your `apiKey` from `firebaseConfig` in `app.js` |
| `HOUSEHOLD_CODE`    | the exact code you use in the app (⚙ Settings) |
| `TIMEZONE`          | your timezone, e.g. `America/Edmonton` |

The Firestore rules from `SETUP-GUIDE.md` Part E already allow this — no rules
change needed.

## Step 3 — Let it run

Push the repo. GitHub Actions picks up `.github/workflows/reminders.yml` and runs
the sender **every 15 minutes** automatically. To test right now without waiting:
repo → **Actions → "Our Week reminders" → Run workflow**. Then add a shift or an
appointment for a few minutes out and watch the phone.

## What gets a reminder

- **Lindsay's shifts** — a nudge **1 hour before** each shift starts (skipped
  weeks are respected). Change the lead time with a `SHIFT_LEAD_MIN` secret.
- **Appointments** — whatever you picked in the appointment's *Remind me*:
  "morning of" (sent ~8 AM) or "the day before" (sent ~6 PM). "Don't remind"
  sends nothing.

Each reminder is sent once (it remembers what it already sent), and a reminder
that's more than a few hours stale (e.g. Actions was down) is skipped rather
than arriving late.

## Costs — all free

- **GitHub Actions**: free (unlimited minutes on public repos).
- **Web push**: free — your own VAPID keys, no service to pay for.
- **Firebase**: the free tier covers this easily.

## Troubleshooting

- **No notification** → is reminders **on** in ⚙ Settings on that phone, and is
  the app opened from the **Home Screen** (not Safari)? On iPhone check
  Settings → Notifications → Our Week is allowed.
- **The Action failed** → open the run in the Actions tab; the log says which
  secret is missing or wrong.
- **Wrong time** → check the `TIMEZONE` secret matches where you live.
- **Reminders stopped after ~60 days** → GitHub disables schedules on inactive
  repos; just push any small change (or hit *Run workflow*) to wake it.

## Files

| File | What it is |
|---|---|
| `reminders/sender.js` | Works out what's due and pushes it. |
| `reminders/test.js`   | Offline tests for the timing logic (`npm test`). |
| `reminders/package.json` | Its one dependency (`web-push`). |
| `reminders/secrets.local.txt` | Your keys (git-ignored — never committed). |
| `.github/workflows/reminders.yml` | Runs the sender every 15 min, free. |
