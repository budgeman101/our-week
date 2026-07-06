# 🗓️ Our Week

A weekly planner and to-do list for two people. Add tasks to any day of the
week (or to the "Anytime" list), check them off, push unfinished ones to the
next day. Works great on phones — add it to your home screen and it feels like
an app.

No accounts, no passwords, no sign-in screens. Sharing works with a
**household code**: a long random code you create once and both enter on your
phones. Anyone with the code sees the same planner — it works like a house
key, so only share it with each other.

Built with plain HTML, CSS, and JavaScript — no build tools, nothing to
install.

## Try it right now

Double-click `index.html`. That's it. In this **local mode** tasks are saved
in the browser on that one device only.

To get the real thing — one shared planner you can both see and edit from
your phones — do the two setup steps below. Both are free.

## Step 1 — Publish it with GitHub Pages

1. Push this folder to a GitHub repository (see the commands at the bottom).
2. On github.com, open the repo → **Settings** → **Pages**.
3. Under *Build and deployment*, set **Source** to "Deploy from a branch",
   pick the `main` branch and `/ (root)` folder, and save.
4. After a minute your app is live at `https://YOUR-USERNAME.github.io/REPO-NAME/`.

## Step 2 — Turn on syncing (Firebase)

Firebase is Google's app platform; its free tier is far more than this app
will ever use. One of you does this once (~5 minutes):

1. Go to <https://console.firebase.google.com> and click **Create a
   project** (any name, e.g. `our-week`). You can say no to Google Analytics.
2. **Add a web app:** on the project overview page click the `</>` icon,
   give it any nickname, and register. Firebase shows a `firebaseConfig`
   code block — copy those values into `firebase-config.js` in this folder.
3. **Create the database:** in the left menu go to **Build → Firestore
   Database** → *Create database* → choose **production mode** and any
   nearby region.
4. **Set the rules:** in Firestore open the **Rules** tab, paste in the
   contents of `firestore.rules` from this folder, and click **Publish**.
5. Commit and push the updated `firebase-config.js`.

Then open the GitHub Pages URL: the app asks for a household code. Tap
**Create a new household code**, enter your name, and you're in. Your wife
opens the same URL on her phone, types in that code and her name, and you're
both looking at the same planner. Any tasks either of you made in local mode
are folded in automatically.

(The values in `firebase-config.js` are safe to publish — data is only
reachable through the household code, which never appears in the repo.)

## Using it day to day

- On your phone, open the site and use the browser menu → **Add to Home
  Screen**. It opens full-screen like a native app.
- The little colored badge on a task shows who added it (from the name you
  entered).
- The **→** button pushes a task to the next day; on an "Anytime" task it
  moves it to today.
- The **⚙** button (top right) is where you change the code or your name.

There are no passwords: the household code is the only key. That's perfect
for groceries and weekend plans — just don't keep anything sensitive in it.

## How the code is organized

| File                 | What it does                                              |
| -------------------- | --------------------------------------------------------- |
| `index.html`         | The page skeleton and the screens (planner, code entry)   |
| `style.css`          | All styling, including dark mode and phone layouts        |
| `app.js`             | Rendering and interactions (weeks, day cards, task rows)  |
| `store.js`           | Data layer — localStorage or Firebase, same interface     |
| `firebase-config.js` | Your Firebase project's config (empty = local mode)       |
| `firestore.rules`    | The security rules you paste into the Firebase console    |

## Pushing to GitHub

Create an empty repository on <https://github.com/new> (no README), then run:

```
git remote add origin https://github.com/YOUR-USERNAME/REPO-NAME.git
git push -u origin main
```
