# 🎟️ The AI guest pass — locking the receipt scanner to your families

The Kitchen's AI features (receipt scan, handwritten-list scan, recipe import,
dinner ideas) run through your Cloudflare Worker, which holds your Anthropic
key — the one thing in this setup that spends real credit. This update locks
that door: **only household codes you list get served, each with a monthly
allowance**, and everyone else is politely refused. Guests see a friendly note
when they run low ("these cost a little — ask Ben if you need more").

Everything below happens in your browser at **https://dash.cloudflare.com** and
takes about five minutes. Do it **after** the app update is pushed (the app
starts sending its household code with each scan; the old Worker just ignores
it, so nothing breaks in between).

---

## Step 1 — Paste the new Worker code (~2 min)

1. In Cloudflare: **Workers & Pages → our-kitchen-receipt → Edit code**.
2. Select everything in the editor and delete it.
3. Open **`kitchen/receipt-worker.js`** (in this repo), copy **all** of it,
   paste it into the editor, and click **Deploy** (top right).

## Step 2 — Tell it who your families are (~1 min)

1. Back on the Worker's page: **Settings → Variables and Secrets → Add**.
2. Choose **Secret** (so nobody can read the codes), name it exactly
   `HOUSEHOLDS`, and set the value to your families and their monthly
   allowances, comma-separated:

   ```
   YOUR-CODE=200, THEIR-CODE=30
   ```

   (Use the real household codes. A code with no `=number` gets 30.)
3. **Save / Deploy.**

Adding a family later, or giving someone a bigger allowance, is just editing
this one line — no code changes.

## Step 3 — Add the little counter (~2 min)

The allowance needs somewhere free to keep score:

1. In the left menu: **Storage & Databases → KV → Create a namespace**.
   Name it `our-kitchen-usage`. (Free tier — far more than enough.)
2. Back at the Worker: **Settings → Bindings → Add → KV namespace**.
   - Variable name: exactly `USAGE`
   - KV namespace: `our-kitchen-usage`
3. **Save / Deploy.**

> Skip this step and the allowlist still works (strangers blocked), but
> allowances aren't counted — listed families are unlimited until you add it.

## Step 4 — Test (~1 min)

- In the Kitchen app, scan any receipt — it should work exactly as before.
- The lock: open a private/incognito browser window and paste this (swap in
  your Worker address), then press Enter:

  ```
  fetch("https://our-kitchen-receipt.budgeman101.workers.dev",{method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({household:"wrong-code",mode:"suggest",pantry:[{name:"eggs"}]})}
  ).then(r=>r.json()).then(console.log)
  ```

  You should see: *"This household isn't set up for AI scanning yet…"* —
  that's the door holding.

---

## How the allowance behaves

- Only **successful** scans count; failures are free.
- Counters reset on the **1st of each month**.
- When a family has **10 or fewer** scans left, the app tells them after each
  scan and suggests asking you for more.
- When they hit the cap they get: *"This month's 30 AI scans are used up. They
  run on a small paid service that Ben covers — if you need more this month,
  just ask him. A fresh allowance starts on the 1st."* Everything non-AI keeps
  working normally.
- Raising their allowance = edit the `HOUSEHOLDS` value (Step 2), Deploy.
