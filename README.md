# 🗓️ Our Week

A weekly planner and to-do list for two people. Add tasks to any day of the
week (or to the "Anytime" list), check them off, push unfinished ones to the
next day. Works great on phones — add it to your home screen and it feels like
an app.

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
will ever use. One of you does this once (~10 minutes):

1. Go to <https://console.firebase.google.com> and sign in with your Google
   account. Click **Create a project** (any name, e.g. `our-week`). You can
   say no to Google Analytics.
2. **Add a web app:** on the project overview page click the `</>` icon,
   give it any nickname, and register. Firebase shows a `firebaseConfig`
   code block — copy those values into `firebase-config.js` in this folder.
3. **Turn on Google sign-in:** in the left menu go to **Build →
   Authentication** → *Get started* → *Sign-in method* → enable **Google**.
4. **Authorize your site:** still in Authentication, open **Settings →
   Authorized domains** and add `YOUR-USERNAME.github.io`.
5. **Create the database:** go to **Build → Firestore Database** → *Create
   database* → choose **production mode** and any nearby region.
6. **Lock it to the two of you:** in Firestore open the **Rules** tab, paste
   the contents of `firestore.rules` from this folder, replace the two
   placeholder emails with your real Gmail addresses, and click **Publish**.
7. Commit and push the updated `firebase-config.js`.

Now open the GitHub Pages URL, sign in with Google, and you'll both be
looking at the same planner. (The values in `firebase-config.js` are safe to
publish — the security rules from step 6 are what control access.)

> **Note:** Google sign-in doesn't work when opening `index.html` directly
> from your disk — test cloud mode on the GitHub Pages URL.

## Using it day to day

- On your phone, open the site and use the browser menu → **Add to Home
  Screen**. It opens full-screen like a native app.
- The little colored badge on a task shows who added it.
- The **→** button pushes a task to the next day; on an "Anytime" task it
  moves it to today.

## How the code is organized

| File                 | What it does                                             |
| -------------------- | -------------------------------------------------------- |
| `index.html`         | The page skeleton and the three screens (sign-in, etc.)  |
| `style.css`          | All styling, including dark mode and phone layouts        |
| `app.js`             | Rendering and interactions (weeks, day cards, task rows) |
| `store.js`           | Data layer — localStorage or Firebase, same interface     |
| `firebase-config.js` | Your Firebase project's config (empty = local mode)      |
| `firestore.rules`    | Template for the security rules you paste into Firebase  |

## Pushing to GitHub

Create an empty repository on <https://github.com/new> (no README), then run:

```
git remote add origin https://github.com/YOUR-USERNAME/REPO-NAME.git
git push -u origin main
```
