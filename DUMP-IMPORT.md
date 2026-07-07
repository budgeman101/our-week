# 📥 Dumping a pile of tasks into Our Week

For when you've got a **notebook page, a Siri-notes brain dump, or a big messy list** and you want it in the app with zero hand-sorting. An agent (Claude) does the sorting; the app does the rest.

## The workflow

1. Open a Claude session in this folder.
2. Paste the dump — typed lines, a photo of the notebook page, whatever.
3. Say: *"Sort this for Our Week and make me an import file"* (Claude reads this doc for the format).
4. In the app: **⚙️ → Import tasks (JSON file)** → pick the file. Everything lands on the **List** grouped by who and area; anything with a date lands on that day.

Once live sync is on (SETUP-GUIDE Option 2), there's an even shorter path: ask Claude to **push the dump straight to the app's inbox** — tasks appear on both phones with no file step. See "Remote push" below.

## The import file format

A JSON list. Only `text` is required — anything missing is auto-sorted by the app's built-in guesser, and any tag you give wins over the guess.

```json
[
  { "text": "Rake the lawn" },
  { "text": "Wash the walls", "who": "lindsay", "area": "cleaning" },
  { "text": "Put up the shelves", "who": "both", "date": "2026-07-08" },
  "Bottle depot"
]
```

| Field | Values |
|---|---|
| `text` | The task. Plain strings work too. Phrases like "on Thursday" inside the text also schedule it. |
| `who` | `ben` · `lindsay` · `both` *(optional)* |
| `area` | `shop` · `house` · `cleaning` · `kitchen` · `laundry` · `yard` · `garage` · `paint` · `selling` · `organizing` · `plants` · `pets` · `errands` · `personal` · `other` *(optional)* |
| `date` | `YYYY-MM-DD` — puts it on that day instead of the List *(optional)* |

The area keys map to the paper list's sections (Shop & Furniture, Around the House, Cleaning & Tidying, Kitchen, Laundry & Clothes, Yard & Outdoor, Garage & Organizing, Painting & Home, Selling & Listing, Organizing, Plants, Pets, Errands & Admin, Personal).

## Notes for the agent doing the sorting

- Sort **who** by the usual split (same as the June 28 household list): yard/garage/painting/errands lean Ben; laundry/selling/plants/personal/kitchen lean Lindsay; two-person jobs (shop runs, moving furniture, shelves) are `both`.
- Keep task wording as written — clean up obvious dictation garble, split "X and Y" into two tasks when they're clearly separate jobs.
- Don't invent dates. Only set `date` when the dump says one.
- Save the file in this folder as `import-YYYY-MM-DD.json` so there's a record of each dump.

## Remote push (needs live sync on)

With Firebase connected, an agent can skip the file and POST each task to the household inbox — the app drains it automatically, same as Siri:

```
POST https://firestore.googleapis.com/v1/projects/PROJECT_ID/databases/(default)/documents/households/HOUSEHOLD/inbox?key=API_KEY
Content-Type: application/json

{ "fields": {
    "text": { "stringValue": "Rake the lawn" },
    "who":  { "stringValue": "ben" },
    "area": { "stringValue": "yard" },
    "date": { "stringValue": "2026-07-09" }
} }
```

`who`, `area`, and `date` are optional — the app fills gaps with its guesser. PROJECT_ID and API_KEY come from `firebaseConfig` in `app.js`; HOUSEHOLD is the code in ⚙️ Settings.
