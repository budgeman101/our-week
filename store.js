/*
 * Store — the data layer.
 *
 * Local mode (firebase-config.js empty): tasks live in this browser's
 * localStorage and nothing syncs.
 *
 * Cloud mode (config filled in): tasks live in Firestore under
 * households/<code>/tasks and sync live between every device that has
 * entered the same household code. There are no accounts or passwords —
 * knowing the code is what grants access, like a house key.
 *
 * A task looks like:
 *   { id, text, day: "YYYY-MM-DD" | null, done, createdAt, createdBy }
 * day === null means it sits on the "Anytime" list.
 */
const Store = (() => {
  const hasFirebase =
    typeof FIREBASE_CONFIG === "object" && !!FIREBASE_CONFIG.apiKey;

  const LS_TASKS = "ourweek.tasks";
  const LS_HOUSEHOLD = "ourweek.household";
  const LS_NAME = "ourweek.name";

  let onTasks = () => {};
  let onState = () => {};
  const state = {
    mode: hasFirebase ? "cloud" : "local",
    status: "loading", // loading | needs-household | error | ready
    household: localStorage.getItem(LS_HOUSEHOLD) || "",
    name: localStorage.getItem(LS_NAME) || "",
    error: "",
  };

  function setState(patch) {
    Object.assign(state, patch);
    onState(state);
  }

  /* ---------- local mode (this browser only) ---------- */

  let localTasks = [];

  function localSave() {
    localStorage.setItem(LS_TASKS, JSON.stringify(localTasks));
    onTasks([...localTasks]);
  }

  const local = {
    async init() {
      try {
        localTasks = JSON.parse(localStorage.getItem(LS_TASKS)) || [];
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
  let db = null;
  let col = null;
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

  let connectTimer = null;

  function connect() {
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
    setState({ status: "loading" });
    // If Firestore can't answer at all (bad config, no internet), it retries
    // silently forever — surface an error instead of an endless spinner.
    clearTimeout(connectTimer);
    connectTimer = setTimeout(() => {
      if (state.status === "loading") {
        setState({
          status: "error",
          error:
            "Can't reach the shared planner. Check your internet connection and the Firebase setup steps in README.md.",
        });
      }
    }, 15000);
    col = db.collection("households").doc(state.household).collection("tasks");
    unsubscribe = col.onSnapshot(
      (snap) => {
        clearTimeout(connectTimer);
        setState({ status: "ready" });
        onTasks(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        importLocalTasks();
      },
      (err) => {
        clearTimeout(connectTimer);
        setState({
          status: "error",
          error:
            err.code === "permission-denied"
              ? "The database said no. Check that the rules from firestore.rules are published in the Firebase console."
              : "Couldn't reach the shared planner — check your internet connection and try again. (" +
                (err.code || "unknown error") + ")",
        });
      }
    );
  }

  // One-time: if this browser still has tasks from local mode, fold them
  // into the shared household so nothing is lost.
  let importedLocal = false;
  function importLocalTasks() {
    if (importedLocal) return;
    importedLocal = true;
    let old = [];
    try {
      old = JSON.parse(localStorage.getItem(LS_TASKS)) || [];
    } catch {
      old = [];
    }
    if (!old.length) return;
    const batch = db.batch();
    for (const t of old) {
      batch.set(col.doc(), {
        text: t.text,
        day: t.day || null,
        done: !!t.done,
        createdAt: t.createdAt || Date.now(),
        createdBy: state.name || null,
      });
    }
    batch.commit().then(() => localStorage.removeItem(LS_TASKS));
  }

  const cloud = {
    async init() {
      await loadScript(SDK + "firebase-app-compat.js");
      await loadScript(SDK + "firebase-firestore-compat.js");
      firebase.initializeApp(FIREBASE_CONFIG);
      db = firebase.firestore();
      try {
        await db.enablePersistence({ synchronizeTabs: true });
      } catch {
        /* another tab has it, or browser doesn't support it — still works online */
      }
      if (state.household) connect();
      else setState({ status: "needs-household" });
    },
    add(fields) {
      col.add({
        done: false,
        createdAt: Date.now(),
        createdBy: state.name || null,
        ...fields,
      });
    },
    update(id, patch) {
      col.doc(id).update(patch);
    },
    remove(id) {
      col.doc(id).delete();
    },
  };

  /* ---------- public interface ---------- */

  const impl = hasFirebase ? cloud : local;

  return {
    get mode() {
      return state.mode;
    },
    get household() {
      return state.household;
    },
    get name() {
      return state.name;
    },
    init(handlers) {
      onTasks = handlers.onTasks;
      onState = handlers.onState;
      return impl.init();
    },
    add: (fields) => impl.add(fields),
    update: (id, patch) => impl.update(id, patch),
    remove: (id) => impl.remove(id),
    joinHousehold(code, name) {
      localStorage.setItem(LS_HOUSEHOLD, code);
      localStorage.setItem(LS_NAME, name);
      Object.assign(state, { household: code, name });
      connect();
    },
    generateCode() {
      // 12 chars from a no-lookalikes alphabet, e.g. "k7pm-3xqf-9wt2"
      const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
      const bytes = crypto.getRandomValues(new Uint8Array(12));
      let code = "";
      bytes.forEach((b, i) => {
        code += alphabet[b % alphabet.length];
        if (i === 3 || i === 7) code += "-";
      });
      return code;
    },
  };
})();
