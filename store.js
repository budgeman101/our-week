/*
 * Store — the data layer.
 *
 * If firebase-config.js is filled in, tasks live in Firebase (Cloud
 * Firestore) and sync live between everyone who signs in. Otherwise tasks
 * fall back to localStorage in this browser only.
 *
 * A task looks like:
 *   { id, text, day: "YYYY-MM-DD" | null, done, createdAt, createdBy }
 * day === null means it sits on the "Anytime" list.
 */
const Store = (() => {
  const hasFirebase =
    typeof FIREBASE_CONFIG === "object" && !!FIREBASE_CONFIG.apiKey;

  let onTasks = () => {};
  let onState = () => {};
  const state = {
    mode: hasFirebase ? "cloud" : "local",
    status: "loading", // loading | signedout | denied | error | ready
    user: null,
  };

  function setState(patch) {
    Object.assign(state, patch);
    onState(state);
  }

  /* ---------- local mode (this browser only) ---------- */

  const LS_KEY = "ourweek.tasks";
  let localTasks = [];

  function localSave() {
    localStorage.setItem(LS_KEY, JSON.stringify(localTasks));
    onTasks([...localTasks]);
  }

  const local = {
    async init() {
      try {
        localTasks = JSON.parse(localStorage.getItem(LS_KEY)) || [];
      } catch {
        localTasks = [];
      }
      setState({ status: "ready" });
      onTasks([...localTasks]);
    },
    add(fields) {
      localTasks.push({
        id: crypto.randomUUID(),
        done: false,
        createdAt: Date.now(),
        createdBy: null,
        ...fields,
      });
      localSave();
    },
    update(id, patch) {
      const task = localTasks.find((t) => t.id === id);
      if (task) Object.assign(task, patch);
      localSave();
    },
    remove(id) {
      localTasks = localTasks.filter((t) => t.id !== id);
      localSave();
    },
  };

  /* ---------- cloud mode (Firebase, shared + synced) ---------- */

  const SDK = "https://www.gstatic.com/firebasejs/10.14.1/";
  let auth = null;
  let db = null;
  let unsubscribe = null;

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error("Failed to load " + src));
      document.head.appendChild(s);
    });
  }

  const cloud = {
    async init() {
      await loadScript(SDK + "firebase-app-compat.js");
      await Promise.all([
        loadScript(SDK + "firebase-auth-compat.js"),
        loadScript(SDK + "firebase-firestore-compat.js"),
      ]);
      firebase.initializeApp(FIREBASE_CONFIG);
      auth = firebase.auth();
      db = firebase.firestore();
      try {
        await db.enablePersistence({ synchronizeTabs: true });
      } catch {
        /* another tab has it, or browser doesn't support it — still works online */
      }

      auth.onAuthStateChanged((user) => {
        if (unsubscribe) {
          unsubscribe();
          unsubscribe = null;
        }
        if (!user) {
          setState({ status: "signedout", user: null });
          return;
        }
        setState({
          status: "loading",
          user: { email: user.email, name: user.displayName },
        });
        unsubscribe = db.collection("tasks").onSnapshot(
          (snap) => {
            setState({ status: "ready" });
            onTasks(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
          },
          (err) => {
            setState({
              status: err.code === "permission-denied" ? "denied" : "error",
              error: err.message,
            });
          }
        );
      });
    },
    add(fields) {
      db.collection("tasks").add({
        done: false,
        createdAt: Date.now(),
        createdBy: auth.currentUser.email,
        ...fields,
      });
    },
    update(id, patch) {
      db.collection("tasks").doc(id).update(patch);
    },
    remove(id) {
      db.collection("tasks").doc(id).delete();
    },
  };

  /* ---------- public interface ---------- */

  const impl = hasFirebase ? cloud : local;

  return {
    get mode() {
      return state.mode;
    },
    get user() {
      return state.user;
    },
    init(handlers) {
      onTasks = handlers.onTasks;
      onState = handlers.onState;
      return impl.init();
    },
    add: (fields) => impl.add(fields),
    update: (id, patch) => impl.update(id, patch),
    remove: (id) => impl.remove(id),
    signIn() {
      const provider = new firebase.auth.GoogleAuthProvider();
      // Popup is nicest; some mobile browsers block it, so fall back to redirect.
      auth.signInWithPopup(provider).catch(() => auth.signInWithRedirect(provider));
    },
    signOut() {
      auth.signOut();
    },
  };
})();
