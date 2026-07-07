# Our Week — Setup Guide

A shared weekly **plan** for you and Lindsay. Pick a day and you see that day at a glance: what's going on with **Lindsay** (her work shifts, energy, furniture hours, and Sam/Lou Lou), your **to-dos**, the day's **cleaning**, and the **every-day routine** (morning / night / each day).

Everything on the day is editable, and you can add your own items anywhere. Each line is tagged **Ben**, **Lindsay**, or **Both** (Both shows in bold). Checkmarks save per week and — once synced — show up on both phones.

There are **two ways** to use it. Start with Option 1 to try it in 10 seconds. Do Option 2 when you're ready for it to sync live across both your phones.

---

## Option 1 — Try it right now (one device)

1. Double-click **`index.html`**. It opens in your web browser.
2. At the welcome card, type a private **household code** (e.g. `ben-lindsay-2026-x4k2`) and tap **Start**.
3. That's it — the plan is already filled in. Tap any line to edit it, or **+ Add** to add your own.

In this mode everything is saved **on that one device only** — no account needed. Perfect for testing. When you want it on both phones syncing together, do Option 2.

---

## Option 2 — Live sync across both phones

This connects the app to a free Google service called **Firebase**. When one of you checks something off or edits a line, it updates on the other's phone too. It's free for normal household use and takes about 10 minutes to set up once.

### Part A — Create your free Firebase project

1. Go to **https://console.firebase.google.com** and sign in with a Google account.
2. Click **Add project** (or **Create a project**). Name it anything, e.g. `our-week`. You can **turn OFF Google Analytics**, you don't need it. Click **Create project**.
3. When it's ready, click **Continue**.

### Part B — Turn on the database

1. In the left menu, click **Build > Firestore Database**.
2. Click **Create database**.
3. Choose a location near you, click **Next**.
4. Select **Start in test mode**, then **Enable**. (We'll lock it down in Part E.)

### Part C — Get your keys

1. Click the **gear icon** (top-left, next to "Project Overview") > **Project settings**.
2. Scroll to **Your apps** and click the **web icon `</>`**.
3. Give it a nickname like `week-web` and click **Register app**. (You do **not** need Firebase Hosting — skip it.)
4. You'll see a code block with `firebaseConfig = { ... }`. **Copy those values** — apiKey, authDomain, projectId, etc.

### Part D — Paste the keys into the app

1. Open **`app.js`** in a text editor (right-click > Open with > Notepad / TextEdit / VS Code).
2. Near the top, under the `CONFIG` comment, you'll see:

   ```js
   const firebaseConfig = {
     apiKey: "PASTE_API_KEY_HERE",
     authDomain: "PASTE_PROJECT.firebaseapp.com",
     projectId: "PASTE_PROJECT_ID",
     ...
   };
   ```

3. Replace each `PASTE_...` value with the matching value from Firebase. Keep the quotes. Save the file.

The header pill will change from **"This device only"** to **"Synced"** once it connects.

### Part E — Lock the database to just your family (recommended)

By default test mode lets anyone in for 30 days. Set a simple permanent rule instead:

1. In Firebase: **Firestore Database > Rules** tab.
2. Replace what's there with:

   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /households/{code} {
         allow read, write: if true;
         match /{document=**} {
           allow read, write: if true;
         }
       }
     }
   }
   ```

3. Click **Publish**.

> **Note:** This keeps the app working forever without logins. Your data is only reachable by someone who knows your **exact household code**, so pick something private and hard to guess. For a family plan this is plenty. If you'd ever want password-protected accounts instead, just ask.

### Part F — Put it online so both phones can open it

Now that the app lives in a GitHub repository, **GitHub Pages** is the tidy way (free, and it updates automatically every time the repo is pushed):

1. On github.com, open the repo → **Settings** → **Pages**.
2. Under *Build and deployment*, set **Source** to "Deploy from a branch", pick the `main` branch and `/ (root)` folder, and save.
3. After a minute the app is live at `https://YOUR-USERNAME.github.io/REPO-NAME/`.
4. Open that link on **both phones**.

*(Netlify Drop — drag the folder onto https://app.netlify.com/drop — still works too. Any static host does; the app is just these files.)*

### Part G — Connect both phones

To share one plan, both phones must use the **same household code**.

1. On **your** phone, open the link. At the welcome card, type the code you both agreed on. Tap **Start**.
2. On **Lindsay's** phone, open the same link and type the **exact same code**. Tap **Start**.
3. Done — you now share one live plan. (Change the code anytime via the **gear**, top right.)

### Part H — Make it feel like a real app (optional)

Add it to the home screen so it opens full-screen with its own icon:

- **iPhone (Safari):** tap **Share** > **Add to Home Screen**.
- **Android (Chrome):** tap the **menu** > **Add to Home screen** / **Install app**.

---

## How to use it

- **Pick a day** — tap a day along the top. Today is highlighted. Use the **arrows** to move between weeks; *Jump to this week* brings you back.
- **The List tab** — the master household to-do list, sorted **by who, then by area** just like the paper one, automatically. Dump tasks in by typing (no sorting needed — it guesses who/area, tap a tag to fix), by voice (**SIRI-SETUP.md**), or as a whole pile at once (**DUMP-IMPORT.md**). Saying "on Thursday" sends a task straight to that day. To schedule a List item, open it and set **Do on**; clear the date to send it back to the List.
- **Edit anything** — tap any line (or its **pencil**) to open the editor. You can reword it, change who it's for, **split it into two**, or delete it. This works for your to-dos, the cleaning step, the morning/night/each-day routine, the Sam/Lou Lou notes, and even Lindsay's schedule, energy, and furniture lines.
- **Lindsay's shifts** — on her card, tap **+ Add shift** to drop in a shift with a **start time** (and an optional end time and label like *Day* or *Night*). Shifts sit on a specific day, so summer's shifting schedule is just adding and removing them. If a shift is the same every week, tick **Repeats weekly** in its editor. Tap any shift to change or delete it.
- **Add your own** — tap **+ Add** in any section: a care note on Lindsay's card, a cleaning step, a morning/night/each-day routine item, or a to-do (type it in the box, pick who, tap the plus).
- **Split into two** — in the editor, tap **Split into two**. It suggests a sensible break point; both halves become separate items on the same day.
- **Who** — tap the colored **Ben / Lindsay / Both** chip to change who an item is for. Both items show in **bold**.
- **Check things off** — tap the box. Checkmarks are tracked **per week**, so each week starts fresh while the plan itself stays put.
- **Recurring vs one-off** — the routine, cleaning, care notes, and Lindsay's info **repeat every week** (cleaning and Lindsay's info are set per weekday); edits to them carry forward. **To-dos** are for that week, and anything you don't finish rolls into the current week automatically.
- **Undo** — deleting shows a brief **Undo** button in case you tap by mistake.
- **Reset starters** — the **gear > Reload this week's starter to-dos** re-adds the original project to-dos for the week. Your own added items stay.
- **Offline** — once opened (and hosted), the app works without signal; changes sync when you're back online.

---

## Quick troubleshooting

- **Header says "This device only"** — keys aren't pasted correctly (Part D, now in **`app.js`**), or that phone has no internet. Re-check the config values.
- **Phones don't match** — they must use the **same household code** (Part G) and the same Firebase keys (same `app.js`).
- **Changed the code and the plan looks empty/different** — each code is its own separate plan. Switch back to the shared code in the gear menu.
- **Updated the app but phones show the old version** — bump `CACHE = "our-week-v4"` to `v5` in `service-worker.js`, re-upload, and reopen.

---

## What's in this folder

| File | What it is |
|---|---|
| `index.html` | The layout and styling of the app. |
| `app.js` | The app's logic and the plan content. **Paste Firebase keys here for sync.** |
| `manifest.webmanifest` | Lets phones install it to the home screen. |
| `service-worker.js` | Makes it work offline once hosted. |
| `icon-192.png`, `icon-512.png`, `apple-touch-icon.png` | App icons. |
| `SETUP-GUIDE.md` | This file. |
| `SIRI-SETUP.md` | "Hey Siri, add to Our Week" — voice dumps into the List. |
| `DUMP-IMPORT.md` | Bulk dumps: agent-sorted notebook/notes piles, imported or pushed in. |
