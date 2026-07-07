# 🎙️ Add to Our Week with Siri

Say *"Hey Siri, add to Our Week"* and dictate **"rake the lawn, bottle depot and wash the rug"** — each one lands on the shared **List**, already sorted by who and area. Say **"pick up tires on Thursday"** and it goes straight onto Thursday.

This is the same trick as the Our Kitchen shortcut, so if you built that one, this will feel familiar. It takes about 10 minutes, once.

---

## How it works (30-second version)

The shortcut drops whatever you say into a little **inbox** inside your Firebase. The app empties that inbox into the List, auto-sorting each item. So:

- If a phone has the app **open**, items appear within a second — on both phones.
- If **no** phone has it open, items wait safely in the inbox and drop in the next time anyone opens the app.

Nothing is ever lost; worst case it appears a few seconds later.

---

## ✅ Before you start

You need **two** things already done:

1. **Live sync is on.** You've completed **Option 2** in `SETUP-GUIDE.md` (your Firebase keys are pasted into **`app.js`** and the app header shows **"Synced"**, not "This device only"). Siri can't work without this — there'd be nowhere to send items.

2. **Your security rules include the inbox.** The rules in **Part E** of `SETUP-GUIDE.md` already do — the inner `match /{document=**}` block is what allows it. If Siri gets a "permission denied" error, re-paste those rules and hit **Publish**.

---

## Step 1 — Find your three values

| What | Where to find it |
|------|------------------|
| **PROJECT_ID** | In `app.js`, the `projectId:` line inside `firebaseConfig`. |
| **API_KEY** | In `app.js`, the `apiKey:` line (a long string starting `AIza…`). |
| **HOUSEHOLD** | Your household code from the app's **⚙️ Settings**. Must match exactly, lowercase. |

Your address will look like this (all one line, no spaces):

```
https://firestore.googleapis.com/v1/projects/PROJECT_ID/databases/(default)/documents/households/HOUSEHOLD/inbox?key=API_KEY
```

👉 Replace the three values, leave `(default)` exactly as it is, parentheses and all.

## Step 2 — Build the Shortcut

On your iPhone: **Shortcuts** app → **➕** → **Add Action**, then add these in order (same recipe as the kitchen one):

1. **Dictate Text**
2. **Replace Text** — Find ` and ` → Replace `, ` (input: Dictated Text)
3. **Split Text** — Separator: Custom, `, ` (input: Updated Text)
4. **Repeat with Each** — input: the Split Text list
5. **Get Contents of URL** *(inside the Repeat block)* — URL: your address from Step 1. Show More → Method **POST**, Header `Content-Type: application/json`, Request Body **JSON**:

   ```
   fields  (Dictionary)
     └ text  (Dictionary)
         └ stringValue  (Text)  →  Repeat Item
   ```

## Step 3 — Name it and test it

1. Rename the shortcut **Add to Our Week** (that becomes the Siri phrase), tap **Done**.
2. Say **"Hey Siri, add to Our Week"**, then **"rake the lawn and bottle depot."**
3. Open the app — both are on the **List**, sorted. 🎉

Lindsay builds the same shortcut on her phone with the **same** URL.

---

## ❓ Troubleshooting

- **"Permission denied" / 403** → re-paste the Part E rules (they must include the inner `match /{document=**}` block) and Publish.
- **Nothing shows up** → household code in the URL must match ⚙️ Settings exactly, and the app header must say "Synced".
- **Sorted into the wrong spot** → tap the who-tag or open the item to fix it — the guesser learns nothing, but it only takes a tap.
