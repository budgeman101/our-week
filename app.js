/* ================================================================== *
 *  Our Week — a household's shared plan, projects & handoff notes.
 *  Three views: Week (daily plan), Projects, Notes (shared board).
 *  Everything on the day view is editable, addable, and syncs.
 * ================================================================== */

const HAS_DOM = typeof document !== "undefined";
if (typeof localStorage === "undefined") {           // node/test shim
  globalThis.localStorage = { _d:{}, getItem(k){return this._d[k]??null;},
    setItem(k,v){this._d[k]=String(v);}, removeItem(k){delete this._d[k];} };
}

/* ------------------------------------------------------------------ *
 *  CONFIG — paste your Firebase keys here to turn on live phone sync.
 *  Leave the PASTE_ values to run offline on a single device.
 *  Full walkthrough in SETUP-GUIDE.md.
 * ------------------------------------------------------------------ */
const firebaseConfig = {
  apiKey: "AIzaSyDOGNa93lAi7lLzt_wpQl26QFQfWysIyvs",
  authDomain: "our-week-bl-55477.firebaseapp.com",
  projectId: "our-week-bl-55477",
  storageBucket: "our-week-bl-55477.firebasestorage.app",
  messagingSenderId: "579975197541",
  appId: "1:579975197541:web:27e82873afb327da48a78c"
};
// Opening the app with ?local=1 keeps everything on this device — handy
// for trying things out without touching the live shared plan.
const FORCE_LOCAL = HAS_DOM && /[?&]local=1/.test(location.search);
const CONFIGURED = !String(firebaseConfig.apiKey).startsWith("PASTE_") && !FORCE_LOCAL;

/* ------------------------------------------------------------------ *
 *  PUSH REMINDERS — paste your VAPID PUBLIC key here (safe to publish).
 *  The matching private key lives only in the free cloud sender.
 *  Full walkthrough in REMINDERS-SETUP.md.
 * ------------------------------------------------------------------ */
const VAPID_PUBLIC_KEY = "BO4M0rjTcevPmcBdN76KMv0Z28_oMZ0zByxUh2OsH0pJuOKGnO5sIEO2p2sQkm6g2ZlruNb2rtqiO-LV15GQDQ0";
const PUSH_KEYED = /^[A-Za-z0-9_-]{80,}$/.test(VAPID_PUBLIC_KEY);

/* ============================ constants =========================== */
const WHO = { ben:"Ben", lindsay:"Lindsay", both:"Both" };   // display names by id — rebuilt by applyNames()
const WHO_ORDER = ["ben","lindsay","both"];                  // member ids + "both" last — rebuilt by applyNames()
const DAY_FULL  = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
const DAY_SHORT = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
const CARE_ICONS = ["i-paw","i-child","i-leaf","i-heart","i-list"];

/* -------------------- household people (members) ------------------ *
 *  Every household keeps its own list of people in one meta:members
 *  doc: { list:[{id, name, color}, …] }. No doc = the two original
 *  slots (ids "ben"/"lindsay", names from meta:names when present), so
 *  every existing household — including the original one — keeps
 *  working without touching a single task. Internal ids never change
 *  and are never shown; renames only touch the display name. "both"
 *  stays the stored value for a shared task: it reads "Both" for a
 *  couple and "Everyone" for a bigger household.
 *  Names are cleaned of <, > and & at save AND read, which keeps every
 *  `${WHO[...]}` template injection safe. */
const MEMBER_COLORS = [
  ["#2563eb","#dbeafe"],   // blue — the original first slot
  ["#db2777","#fce7f3"],   // pink — the original second slot
  ["#059669","#d1fae5"],   // green
  ["#d97706","#fef3c7"],   // amber
  ["#7c3aed","#ede9fe"],   // violet
  ["#0891b2","#cffafe"],   // teal
];
const MAX_MEMBERS = 6;
const WHO_DEFAULT = { ben:"Ben", lindsay:"Lindsay" };
function cleanName(s){ return String(s||"").replace(/[<>&]/g,"").trim().slice(0,20); }
function namesDoc(){ return items["meta:names"]; }
function membersDoc(){ return items["meta:members"]; }
/* stable id for the person typed into welcome slot i — the first two
   map onto the original slots so nothing about existing data migrates */
function memberIdFor(i){ return i===0 ? "ben" : i===1 ? "lindsay" : "p"+(i+1); }
/* the sanitized people list — always at least the two original slots */
function members(){
  const md = membersDoc();
  if(md && Array.isArray(md.list)){
    const seen = {}, out = [];
    md.list.forEach(m=>{
      if(!m) return;
      const id = String(m.id||"").toLowerCase();
      if(!/^[a-z][a-z0-9]*$/.test(id) || id==="both" || seen[id]) return;
      seen[id] = 1;
      out.push({ id, name: cleanName(m.name) || "Person "+(out.length+1),
                 color: (typeof m.color==="number" && MEMBER_COLORS[m.color]) ? m.color : out.length % MEMBER_COLORS.length });
    });
    if(out.length>=2) return out.slice(0, MAX_MEMBERS);
  }
  const n = namesDoc()||{};
  const preSetup = !household && !me;   // welcome backdrop: show no real names
  return [
    { id:"ben",     name: cleanName(n.ben)     || (preSetup ? "Person 1" : WHO_DEFAULT.ben),     color:0 },
    { id:"lindsay", name: cleanName(n.lindsay) || (preSetup ? "Person 2" : WHO_DEFAULT.lindsay), color:1 },
  ];
}
function memberColor(id){ const m=members().find(x=>x.id===id); return MEMBER_COLORS[m ? m.color : 0]; }
/* safe display for any stored who value — a removed person's tasks read as shared */
function normWho(w){ return WHO[w] ? w : "both"; }
function whoLabel(w){ return WHO[normWho(w)]; }
function applyNames(){
  const list = members();
  Object.keys(WHO).forEach(k=>{ delete WHO[k]; });
  WHO_ORDER.length = 0;
  list.forEach(m=>{ WHO[m.id]=m.name; WHO_ORDER.push(m.id); });
  WHO.both = list.length>2 ? "Everyone" : "Both";
  WHO_ORDER.push("both");
  if(HAS_DOM){
    paintMemberStyles(list);
    paintLegend(list);
    paintIdRow(list);
    const nc=document.getElementById("noteText");
    if(nc) nc.placeholder = list.length>2 ? "Leave a note for the others…" : "Leave a note for the other…";
  }
}
/* per-person colors become CSS rules so every tag/checkbox just works */
function paintMemberStyles(list){
  let st=document.getElementById("memberStyles");
  if(!st){ st=document.createElement("style"); st.id="memberStyles"; document.head.appendChild(st); }
  st.textContent = list.map(m=>{
    const c=MEMBER_COLORS[m.color][0], bg=MEMBER_COLORS[m.color][1];
    return ".who."+m.id+"{background:"+bg+";color:"+c+"}"+
           ".item."+m.id+" .box{border-color:"+c+"}"+
           ".cuwho."+m.id+"{background:"+bg+";color:"+c+"}";
  }).join("\n");
}
function paintLegend(list){
  const lg=document.getElementById("legend"); if(!lg) return;
  lg.innerHTML = list.map(m=>'<span class="lg"><span class="sw" style="background:'+MEMBER_COLORS[m.color][0]+'"></span>'+esc(m.name)+'</span>').join("")
    + '<span class="lg"><span class="sw" style="background:var(--both)"></span>'+esc(WHO.both)+' (bold)</span>';
}
function paintIdRow(list){
  const row=document.getElementById("setIdRow"); if(!row) return;
  row.innerHTML = list.map(m=>'<button data-id="'+m.id+'" class="'+(me===m.id?"on":"")+'">'+esc(m.name)+'</button>').join("");
}
/* the partner card's free note row: "Furniture" for the original
   household, "Notes" for households created via the new welcome setup */
function noteRowLabel(){ const n=namesDoc(); return (n && n.noteLabel) || "Furniture"; }
function escRe(s){ return String(s).replace(/[.*+?^${}()|[\]\\]/g,"\\$&"); }
/* an explicit name in the text beats keyword guessing — keywords are
   a household's habits, a name is a direct instruction */
function whoFromName(s){
  for(const m of members()){
    const nm=m.name.trim().toLowerCase();
    if(nm && new RegExp("\\b"+escRe(nm)+"\\b").test(s)) return m.id;
  }
  return null;
}

/* ================= master List: areas + auto-sorting =============== *
 *  Tasks dumped in (typed, Siri inbox, or imported) sort themselves
 *  by who and area — same shape as the paper "Household To-Do List".
 *  Guesses are always fixable with a tap; nothing is ever mis-lost.
 * ------------------------------------------------------------------ */
const AREAS = {
  shop:"Shop & Furniture", house:"Around the House", cleaning:"Cleaning & Tidying",
  kitchen:"Kitchen", laundry:"Laundry & Clothes", yard:"Yard & Outdoor",
  garage:"Garage & Organizing", paint:"Painting & Home", selling:"Selling & Listing",
  organizing:"Organizing", plants:"Plants", pets:"Pets",
  errands:"Errands & Admin", personal:"Personal", other:"Other",
};
const AREA_ORDER = Object.keys(AREAS);
/* first matching rule wins — specific areas before broad ones */
const AREA_RULES = [
  ["personal", /\b(nails?|toenails?|cuticles?|rosary|bio.?oil|ulike|hair.?removal|haircut)\b/],
  ["selling",  /\b(sell|listing|price|marketplace|kijiji)\b|^list\b/],
  ["pets",     /\b(pets?|dogs?|cats?|lou ?lou|vet|leash|litter)\b/],
  ["plants",   /\bplants?\b/],
  ["shop",     /\b(shop|dresser|workbench)\b/],
  ["laundry",  /\b(laundry|fold(ing)?|iron(ing)?|clothes)\b/],
  ["yard",     /\b(weed\w*|lawn|rake|garden|prun\w+|raspberr\w+|patio|hose|mow\w*|de.?pest|diatomaceous|hedge|fence|bbq|barbecue)\b/],
  ["garage",   /\b(garage|ladder|chargers?|cords?)\b/],
  ["kitchen",  /\b(dishwasher|pantry|slow.?cooker|dehydrator|green bin|fridge|freezer|meal.?plan\w*|kitchen|dishes)\b/],
  ["paint",    /\b(paint\w*|prime|frame)\b/],
  ["errands",  /\b(grocer\w*|depot|dollarama|recycl\w*|tires?|temu|order\w*|returns?|pick.?up|ipad|bank|mail|post office|truck)\b/],
  ["organizing",/\b(organi[sz]\w+|bookshel(f|ves)|books)\b/],
  ["house",    /\b(shel(f|ves)|move the|curtains?|picture)\b/],
  ["cleaning", /\b(clean\w*|wash\w*|wipe|dust\w*|vacuum|mop|scrub|tidy\w*|declutter|sheets?|rugs?|shower|bathroom|sweep|bins?)\b/],
];
const WHO_RULES = [
  ["both",    /\b(to the shop|shel(f|ves)|both|together|family)\b|\bwe\b/],
  ["lindsay", /\b(laundry|fold(ing)?|sell|listing|price|plants?|nails?|cuticles?|rosary|bio.?oil|ulike|pantry|meal.?plan\w*|temu|walls|rugs?|stroller|wagon|swing|toy room|bookshel(f|ves)|maiya|lindsay)\b/],
  ["ben",     /\b(weed\w*|lawn|rake|garden|prun\w+|patio|bbq|barbecue|hose|garage|ladder|chargers?|cords?|paint\w*|prime|frame|grocer\w*|depot|dollarama|recycl\w*|tires?|truck|ipad|dishwasher|bed.?sheets|under the bed|ottoman|tv|ledges|ben)\b/],
];
/* fallback when no who-keyword hits: the usual split per area */
const AREA_WHO_DEFAULT = { shop:"both", house:"both", cleaning:"lindsay", kitchen:"lindsay",
  laundry:"lindsay", yard:"ben", garage:"ben", paint:"ben", selling:"lindsay", organizing:"lindsay",
  plants:"lindsay", pets:"ben", errands:"ben", personal:"lindsay", other:"both" };

/* The who-keywords above are the ORIGINAL household's real-life split —
   personal habits, not truths. Households created through the welcome
   card (marked by noteLabel:"Notes" on their names doc) skip them: a
   typed name still wins, "together" words still mean everyone, and
   anything else lands on Everyone to be tapped into place. */
function tunedHousehold(){ const n=namesDoc(); return !(n && n.noteLabel==="Notes"); }

function classify(text){
  const s=String(text).toLowerCase();
  let area="other";
  for(const r of AREA_RULES){ if(r[1].test(s)){ area=r[0]; break; } }
  let who = WHO_RULES[0][1].test(s) ? "both" : whoFromName(s);
  if(!who && tunedHousehold()) for(const r of WHO_RULES){ if(r[1].test(s)){ who=r[0]; break; } }
  return { area, who: who || (tunedHousehold() ? (AREA_WHO_DEFAULT[area]||"both") : "both") };
}
// who for a project step: only override the project's person when the step
// wording strongly points at someone, else inherit the project.
function classifyWho(text, fallback){
  const s=String(text).toLowerCase();
  if(WHO_RULES[0][1].test(s)) return "both";
  const byName=whoFromName(s);
  if(byName) return byName;
  if(tunedHousehold()) for(const r of WHO_RULES){ if(r[1].test(s)) return r[0]; }
  return fallback || "both";
}

/* "…on thursday" / "…tomorrow" schedules straight onto that day */
const DAY_WORDS = { monday:0, tuesday:1, wednesday:2, thursday:3, friday:4, saturday:5, sunday:6 };
function extractDay(text){
  const re=/\s*\b(?:on|for)\s+(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b|\s*\b(today|tomorrow)\b\s*$/i;
  const m=String(text).match(re);
  if(!m) return { text:String(text), iso:null };
  const word=(m[1]||m[2]).toLowerCase();
  const d=new Date();
  if(word==="tomorrow") d.setDate(d.getDate()+1);
  else if(word!=="today") d.setDate(d.getDate() + ((DAY_WORDS[word]-((d.getDay()+6)%7)+7)%7));
  return { text:String(text).replace(m[0]," ").replace(/\s{2,}/g," ").trim(), iso:isoOf(d) };
}

/* =================== seed source (defaults only) ================== */
const DAYPLAN = {
  0:{ headline:"Lindsay works tonight → solo evening, Ben walks Lou Lou.",
      energy:"Works tonight — light", furniture:"~2 hrs (afternoon)",
      cleanWho:"both", clean:"Bins out (Ben). Bathrooms deep-clean (Lindsay): shower head, fan, windows, drawers.",
      care:[["i-child","Sam — morning play"],["i-paw","Lou Lou — Ben walks"]] },
  1:{ headline:"Off a shift + works tonight → solo evening, Ben walks Lou Lou.",
      energy:"Off a shift + works tonight — lightest", furniture:"Rest / optional 1 hr",
      cleanWho:"both", clean:"Laundry deep-clean (Lindsay): wipe washer/dryer, fresh linens. Ben starts the load, she folds.",
      care:[["i-child","Sam — cuddles + play"],["i-paw","Lou Lou — Ben walks"]] },
  2:{ headline:"Sleeps off the night shift → gymnastics + chairs together, then Ben's got Sam + the mornings.",
      energy:"Recovery — light", furniture:"~2 hrs once rested",
      cleanWho:"lindsay", clean:"Kitchen / Dining deep-clean (Lindsay): pantry, fridge, freezer, appliances.",
      care:[["i-child","Sam — play + stroller loop"],["i-paw","Lou Lou — Ben walks"],
            ["i-list","Admin — bills, appointments, calls, emails; returns/orders; plan the week (once rested)"]] },
  3:{ headline:"Furniture day (~4 hrs) → Ben takes Sam + the family walk.",
      energy:"Full day — rested", furniture:"~4 hrs (the big one)",
      cleanWho:"lindsay", clean:"Living Room deep-clean (Lindsay) — kept light, it's her big furniture day.",
      care:[["i-child","Sam — park outing"],["i-paw","Lou Lou — family walk"]] },
  4:{ headline:"Works tonight → solo evening, Ben walks Lou Lou.",
      energy:"Works tonight — light", furniture:"~2 hrs (afternoon)",
      cleanWho:"lindsay", clean:"Bedrooms deep-clean (Lindsay): under beds, closets, baseboards. Ben's got the sheets + under-bed.",
      care:[["i-child","Sam — morning play"],["i-paw","Lou Lou — Ben walks"]] },
  5:{ headline:"Recovers from the night shift → Ben covers, walks Lou Lou.",
      energy:"Recovery — light", furniture:"Rest / optional 1 hr",
      cleanWho:"both", clean:"Outside / Yard / Garden — Ben + family: prune plants & hedges, weed the fence line, sweep, de-pest.",
      care:[["i-child","Sam — easy play"],["i-paw","Lou Lou — Ben walks"]] },
  6:{ headline:"Church AM → family day with Lindsay + Sam.",
      energy:"Church AM — home ~1 pm", furniture:"~3 hrs (afternoon)",
      cleanWho:"both", clean:"Rest day — relax with Lindsay & Sam.",
      care:[["i-child","Sam — church + family"],["i-paw","Lou Lou — family walk"]] },
};
const ROUTINE = {
  morning:[
    {id:"m0", text:"Sam wake-up — 7–8 am", who:"both"},
    {id:"m1", text:"Change Sam out of PJs", who:"both"},
    {id:"m2", text:"Brush Sam's teeth", who:"both"},
    {id:"m3", text:"Feed Sam breakfast", who:"both"},
    {id:"m4", text:"Walk Lou Lou", who:"ben"},
    {id:"m5", text:"Make the bed", who:"ben"},
  ],
  night:[
    {id:"n0", text:"Vacuum", who:"ben"},
    {id:"n1", text:"Tidy the kitchen", who:"ben"},
    {id:"n2", text:"Wipe counters + bathroom counter", who:"ben"},
    {id:"n3", text:"Run the dishwasher", who:"ben"},
    {id:"n4", text:"Read Sam a bedtime story", who:"both"},
  ],
  each:[
    {id:"e0", text:"Study — ~2 hrs (naptime + after bedtime)", who:"ben"},
    {id:"e1", text:"Water the plants", who:"lindsay"},
    {id:"e2", text:"Pick up after the dogs (yard)", who:"both"},
  ],
};
const SEED_VERSION = "planv1";
const TPL_VERSION  = "tpl2";
const SEED = [
  {d:"2026-06-16", who:"ben",  text:"Pick up wood fill from the shop"},
  {d:"2026-06-16", who:"ben",  text:"Stairs — part 1: wood-fill + sand"},
  {d:"2026-06-16", who:"ben",  text:"Start a laundry load"},
  {d:"2026-06-17", who:"both", text:"Sam gymnastics — 10:30 am"},
  {d:"2026-06-17", who:"both", text:"Pick up chairs (right after gymnastics)"},
  {d:"2026-06-17", who:"ben",  text:"Wash marker off the lampshade"},
  {d:"2026-06-17", who:"ben",  text:"Take all supplies back where they belong"},
  {d:"2026-06-18", who:"ben",  text:"Clean under the bed"},
  {d:"2026-06-18", who:"ben",  text:"Tidy round the main rooms"},
  {d:"2026-06-18", who:"both", text:"Family walk with Lou Lou"},
  {d:"2026-06-19", who:"ben",  text:"Change the bedsheets"},
  {d:"2026-06-19", who:"ben",  text:"Put away the heated blanket"},
  {d:"2026-06-20", who:"ben",  text:"Stairs — part 2: prime + paint (after it cures)"},
  {d:"2026-06-21", who:"both", text:"Family time — park, slow walk, or rest"},
  {d:"2026-06-22", who:"ben",  text:"Catch up on anything that slipped"},
];

/* =============================== state ============================ */
let items = {};
let household = localStorage.getItem("ow-household") || "";
let me = localStorage.getItem("ow-me") || "";
let view = "week";
let projSort = localStorage.getItem("ow-projsort") || "smart";
let currentMonday = mondayOf(new Date());
let selDay = todayMonIndex();
let welcomeId = "";                    // welcome card: index of the tapped "this phone is" name
let rolodexMid = null;                 // which person's day-card is in view (sticks across re-renders)
let db = null, colRef = null, unsub = null, inboxUnsub = null, fbStarted = false;
let undoTimer = null, lastDeleted = null;
let editingId = null, edWho = "both", edWhoStart = "both", edIcon = "i-paw", splitMode = false, editingFresh = false;

/* ============================= date utils ========================= */
function mondayOf(d){
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - dow);
  return x;
}
function weekKeyOf(d){
  const m = mondayOf(d);
  return m.getFullYear()+"-"+String(m.getMonth()+1).padStart(2,"0")+"-"+String(m.getDate()).padStart(2,"0");
}
function isoOf(d){ return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0"); }
function curWeekKey(){ return weekKeyOf(currentMonday); }
function realWeekKey(){ return weekKeyOf(new Date()); }
function dateForDay(i){ const d=new Date(currentMonday); d.setDate(d.getDate()+i); return d; }
function todayMonIndex(){ return (new Date().getDay()+6)%7; }
function isThisWeek(){ return curWeekKey() === realWeekKey(); }
function todayISO(){ return isoOf(new Date()); }
function selDayISO(){ return isoOf(dateForDay(selDay)); }
function fmtRange(){
  const a=new Date(currentMonday), b=new Date(currentMonday); b.setDate(b.getDate()+6);
  const mo=d=>d.toLocaleDateString("en-US",{month:"short"});
  const end = a.getMonth()===b.getMonth() ? b.getDate() : mo(b)+" "+b.getDate();
  return mo(a)+" "+a.getDate()+" – "+end+", "+b.getFullYear();
}
function fmtDateShort(iso){ const d=new Date(iso+"T00:00:00"); return d.toLocaleDateString("en-US",{weekday:"short", month:"short", day:"numeric"}); }
function relTime(ts){
  const s=Math.floor((Date.now()-ts)/1000);
  if(s<60) return "just now";
  if(s<3600) return Math.floor(s/60)+"m ago";
  if(s<86400) return Math.floor(s/3600)+"h ago";
  const d=Math.floor(s/86400);
  if(d===1) return "yesterday";
  if(d<7) return d+"d ago";
  return new Date(ts).toLocaleDateString("en-US",{month:"short", day:"numeric"});
}
const byOrder = (a,b)=>(a.order||0)-(b.order||0);
function isoOfWeekDay(weekKey, day){ const d=new Date(weekKey+"T00:00:00"); d.setDate(d.getDate()+Number(day||0)); return isoOf(d); }

/* ============================== storage =========================== */
function localKey(){ return "ow-items-"+(household||"default"); }
function saveLocal(){ try{ localStorage.setItem(localKey(), JSON.stringify(items)); }catch(e){} }
function loadLocal(){ try{ items = JSON.parse(localStorage.getItem(localKey())||"{}"); }catch(e){ items={}; } }
function setStatus(synced){
  if(!HAS_DOM) return;
  const p=document.getElementById("status");
  p.textContent = synced ? "Synced" : "This device only";
  p.classList.toggle("synced", !!synced);
}
function put(doc){
  items[doc.id]=doc; saveLocal();
  if(colRef){ colRef.doc(doc.id).set(doc).catch(()=>{}); }
}
function drop(id){
  const d=items[id]; delete items[id]; saveLocal();
  if(colRef){ colRef.doc(id).delete().catch(()=>{}); }
  return d;
}

function connect(){
  if(unsub){ try{ unsub(); }catch(e){} unsub=null; }
  if(inboxUnsub){ try{ inboxUnsub(); }catch(e){} inboxUnsub=null; }
  colRef=null;
  loadLocal(); runSeeders(); render();
  if(CONFIGURED && household && typeof firebase!=="undefined"){
    try{
      if(!fbStarted){ firebase.initializeApp(firebaseConfig); db=firebase.firestore();
        db.enablePersistence({synchronizeTabs:true}).catch(()=>{}); fbStarted=true; }
      colRef = db.collection("households").doc(household).collection("items");
      unsub = colRef.onSnapshot(snap=>{
        const next={}; snap.forEach(doc=> next[doc.id]=doc.data());
        items=next; runSeeders(); saveLocal(); render(); setStatus(true);
      }, ()=> setStatus(false));
      drainInbox();
    }catch(e){ setStatus(false); }
  } else { setStatus(false); }
}

/* Siri (and remote dumps) drop raw docs into households/<code>/inbox —
   pull them in, auto-sort them, then clear the inbox. See SIRI-SETUP.md. */
// One dictated line may hold several tasks — "buy milk, call the dentist".
// Split on commas only: task wording often needs its "and"s intact.
function splitDictation(s){
  return String(s||"").split(",").map(x=>x.trim()).filter(Boolean);
}
function drainInbox(){
  inboxUnsub = db.collection("households").doc(household).collection("inbox")
    .onSnapshot(snap=>{
      let n=0;
      snap.forEach(doc=>{
        const f=doc.data()||{};
        splitDictation(f.text||f.name).forEach(t=>{
          if(importOne({text:t, who:f.who, area:f.area, date:f.date})) n++;
        });
        doc.ref.delete().catch(()=>{});
      });
      if(n){ showToast("Added "+n+" to the List"); render(); }
    }, ()=>{});
}

/* ============================ push reminders ====================== */
function pushSupported(){ return HAS_DOM && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window; }
function urlB64ToUint8(b64){
  const pad="=".repeat((4-b64.length%4)%4);
  const s=(b64+pad).replace(/-/g,"+").replace(/_/g,"/");
  const raw=atob(s); const out=new Uint8Array(raw.length);
  for(let i=0;i<raw.length;i++) out[i]=raw.charCodeAt(i);
  return out;
}
// off | on | denied | needs-sync | needs-keys | unsupported
// "on" means this phone actually HOLDS a push subscription. Permission
// alone isn't enough: code can never un-grant it, so after Turn off the
// permission stays "granted" while the subscription is gone — judging by
// permission made the status stick at ON and the button look broken.
async function reminderState(){
  if(!pushSupported()) return "unsupported";
  if(!CONFIGURED) return "needs-sync";     // no Firebase = nowhere to store the sub / no sender
  if(!PUSH_KEYED) return "needs-keys";     // VAPID key not pasted yet
  if(Notification.permission==="denied") return "denied";
  if(Notification.permission!=="granted") return "off";
  try{
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = reg && await reg.pushManager.getSubscription();
    return sub ? "on" : "off";
  }catch(e){ return "off"; }
}
async function enableReminders(){
  try{
    const perm = await Notification.requestPermission();
    if(perm!=="granted") return perm==="denied" ? "denied" : "off";
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if(!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly:true, applicationServerKey: urlB64ToUint8(VAPID_PUBLIC_KEY) });
    const j = sub.toJSON();
    if(db && household){
      const id = "sub_"+Math.abs(hashStr(j.endpoint)).toString(36);
      db.collection("households").doc(household).collection("push").doc(id)
        .set({ endpoint:j.endpoint, p256dh:j.keys.p256dh, auth:j.keys.auth, who:me||null, ua:navigator.userAgent, ts:Date.now() }).catch(()=>{});
    }
    return "on";
  }catch(e){ console.error("reminders:", e); return "error"; }
}
async function disableReminders(){
  try{
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = reg && await reg.pushManager.getSubscription();
    if(sub){
      const id = "sub_"+Math.abs(hashStr(sub.endpoint)).toString(36);
      if(db && household) db.collection("households").doc(household).collection("push").doc(id).delete().catch(()=>{});
      await sub.unsubscribe();
    }
  }catch(e){ console.error("reminders off:", e); }
}
function hashStr(s){ let h=0; for(let i=0;i<String(s).length;i++){ h=(h*31+s.charCodeAt(i))|0; } return h; }

/* ============================== seeding =========================== */
function setMeta(id){ items[id]={id,kind:"meta",done:true}; if(colRef) colRef.doc(id).set(items[id]).catch(()=>{}); }
function seedDoc(id, fields, force){
  const ex = items[id];
  if(!force && ex) return;
  items[id] = Object.assign({id}, fields);
  if(colRef) colRef.doc(id).set(items[id]).catch(()=>{});
}
function seedTodosIfNeeded(force){
  if(!force && items["meta:seed:"+SEED_VERSION]) return;
  SEED.forEach((s,i)=>{
    const id = "s:"+SEED_VERSION+":"+i;
    if(!force && items[id] && items[id]._gone) return;
    const d = new Date(s.d+"T00:00:00");
    seedDoc(id, { kind:"todo", text:s.text, who:s.who, weekKey:weekKeyOf(d),
      day:(d.getDay()+6)%7, done:false, seed:true, order:1000+i }, force);
  });
  setMeta("meta:seed:"+SEED_VERSION); saveLocal();
}
function seedTemplateIfNeeded(force){
  const sentinel = "meta:tpl:"+TPL_VERSION;
  if(!force && items[sentinel]) return;
  // Bumping TPL_VERSION refreshes the wording (e.g. "you" → "Ben") on existing
  // devices: force the version-controlled text fields, but keep care/routine edits.
  const migrating = !items[sentinel] && Object.keys(items).some(k=>k.indexOf("meta:tpl:")===0);
  const ftext = force || migrating;
  for(let w=0; w<7; w++){
    const p = DAYPLAN[w];
    seedDoc("info:"+w+":headline",  {kind:"info", weekday:w, field:"headline",  text:p.headline}, ftext);
    seedDoc("info:"+w+":energy",    {kind:"info", weekday:w, field:"energy",     text:p.energy}, ftext);
    seedDoc("info:"+w+":furniture", {kind:"info", weekday:w, field:"furniture",  text:p.furniture}, ftext);
    p.care.forEach((c,i)=> seedDoc("care:"+w+":"+i,
      {kind:"tpl", sec:"care", scope:w, check:false, icon:c[0], text:c[1], order:i}, force));
    seedDoc("clean:"+w, {kind:"tpl", sec:"clean", scope:w, check:true, who:p.cleanWho, text:p.clean, order:0}, ftext);
  }
  ["morning","night","each"].forEach(sec=>{
    ROUTINE[sec].forEach((r,i)=> seedDoc("tpl:"+sec+":"+r.id,
      {kind:"tpl", sec, scope:"daily", check:true, who:r.who, text:r.text, order:i}, force));
  });
  setMeta(sentinel); saveLocal();
}
// Lindsay's regular weekly nights, seeded once as repeating shifts so a normal
// week fills itself in (and drives the energy line). Ref dates just fix the
// weekday: 2026-07-06 Mon, -07 Tue, -10 Fri. Summer changes = edit / skip / add.
const SHIFT_SEED_VERSION = "v1";
const REGULAR_SHIFTS = [
  { id:"shift:reg:mon", date:"2026-07-06", start:"17:30" },
  { id:"shift:reg:tue", date:"2026-07-07", start:"17:30" },
  { id:"shift:reg:fri", date:"2026-07-10", start:"16:00" },
];
function seedShiftsIfNeeded(force){
  const sentinel="meta:shiftseed:"+SHIFT_SEED_VERSION;
  if(!force && items[sentinel]) return;
  REGULAR_SHIFTS.forEach(s=> seedDoc(s.id,
    { kind:"shift", label:"", date:s.date, start:s.start, end:"", repeat:true }, force));
  setMeta(sentinel); saveLocal();
}

/* -------- neutral starter for brand-new households (friend-ready) -- *
 *  The welcome card saves a pending setup (the two names + which one
 *  this phone is) locally. On the first look at a household that turns
 *  out to be EMPTY, we write the names and a small generic starter
 *  instead of the original family's plan, and set the legacy sentinels
 *  so the old seeders never fire for it. A household that already has
 *  data is never touched — joining phones just adopt its names. */
const NEUTRAL_CLEAN = ["Kitchen — counters + floor","Bathrooms","Floors — vacuum or mop",
  "Bedrooms — tidy + fresh sheets","Living room","Catch-up + outside jobs","Rest day — nothing scheduled"];
const NEUTRAL_ROUTINE = {
  morning:[ {id:"m0", text:"Make the beds", who:"both"} ],
  night:[ {id:"n0", text:"Tidy the kitchen", who:"both"} ],
  each:[],
};
function pendingSetup(){ try{ return JSON.parse(localStorage.getItem("ow-pending-setup")||"null"); }catch(e){ return null; } }
function clearPendingSetup(){ localStorage.removeItem("ow-pending-setup"); }
/* the names typed on the welcome card, oldest-format-first so a phone
   that saved a pre-members setup still gets through */
function pendingPeople(p){
  if(Array.isArray(p.people)) return p.people.map(cleanName).filter(Boolean).slice(0, MAX_MEMBERS);
  return [cleanName(p.ben), cleanName(p.lindsay)].filter(Boolean);
}
/* phones can type the names in any order — identity follows the NAME
   the person tapped, not the slot it was typed into */
function adoptIdentity(p){
  if(!p || !p.picked || (!namesDoc() && !membersDoc())) return;
  const pick=String(p.picked).trim().toLowerCase();
  const m=members().find(x=>x.name.trim().toLowerCase()===pick);
  if(m && me!==m.id){ me=m.id; localStorage.setItem("ow-me", me); }
}
function seedNeutralIfNeeded(){
  const p=pendingSetup(); if(!p) return;
  const settled = colRef || !CONFIGURED;   // writes reach the cloud (or there is no cloud)
  if(namesDoc() || membersDoc()){ adoptIdentity(p); if(settled) clearPendingSetup(); return; }
  if(Object.values(items).some(t=>t && t.kind && t.kind!=="meta")){
    if(settled) clearPendingSetup();       // existing household — never write over it
    return;
  }
  const names=pendingPeople(p);
  while(names.length<2) names.push("Person "+(names.length+1));
  put({ id:"meta:names", kind:"names", ben:names[0], lindsay:names[1], noteLabel:"Notes" });
  put({ id:"meta:members", kind:"members",
        list: names.map((nm,i)=>({ id:memberIdFor(i), name:nm, color:i%MEMBER_COLORS.length })) });
  NEUTRAL_CLEAN.forEach((text,w)=> seedDoc("clean:"+w,
    {kind:"tpl", sec:"clean", scope:w, check:true, who:"both", text, order:0}));
  ["morning","night","each"].forEach(sec=> NEUTRAL_ROUTINE[sec].forEach((r,i)=> seedDoc("tpl:"+sec+":"+r.id,
    {kind:"tpl", sec, scope:"daily", check:true, who:r.who, text:r.text, order:i})));
  setMeta("meta:seed:"+SEED_VERSION); setMeta("meta:tpl:"+TPL_VERSION); setMeta("meta:shiftseed:"+SHIFT_SEED_VERSION);
  applyNames(); adoptIdentity(p);
  if(settled) clearPendingSetup();
  saveLocal();
}
/* one gate for every (re)connect + snapshot: new-style households seed
   neutral, everything else keeps the original behaviour (sentinels make
   re-runs no-ops either way) */
function runSeeders(){
  if(pendingSetup() || namesDoc() || membersDoc()) seedNeutralIfNeeded();
  else { seedTodosIfNeeded(); seedTemplateIfNeeded(); seedShiftsIfNeeded(); }
  autoRoll(); migrateRemoveJohny();
}
function autoRoll(){
  const rk = realWeekKey(); let n=0;
  Object.values(items).forEach(t=>{
    if(t.kind==="todo" && !t._gone && !t.done && !t.repeat && t.weekKey && t.weekKey < rk){
      t.weekKey = rk; items[t.id]=t; n++;
      if(colRef) colRef.doc(t.id).set(t).catch(()=>{});
    }
  });
  if(n) saveLocal();
}
// One-time cleanup: strip any care chip mentioning Johny from existing
// devices/cloud (the source no longer seeds them). Runs once per household.
function migrateRemoveJohny(){
  if(items["meta:mig:nojohny"]) return;
  Object.values(items).forEach(t=>{
    if(t.kind==="tpl" && t.sec==="care" && /johny/i.test(t.text||"")){
      if(isSeeded(t)){ t._gone=true; t.done=true; put(t); } else drop(t.id);
    }
  });
  setMeta("meta:mig:nojohny"); saveLocal();
}

/* ============================= selectors ========================== */
function infoText(w, field){ const d=items["info:"+w+":"+field]; return d ? d.text : ""; }
function careItems(w){ return Object.values(items).filter(t=>t.kind==="tpl"&&t.sec==="care"&&t.scope===w&&!t._gone).sort(byOrder); }
function tplList(sec, scope){ return Object.values(items).filter(t=>t.kind==="tpl"&&t.sec===sec&&t.scope===scope&&!t._gone).sort(byOrder); }
// per-week done for a recurring to-do; plain done otherwise
function todoDoneKey(t, wk){ return "tdone:"+t.id+":"+(wk||curWeekKey()); }
function todoDone(t){ return t.repeat ? !!items[todoDoneKey(t)] : !!t.done; }
function todosForSel(){
  const wk=curWeekKey();
  return Object.values(items)
    .filter(t=>t.kind==="todo" && !t._gone && (t.repeat ? t.day===selDay : (t.weekKey===wk && t.day===selDay)))
    .sort((a,b)=>(todoDone(a)-todoDone(b))||((a.order||0)-(b.order||0)));
}
function masterTodos(){
  return Object.values(items)
    .filter(t=>t.kind==="todo" && !t._gone && !t.weekKey && !t.repeat)
    .sort((a,b)=>(a.done-b.done)||((a.order||0)-(b.order||0)));
}
function checkId(tid){ return "k:"+curWeekKey()+":"+selDay+":"+tid; }
function isChecked(tid){ return !!items[checkId(tid)]; }
function isSeeded(t){ return !!t && (t.seed || /^(s:|info:|care:|clean:|tpl:)/.test(t.id)); }

/* notes */
function notesAll(){ return Object.values(items).filter(t=>t.kind==="note"&&!t._gone).sort((a,b)=>b.ts-a.ts); }
function unreadCount(){ return notesAll().filter(n=>n.by!==me && !n.seenBy).length; }

/* projects */
function projectsAll(){ return Object.values(items).filter(t=>t.kind==="project"&&!t._gone&&!t.archived).sort((a,b)=>(a.order||0)-(b.order||0)); }
function stepsFor(pid){ return Object.values(items).filter(t=>t.kind==="pstep"&&t.projectId===pid&&!t._gone).sort(byOrder); }
function projectOf(step){ return items[step.projectId]; }
function stepEffectiveISO(s){
  if(!s.schedISO) return null;
  if(!s.done && s.schedISO < todayISO()) return todayISO();   // gentle drift, never overdue
  return s.schedISO;
}
function scheduledStepsFor(iso){
  return Object.values(items).filter(t=>t.kind==="pstep"&&!t._gone&&t.schedISO&&stepEffectiveISO(t)===iso)
    .sort(byOrder);
}

/* ============================== mutators ========================== */
function toggleTpl(id){
  const k=checkId(id);
  if(items[k]) drop(k);
  else { const t=items[id]; put({id:k, kind:"check", done:true, who:t?t.who:null, by:me||null}); }
}
function toggleTodo(id){
  const t=items[id]; if(!t) return;
  if(t.repeat){                                    // recurring: check per-week
    const k=todoDoneKey(t);
    if(items[k]) drop(k); else put({id:k, kind:"tdone", done:true, by:me||null});
  } else { t.done=!t.done; t.doneBy=t.done?(me||null):null; put(t); }
}
function toggleStep(id){ const t=items[id]; if(!t) return; t.done=!t.done; t.doneBy=t.done?(me||null):null; put(t); }
function addTodo(text){
  text=(text||"").trim(); if(!text) return;
  const id="c:"+Date.now()+Math.random().toString(36).slice(2,6);
  // day quick-adds land on Everyone unless a name is typed;
  // who is changed in the edit screen (tap the row)
  put({ id, kind:"todo", text, who: whoFromName(text.toLowerCase()) || "both", area:classify(text).area,
        weekKey:curWeekKey(), day:selDay, done:false, order:Date.now() });
  render();
}

/* one dumped task in (from typing, Siri, or an import) — auto-sorted */
function importOne(o){
  const raw=(o.text||"").trim(); if(!raw) return null;
  const parsed=extractDay(raw);
  const guess=classify(parsed.text);
  const doc={ id:"c:"+Date.now()+Math.random().toString(36).slice(2,6), kind:"todo",
    text:parsed.text, who:WHO[o.who]?o.who:guess.who, area:AREAS[o.area]?o.area:guess.area,
    done:false, weekKey:null, day:null, order:Date.now() };
  const iso=o.date||parsed.iso;
  if(iso && !isNaN(new Date(iso+"T00:00:00").getTime())){
    const d=new Date(iso+"T00:00:00");
    doc.weekKey=weekKeyOf(d); doc.day=(d.getDay()+6)%7;
  }
  put(doc); return doc;
}
function importMany(arr){
  let n=0;
  (Array.isArray(arr)?arr:[]).forEach(o=>{
    if(typeof o==="string") o={text:o};
    if(o && typeof o==="object" && importOne(o)) n++;
  });
  return n;
}
function addTpl(sec, scope, check){
  const id="u:"+Date.now()+Math.random().toString(36).slice(2,5);
  const list = sec==="care" ? careItems(scope) : tplList(sec, scope);
  const order = list.length ? Math.max.apply(null, list.map(x=>x.order||0))+1 : 0;
  const doc={ id, kind:"tpl", sec, scope, check:!!check, text:"", order };
  if(check) doc.who="both";
  if(sec==="care") doc.icon="i-paw";
  put(doc);
  openEditor(id, true);
}
function addCare(w){ addTpl("care", w, false); }

/* notes */
function addNote(text){
  text=(text||"").trim(); if(!text) return;
  const id="note:"+Date.now()+Math.random().toString(36).slice(2,6);
  put({ id, kind:"note", text, by:(me||"both"), ts:Date.now(), seenBy:null });
  render();
}
function ackNote(id){ const n=items[id]; if(!n) return; n.seenBy={who:me||"both", ts:Date.now()}; put(n); render(); }
function delNote(id){
  const n=items[id]; if(!n) return;
  lastDeleted={ id, seeded:false, doc:JSON.parse(JSON.stringify(n)) };
  drop(id); showToast("Note removed"); render();
}

/* projects */
function addProject(){
  const id="proj:"+Date.now()+Math.random().toString(36).slice(2,5);
  const order = projectsAll().length;
  put({ id, kind:"project", title:"", who:"both", order, ts:Date.now() });
  openEditor(id, true);
}
function addStep(pid){
  const id="pstep:"+Date.now()+Math.random().toString(36).slice(2,5);
  const order = stepsFor(pid).length;
  const p=items[pid]; const who = p ? (p.who||"both") : "both";
  put({ id, kind:"pstep", projectId:pid, text:"", done:false, schedISO:null, who, order });
  openEditor(id, true);
}
/* ---- auto-scheduling: fill each day with as much as is reasonable ---------
   A day holds ~DAY_CAPACITY tasks per person, counting everything already on
   it across all inputs (appointments, that day's cleaning, to-dos, other
   scheduled steps). Anyone's work nights lower THEIR capacity; their recovery
   days (the day AFTER a night shift, when they're wiped) hold nothing. A
   single project also caps at PROJ_PER_DAY steps a day so multi-step jobs
   still breathe. People with no shifts fill any day with room. */
const DAY_CAPACITY = 4;
const PROJ_PER_DAY = 2;
function dayBlockedFor(who, iso){
  if(who==="both") return false;
  return shiftsFor(prevISO(iso), who).some(isNightShift);
}
function whoList(who){ return who==="both" ? members().map(m=>m.id) : [who]; }
function personCapacity(who, iso){
  if(who!=="both"){
    if(dayBlockedFor(who, iso)) return 0;                        // recovery day: nothing
    if(shiftsFor(iso, who).length) return Math.max(1, DAY_CAPACITY-2);  // works that night: lighter
  }
  return DAY_CAPACITY;
}
function personLoad(who, iso){
  const wk=weekKeyOf(new Date(iso+"T00:00:00")), day=weekdayOf(iso);
  const m = w => { const x=w||"both"; return x===who || x==="both"; };
  let n=0;
  Object.values(items).forEach(t=>{
    if(t._gone||t.done) return;
    if(t.kind==="todo"){ if((t.repeat ? t.day===day : (t.weekKey===wk && t.day===day)) && m(t.who)) n++; }
    else if(t.kind==="pstep"){ if(t.schedISO && stepEffectiveISO(t)===iso && m(t.who||(projectOf(t)||{}).who)) n++; }
    else if(t.kind==="appt"){ if(apptOccursOn(t, iso) && m(t.who)) n++; }
  });
  tplList("clean", day).forEach(c=>{ if(m(c.who)) n++; });
  return n;
}
function fitsDay(who, iso){
  return whoList(who).every(p=> personLoad(p, iso) < personCapacity(p, iso));
}
function projectStepsOnDay(pid, iso){
  return Object.values(items).filter(t=>t.kind==="pstep"&&!t._gone&&!t.done&&t.projectId===pid&&t.schedISO&&stepEffectiveISO(t)===iso).length;
}
// place each item onto the earliest upcoming day that still has room
function scheduleItems(list, start){
  let n=0;
  list.forEach(item=>{
    const who=item.who || (item.kind==="pstep" ? ((projectOf(item)||{}).who||"both") : "both");
    const cursor=new Date(start); let guard=0;
    while(guard++<400){
      const iso=isoOf(cursor);
      const projOK = item.kind!=="pstep" || projectStepsOnDay(item.projectId, iso) < PROJ_PER_DAY;
      if(projOK && fitsDay(who, iso)){
        if(item.kind==="pstep") item.schedISO=iso;
        else { item.weekKey=weekKeyOf(new Date(iso+"T00:00:00")); item.day=weekdayOf(iso); }
        item.autoPlanned=true;                 // lets "Un-plan" find it again
        put(item); n++; break;
      }
      cursor.setDate(cursor.getDate()+1);
    }
  });
  return n;
}
function startPlanDate(){ return new Date(); }   // from today; capacity keeps today from overloading
function autoScheduleProject(pid){
  const steps=stepsFor(pid).filter(s=>!s.done && !s.schedISO).sort(byOrder);
  return scheduleItems(steps, startPlanDate());
}
// global "plan my week" — everything unscheduled, across all inputs
function planWeek(){
  const steps = Object.values(items).filter(t=>t.kind==="pstep"&&!t._gone&&!t.done&&!t.schedISO).sort(byOrder);
  const todos = masterTodos().filter(t=>!t.done);   // List to-dos with no day yet
  return scheduleItems(steps, startPlanDate()) + scheduleItems(todos, startPlanDate());
}
// count / undo auto-scheduled items (not ones you dated by hand)
function autoPlannedItems(){
  return Object.values(items).filter(t=>!t._gone && !t.done && t.autoPlanned &&
    ((t.kind==="pstep"&&t.schedISO) || (t.kind==="todo"&&t.weekKey)));
}
function unplanWeek(){
  let n=0;
  autoPlannedItems().forEach(t=>{
    if(t.kind==="pstep") t.schedISO=null; else { t.weekKey=null; t.day=null; }
    delete t.autoPlanned; put(t); n++;
  });
  return n;
}

/* ============================ appointments ======================== */
function weekdayOf(iso){ return (new Date(iso+"T00:00:00").getDay()+6)%7; }
function fmtTime(hhmm){
  if(!hhmm) return "all day";
  let [h,m]=hhmm.split(":").map(Number); const ap=h<12?"AM":"PM"; h=h%12; if(h===0) h=12;
  return h+":"+String(m).padStart(2,"0")+" "+ap;
}
function apptOccursOn(a, iso){ return a.repeat ? weekdayOf(iso)===weekdayOf(a.date) : a.date===iso; }
function apptsForDate(iso){
  return Object.values(items).filter(t=>t.kind==="appt"&&!t._gone&&apptOccursOn(t,iso))
    .sort((x,y)=>(x.time||"99:99").localeCompare(y.time||"99:99"));
}
function apptDone(a, iso){ return a.repeat ? !!items["adone:"+a.id+":"+weekKeyOf(new Date(iso+"T00:00:00"))] : !!a.done; }

/* Work shifts — dated (or weekly-repeating), each with a start time and an
   owner (who). Kept separate from the weekly template so summer changes are
   just adding/removing shifts, never editing the recurring plan. */
// Shifts saved before people-lists carried no owner: they were always the
// original household's second slot. That fallback keeps them hers forever.
function shiftWho(s){ return (s && s.who) || "lindsay"; }
function shiftsFor(iso, who){ return shiftsForDate(iso).filter(s=>shiftWho(s)===who); }
function shiftSkipKey(s, iso){ return "shiftskip:"+s.id+":"+weekKeyOf(new Date(iso+"T00:00:00")); }
function shiftSkipped(s, iso){ return !!s.repeat && !!items[shiftSkipKey(s, iso)]; }
function toggleShiftSkip(id){
  const s=items[id]; if(!s) return;
  const k=shiftSkipKey(s, selDayISO());
  if(items[k]) drop(k); else put({id:k, kind:"shiftskip", done:true});
}
// active shifts (excludes ones skipped this week) — drives energy + print
function shiftsForDate(iso){
  return Object.values(items).filter(t=>t.kind==="shift"&&!t._gone&&apptOccursOn(t,iso)&&!shiftSkipped(t,iso))
    .sort((a,b)=>(a.start||"99:99").localeCompare(b.start||"99:99"));
}
// everything occurring on the day incl. skipped — the card shows skipped ones
// muted so they can be tapped to bring back
function allShiftsOccurring(iso){
  return Object.values(items).filter(t=>t.kind==="shift"&&!t._gone&&apptOccursOn(t,iso))
    .sort((a,b)=>(a.start||"99:99").localeCompare(b.start||"99:99"));
}
// Add-shift default start time: copy the owner's most recent shift on that
// weekday (their usual), else the original household's habits (Mon & Tue
// 5:30 pm, Fri 4 pm), else 5:30 pm. Always editable.
const SHIFT_START_BY_DAY = { 0:"17:30", 1:"17:30", 4:"16:00" };
function defaultShiftStart(dayIdx, who){
  const mine=Object.values(items).filter(t=>t.kind==="shift"&&!t._gone&&t.start&&t.date&&shiftWho(t)===who);
  const sameDay=mine.filter(s=>weekdayOf(s.date)===dayIdx);
  const pick=(sameDay.length?sameDay:mine).sort((a,b)=>String(b.date).localeCompare(String(a.date)))[0];
  if(pick) return pick.start;
  return SHIFT_START_BY_DAY[dayIdx] || "17:30";
}
function addShift(mid){
  // added from a person's day-card → theirs; otherwise the original
  // household keeps its old habit (second slot), new ones default to you
  const who = mid || (tunedHousehold() ? "lindsay" : (me || members()[0].id));
  const id="shift:"+Date.now()+Math.random().toString(36).slice(2,5);
  put({ id, kind:"shift", who, label:"", date:selDayISO(), start:defaultShiftStart(selDay, who), end:"", repeat:false });
  openEditor(id, true);
}

/* Energy auto-derives from the shifts: an evening/overnight shift means a
   lighter day, working after a night shift is lightest, a plain day shift is
   moderate. Days with no shift fall back to the editable template line. */
function toMin(hhmm){ const p=String(hhmm||"").split(":"); return (+p[0]||0)*60+(+p[1]||0); }
function isNightShift(s){
  if(!s || !s.start) return false;
  const st=toMin(s.start);
  if(st>=14*60) return true;                                  // starts 2 pm or later
  if(s.end){ const en=toMin(s.end); if(en<=st || en>=22*60) return true; } // crosses midnight / ends late
  return false;
}
function prevISO(iso){ const d=new Date(iso+"T00:00:00"); d.setDate(d.getDate()-1); return isoOf(d); }
/* one person's energy for the day, from their own shifts */
function deriveEnergyFor(who, iso){
  const today=shiftsFor(iso, who);
  const workedLastNight=shiftsFor(prevISO(iso), who).some(isNightShift);
  if(!today.length && !workedLastNight) return "";
  const bits=[];
  if(workedLastNight) bits.push("Off a night shift");
  today.forEach(s=>{
    const t=s.start ? " ("+fmtTime(s.start)+(s.end?"–"+fmtTime(s.end):"")+")" : "";
    bits.push((isNightShift(s)?"works tonight":"day shift")+t);
  });
  let sentence=bits.join(" + "); sentence=sentence.charAt(0).toUpperCase()+sentence.slice(1);
  let level="moderate";
  if(workedLastNight && today.length) level="lightest";
  else if(workedLastNight || today.some(isNightShift)) level="light";
  return sentence+" — "+level;
}
/* the household's energy line (print + tests): all shifts together */
function deriveEnergy(iso){
  const today=shiftsForDate(iso);
  const workedLastNight=shiftsForDate(prevISO(iso)).some(isNightShift);
  if(!today.length && !workedLastNight) return "";            // no shift info → use template
  const bits=[];
  if(workedLastNight) bits.push("Off a night shift");
  today.forEach(s=>{
    const t=s.start ? " ("+fmtTime(s.start)+(s.end?"–"+fmtTime(s.end):"")+")" : "";
    bits.push((isNightShift(s)?"works tonight":"day shift")+t);
  });
  let sentence=bits.join(" + "); sentence=sentence.charAt(0).toUpperCase()+sentence.slice(1);
  let level="moderate";
  if(workedLastNight && today.length) level="lightest";
  else if(workedLastNight || today.some(isNightShift)) level="light";
  return sentence+" — "+level;
}
function energyInfo(w, iso){
  const d=deriveEnergy(iso);
  if(d) return { text:d, derived:true };
  const info=items["info:"+w+":energy"];
  return { text: info?info.text:"", derived:false };
}
/* energy for one person's day-card. The editable weekday template line
   belongs to the original second slot (it always described her days);
   everyone else only gets a line when their shifts derive one. */
function energyInfoFor(who, w, iso){
  const d=deriveEnergyFor(who, iso);
  if(d) return { text:d, derived:true };
  if(who==="lindsay"){
    const info=items["info:"+w+":energy"];
    if(info && (info.text||"")!=="") return { text:info.text, derived:false };
  }
  return null;
}
function toggleAppt(id, iso){
  const a=items[id]; if(!a) return;
  if(a.repeat){
    const k="adone:"+id+":"+weekKeyOf(new Date(iso+"T00:00:00"));
    if(items[k]) drop(k); else put({id:k, kind:"adone", done:true, by:me||null});
  } else { a.done=!a.done; a.doneBy=a.done?(me||null):null; put(a); }
}
function addAppt(){
  const id="appt:"+Date.now()+Math.random().toString(36).slice(2,5);
  put({ id, kind:"appt", title:"", who:"both", date:selDayISO(), time:"", repeat:false, remind:"morning", done:false });
  openEditor(id, true);
}
function comingUp(){
  const T=todayISO(); const t1=new Date(); t1.setDate(t1.getDate()+1); const T1=isoOf(t1);
  const list=[];
  apptsForDate(T).forEach(a=>{ if(a.remind!=="none" && !apptDone(a,T)) list.push({a, iso:T, when:"Today"}); });
  apptsForDate(T1).forEach(a=>{ if(a.remind==="dayBefore" && !apptDone(a,T1)) list.push({a, iso:T1, when:"Tomorrow"}); });
  list.sort((x,y)=>(x.iso+(x.a.time||"99")).localeCompare(y.iso+(y.a.time||"99")));
  return list;
}

/* ============================== editor ============================ */
function labelForInfo(t){
  const f=t.field;
  if(f==="headline") return "Edit "+(WHO.lindsay||"their")+"'s day";
  if(f==="note")     return "Edit "+(WHO[t.mid]||"their")+"'s day";
  if(f==="energy")   return "Edit energy";
  if(f==="furniture") return "Edit "+noteRowLabel().toLowerCase();
  return "Edit";
}
/* the For: row — one button per person, plus Everyone (never for shifts:
   a shift is one person's). Tap picks; saving applies. */
function updateEdWho(){
  const row=document.getElementById("edWhoBtns"); if(!row) return;
  const t=items[editingId]||{};
  const opts = members().map(m=>[m.id, m.name]);
  if(t.kind!=="shift") opts.push(["both", WHO.both]);
  row.innerHTML = opts.map(o=>'<button class="who '+o[0]+(edWho===o[0]?' on':'')+'" data-who="'+o[0]+'">'+esc(o[1])+'</button>').join("");
}
function updateEdIcon(){ document.getElementById("edIconBtn").innerHTML='<svg><use href="#'+edIcon+'"/></svg>'; }
function show(id, on){ document.getElementById(id).style.display = on?"":"none"; }
function openEditor(id, fresh){
  if(!HAS_DOM){ editingId=id; editingFresh=!!fresh; return; }   // no editor without a DOM (node tests)
  const t=items[id]; if(!t) return;
  editingId=id; editingFresh=!!fresh; splitMode=false;
  const isInfo = t.kind==="info";
  const isCare = t.kind==="tpl" && t.sec==="care";
  const isProj = t.kind==="project";
  const isStep = t.kind==="pstep";
  const isAppt = t.kind==="appt";
  const isShift = t.kind==="shift";
  const hasWho = t.kind==="todo" || (t.kind==="tpl" && t.check) || isProj || isAppt || isStep || isShift;
  edWho = isShift ? shiftWho(t) : normWho(t.who||"both");
  edWhoStart=edWho; edIcon=t.icon||"i-paw";
  let title="Edit item";
  if(isInfo) title=labelForInfo(t);
  else if(isCare) title="Edit note";
  else if(isProj) title="Edit project";
  else if(isStep) title="Edit step";
  else if(isAppt) title="Edit appointment";
  else if(isShift) title="Edit shift";
  document.getElementById("edTitle").textContent=title;
  document.getElementById("edText").value = (isProj||isAppt) ? (t.title||"") : (isShift ? (t.label||"") : t.text);
  document.getElementById("edText").placeholder = isProj ? "Project name…" : (isAppt ? "Appointment…" : (isShift ? "Shift name (optional) — Day, Night…" : "Text…"));
  document.getElementById("edText2").value="";
  show("edSecondWrap", false);
  show("edSplitToggle", !isInfo && !isProj && !isAppt && !isShift);
  document.getElementById("edSplitToggle").innerHTML='<svg width="15" height="15"><use href="#i-split"/></svg> Split into two';
  const isTodo = t.kind==="todo";
  show("edWhoRow", hasWho);
  show("edIconRow", isCare);
  show("edDateRow", isStep || isAppt || isTodo || isShift);
  show("edTimeRow", isAppt || isShift);
  show("edEndRow", isShift);
  show("edRepeatRow", isAppt || isShift || isTodo);
  show("edRemindRow", isAppt);
  show("edSkipWeek", false);   // shown below only for a repeating shift
  show("edDelete", !isInfo);
  document.getElementById("edDelete").textContent = "Delete";
  document.getElementById("edTimeLabel").textContent = isShift ? "Starts" : "Time";
  document.getElementById("edDateLabel").textContent = (isAppt||isShift) ? "Date" : (isTodo ? "Do on" : "Remind me on");
  show("edDateHint", isStep || isTodo);
  if(isStep){
    document.getElementById("edDateHint").textContent="A gentle nudge on that day — never a hard deadline. If it slips, it just drifts to today.";
    document.getElementById("edDate").value = t.schedISO || "";
  }
  if(isTodo){
    document.getElementById("edRepeat").checked = !!t.repeat;
    document.getElementById("edDateHint").textContent = t.repeat
      ? "Repeats every week on this weekday. Untick to make it a one-off."
      : "Blank = stays on the master List. Day to-dos left unfinished roll forward each week.";
    document.getElementById("edDate").value = (!t.repeat && t.weekKey && t.day!=null) ? isoOfWeekDay(t.weekKey, t.day) : "";
  }
  if(isAppt){
    document.getElementById("edDate").value = t.date || "";
    document.getElementById("edTime").value = t.time || "";
    document.getElementById("edRepeat").checked = !!t.repeat;
    document.getElementById("edRemind").value = t.remind || "morning";
  }
  if(isShift){
    document.getElementById("edDate").value = t.date || "";
    document.getElementById("edTime").value = t.start || "";
    document.getElementById("edEnd").value = t.end || "";
    document.getElementById("edRepeat").checked = !!t.repeat;
    if(t.repeat){
      show("edSkipWeek", true);
      document.getElementById("edSkipWeek").textContent =
        shiftSkipped(t, selDayISO()) ? "Bring back this week" : "Skip this week";
      document.getElementById("edDelete").textContent = "Delete every week";
    }
  }
  if(hasWho) updateEdWho();
  if(isCare) updateEdIcon();
  document.getElementById("editor").classList.add("show");
  setTimeout(()=>document.getElementById("edText").focus(),60);
}
function closeEditor(){
  document.getElementById("editor").classList.remove("show");
  if(editingFresh && editingId){ deleteSilently(editingId); render(); }
  editingId=null; editingFresh=false;
}
function closeEditorRaw(){ document.getElementById("editor").classList.remove("show"); }
function toggleSplit(){
  splitMode=!splitMode;
  const wrap=document.getElementById("edSecondWrap");
  const tgl=document.getElementById("edSplitToggle");
  if(splitMode){
    wrap.style.display="";
    tgl.textContent="Undo split";
    const txt=document.getElementById("edText").value;
    const seps=[" + "," / ","; ",", "," and "," — "];
    let didSplit=false;
    for(const s of seps){ const i=txt.indexOf(s);
      if(i>0 && i < txt.length-s.length){
        document.getElementById("edText").value=txt.slice(0,i).trim();
        document.getElementById("edText2").value=txt.slice(i+s.length).trim();
        didSplit=true; break; } }
    if(!didSplit) document.getElementById("edText2").value="";
    setTimeout(()=>document.getElementById("edText2").focus(),60);
  } else {
    wrap.style.display="none";
    tgl.innerHTML='<svg width="15" height="15"><use href="#i-split"/></svg> Split into two';
  }
}
function createSibling(t, text2){
  const pre = t.kind==="todo"?"c:":(t.kind==="pstep"?"pstep:":"u:");
  const id=pre+Date.now()+Math.random().toString(36).slice(2,5);
  const doc=Object.assign({}, t, {id, text:text2, order:(t.order||Date.now())+0.5, done:false});
  delete doc._gone; delete doc.seed; if(doc.kind==="pstep") doc.schedISO=null;
  put(doc);
}
function saveEditor(){
  const t=items[editingId]; if(!t){ editingFresh=false; closeEditorRaw(); return; }
  const text1=document.getElementById("edText").value.trim();
  if(t.kind==="shift"){
    // A shift's real content is its start time; the label is optional.
    t.label = text1;
    t.who   = edWho;
    t.date  = document.getElementById("edDate").value || t.date;
    t.start = document.getElementById("edTime").value || "";
    t.end   = document.getElementById("edEnd").value || "";
    t.repeat= document.getElementById("edRepeat").checked;
    if(!t.start && !t.label && editingFresh){
      editingFresh=false; deleteSilently(editingId); editingId=null; closeEditorRaw(); render(); return;
    }
    put(t); editingFresh=false; editingId=null; closeEditorRaw(); render(); return;
  }
  if(!text1){
    if(editingFresh){ editingFresh=false; deleteSilently(editingId); editingId=null; closeEditorRaw(); render(); return; }
    document.getElementById("edText").focus(); return;
  }
  if(t.kind==="project"||t.kind==="appt") t.title=text1; else t.text=text1;
  const whoTouched = (edWho !== edWhoStart);
  if(t.kind==="project"){
    if(whoTouched) t.whoManual=true;
    t.who = t.whoManual ? edWho : classify(text1).who;   // auto-tag who unless set by hand
  } else if(t.kind==="pstep"){
    if(whoTouched) t.whoManual=true;
    t.who = t.whoManual ? edWho : classifyWho(text1, (projectOf(t)||{}).who||"both");
    const v=document.getElementById("edDate").value; t.schedISO = v || null;
    delete t.autoPlanned;                          // a manual save is no longer auto-scheduled
  } else if(t.kind==="todo" || (t.kind==="tpl" && t.check) || t.kind==="appt"){
    t.who=edWho;
  }
  if(t.kind==="tpl" && t.sec==="care") t.icon=edIcon;
  if(t.kind==="todo"){
    const v=document.getElementById("edDate").value;
    t.repeat = document.getElementById("edRepeat").checked;
    if(t.repeat){
      if(v) t.day=(new Date(v+"T00:00:00").getDay()+6)%7;
      else if(t.day==null) t.day=selDay;   // pin the recurring weekday
      t.weekKey=null;                        // recurring ignores the week
    } else if(v){ const d=new Date(v+"T00:00:00"); t.weekKey=weekKeyOf(d); t.day=(d.getDay()+6)%7; }
    else { t.weekKey=null; t.day=null; }     // back to the master List
    if(!t.area) t.area=classify(t.text).area;
    delete t.autoPlanned;                     // a manual save is no longer auto-scheduled
  }
  if(t.kind==="appt"){
    t.date = document.getElementById("edDate").value || t.date;
    t.time = document.getElementById("edTime").value || "";
    t.repeat = document.getElementById("edRepeat").checked;
    t.remind = document.getElementById("edRemind").value;
  }
  if(splitMode && t.kind!=="info" && t.kind!=="project" && t.kind!=="appt"){
    const text2=document.getElementById("edText2").value.trim();
    if(text2) createSibling(t, text2);
  }
  put(t);
  editingFresh=false; editingId=null; closeEditorRaw(); render();
}
function deleteSilently(id){
  const t=items[id]; if(!t) return;
  if(isSeeded(t)){ t._gone=true; t.done=true; put(t); } else drop(id);
}
function deleteFromEditor(){
  const id=editingId; editingFresh=false; editingId=null; closeEditorRaw();
  if(!id) return;
  const t=items[id]; if(!t) return;
  if(t.kind==="project"){ stepsFor(id).forEach(s=>drop(s.id)); }   // remove its steps too
  lastDeleted={ id, seeded:isSeeded(t), doc:JSON.parse(JSON.stringify(t)) };
  if(lastDeleted.seeded){ t._gone=true; t.done=true; put(t); } else drop(id);
  showToast("Removed"); render();
}

/* ============================== render =========================== */
function esc(s){ return String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c])); }
function careHTML(text){
  const i=text.indexOf(" — ");
  if(i>0) return '<b>'+esc(text.slice(0,i))+'</b> '+esc(text.slice(i+3));
  return esc(text);
}
function tplRow(it){
  const checked=isChecked(it.id);
  const who=normWho(it.who||"both");
  return `<li><div class="item ${who} ${checked?'done':''}" data-id="${it.id}">
    <div class="box" data-act="tplcheck"><svg><use href="#i-check"/></svg></div>
    <div class="lab"><span class="txt" data-act="edititem">${esc(it.text)}</span></div>
    <button class="who ${who}" data-act="editbtn">${whoLabel(who)}</button>
    <button class="editb" data-act="editbtn" aria-label="Edit"><svg width="17" height="17"><use href="#i-edit"/></svg></button>
  </div></li>`;
}
function todoRow(t){
  const done=todoDone(t);
  const who=normWho(t.who);
  const rep = t.repeat ? ` <span class="apptrep">weekly</span>` : "";
  const sub = done && t.doneBy && !t.repeat ? `<span class="sub">done by ${whoLabel(t.doneBy)}</span>` : "";
  return `<li><div class="item ${who} ${done?'done':''}" data-id="${t.id}">
    <div class="box" data-act="todocheck"><svg><use href="#i-check"/></svg></div>
    <div class="lab"><span class="txt" data-act="edititem">${esc(t.text)}${rep}</span>${sub}</div>
    <button class="who ${who}" data-act="editbtn">${whoLabel(who)}</button>
    <button class="editb" data-act="editbtn" aria-label="Edit"><svg width="17" height="17"><use href="#i-edit"/></svg></button>
  </div></li>`;
}
function schedStepRow(s){
  const p=projectOf(s);
  const who=normWho(s.who||(p?p.who:"both")||"both");
  return `<li><div class="item ${who} reminder ${s.done?'done':''}" data-id="${s.id}">
    <div class="box" data-act="stepcheck"><svg><use href="#i-check"/></svg></div>
    <div class="lab"><span class="txt" data-act="editstep">${esc(s.text)}</span>
      <span class="sub"><svg class="tiny"><use href="#i-folder"/></svg> ${esc(p?p.title:"Project")}</span></div>
    <button class="who ${who}" data-act="editstep">${whoLabel(who)}</button>
    <button class="editb" data-act="editstep" aria-label="Edit"><svg width="17" height="17"><use href="#i-edit"/></svg></button>
  </div></li>`;
}
function careChip(it){
  return `<span class="carechip tap" data-id="${it.id}" data-act="edititem"><svg><use href="#${it.icon||'i-paw'}"/></svg>${careHTML(it.text)}</span>`;
}
function shiftChip(s, skipped){
  const time = s.start ? fmtTime(s.start) : "time TBD";
  const span = s.end ? "–"+fmtTime(s.end) : "";
  const label = s.label ? ' <span class="shiftlabel">'+esc(s.label)+'</span>' : "";
  const tag = skipped ? ' <span class="apptrep">skipped</span>'
                      : (s.repeat ? ' <span class="apptrep">weekly</span>' : "");
  return `<span class="carechip shiftchip tap ${skipped?'skipped':''}" data-id="${s.id}" data-act="editshift"><svg><use href="#i-clock"/></svg><b>${esc(time)}${esc(span)}</b>${label}${tag}</span>`;
}
/* The people card: one day-card per person — their day-note, shifts and
   energy — side-scrollable, opening on your own. Household-level bits
   (the free note row + care chips) sit below, outside the swipe. The
   original second slot's card keeps the old headline + energy docs, so
   nothing existing moves. */
function personSlideHTML(m, allShifts){
  const iso=selDayISO();
  const mShifts=allShifts.filter(s=>shiftWho(s)===m.id);
  const noteId = m.id==="lindsay" ? "info:"+selDay+":headline" : "info:"+selDay+":note:"+m.id;
  const noteTxt = items[noteId] ? (items[noteId].text||"") : "";
  const en = energyInfoFor(m.id, selDay, iso);
  const col = MEMBER_COLORS[m.color][0];
  const energyRow = !en ? "" : (en.derived
    ? `<div class="meta"><div class="lbl">Energy <span class="auto">· from shifts</span></div><div class="val">${esc(en.text)}</div></div>`
    : `<div class="meta tap" data-id="info:${selDay}:energy" data-act="edititem"><div class="lbl">Energy</div><div class="val">${esc(en.text)}</div></div>`);
  return `<div class="slide" data-mid="${m.id}">
      <div class="ctitle" style="color:${col}"><svg><use href="#i-heart"/></svg>${esc(m.name)}</div>
      <p class="headline tap ${noteTxt?"":"dim"}" data-act="editnote" data-noteid="${noteId}">${noteTxt?esc(noteTxt):"Add a note about "+esc(m.name)+"'s day"}</p>
      <div class="shiftrow">
        <div class="lbl">Shifts</div>
        <div class="carechips">
          ${mShifts.map(s=>shiftChip(s, shiftSkipped(s, iso))).join("")}
          <button class="carechip add" data-act="addshift" data-mid="${m.id}"><svg><use href="#i-plus"/></svg>Add shift</button>
        </div>
      </div>
      ${energyRow?`<div class="metarow">${energyRow}</div>`:""}
    </div>`;
}
function peopleCardHTML(allShifts, care){
  const mems=members();
  const meIdx=Math.max(0, mems.findIndex(m=>m.id===me));
  return `<div class="card people">
      <div class="rolodex" id="rolodex">${mems.map(m=>personSlideHTML(m, allShifts)).join("")}</div>
      ${mems.length>1?`<div class="dots" id="rolodots">${mems.map((m,i)=>`<span class="${i===meIdx?"on":""}"></span>`).join("")}</div>`:""}
      <div class="metarow">
        <div class="meta tap" data-act="editnote" data-noteid="info:${selDay}:furniture"><div class="lbl">${noteRowLabel()}</div><div class="val">${esc(infoText(selDay,"furniture"))}</div></div>
      </div>
      <div class="carechips">
        ${care.map(careChip).join("")}
        <button class="carechip add" data-act="addcare" data-scope="${selDay}"><svg><use href="#i-plus"/></svg>Add</button>
      </div>
    </div>`;
}
function addMini(sec, scope, check){
  return `<button class="addmini" data-act="addtpl" data-sec="${sec}" data-scope="${scope}" data-check="${check?1:0}"><svg><use href="#i-plus"/></svg>Add</button>`;
}
function apptRow(a, iso){
  const done=apptDone(a, iso);
  const who=normWho(a.who);
  const rep = a.repeat ? ` <span class="apptrep">weekly</span>` : "";
  return `<li><div class="item ${who} ${done?'done':''}" data-id="${a.id}">
    <div class="box" data-act="apptcheck"><svg><use href="#i-check"/></svg></div>
    <div class="lab"><span class="txt" data-act="editappt">${esc(a.title||"Appointment")}</span>
      <span class="sub"><span class="appttime">${fmtTime(a.time)}</span>${rep}</span></div>
    <button class="who ${who}" data-act="editappt">${whoLabel(who)}</button>
    <button class="editb" data-act="editappt" aria-label="Edit"><svg width="17" height="17"><use href="#i-edit"/></svg></button>
  </div></li>`;
}
function comingUpHTML(){
  const list=comingUp();
  if(!list.length) return "";
  return `<div class="comingup"><div class="cuhd"><svg><use href="#i-clock"/></svg>Coming up</div>`+
    list.map(o=>`<div class="curow"><b>${o.when}${o.a.time?" · "+fmtTime(o.a.time):""}</b> ${esc(o.a.title||"Appointment")} <span class="cuwho ${normWho(o.a.who)}">${whoLabel(o.a.who)}</span></div>`).join("")+
    `</div>`;
}

function dayProgress(){
  const ids = tplList("clean",selDay).map(x=>x.id)
    .concat(tplList("morning","daily").map(x=>x.id), tplList("night","daily").map(x=>x.id), tplList("each","daily").map(x=>x.id));
  let done=0; ids.forEach(id=>{ if(isChecked(id)) done++; });
  const todos=todosForSel(); const sched=scheduledStepsFor(selDayISO());
  const tdone=todos.filter(todoDone).length + sched.filter(s=>s.done).length;
  return { done: done+tdone, total: ids.length+todos.length+sched.length };
}
function refreshProgress(){ const pr=dayProgress(); const el=document.querySelector(".dayhead .prog"); if(el) el.textContent=pr.done+"/"+pr.total+" done"; }

function render(){
  applyNames();
  if(!HAS_DOM) return;
  updateTabs();
  show("viewWeek", view==="week");
  show("viewList", view==="list");
  show("viewProjects", view==="projects");
  show("viewNotes", view==="notes");
  if(view==="week") renderWeek();
  else if(view==="list") renderList();
  else if(view==="projects") renderProjects();
  else renderNotes();
}
function updateTabs(){
  document.querySelectorAll("#tabs button").forEach(b=> b.classList.toggle("on", b.dataset.view===view));
  const badge=document.getElementById("notesBadge");
  const n=unreadCount();
  badge.textContent = n? String(n) : "";
  badge.style.display = n? "" : "none";
  const lb=document.getElementById("listBadge");
  const ln=masterTodos().filter(t=>!t.done).length;
  lb.textContent = ln? String(ln) : "";
  lb.style.display = ln? "" : "none";
}

function renderWeek(){
  document.getElementById("weekRange").textContent = fmtRange();
  document.getElementById("weekSub").innerHTML = isThisWeek() ? "This week" : '<a id="toToday">Jump to this week</a>';

  document.getElementById("days").innerHTML = DAY_SHORT.map((sh,i)=>{
    const d=dateForDay(i); const isToday=isoOf(d)===todayISO();
    return `<div class="daypill ${isToday?'today':''} ${i===selDay?'sel':''}" data-day="${i}">
      <div class="dow">${sh}</div><div class="dnum">${d.getDate()}</div><div class="dot"></div></div>`;
  }).join("");

  const d=dateForDay(selDay);
  const isToday=isoOf(d)===todayISO();
  const dateLabel=d.toLocaleDateString("en-US",{month:"long", day:"numeric"});
  const pr=dayProgress();
  const todos=todosForSel();
  const sched=scheduledStepsFor(selDayISO());
  const care=careItems(selDay);
  const clean=tplList("clean",selDay);
  const appts=apptsForDate(selDayISO());
  const shifts=allShiftsOccurring(selDayISO());
  const emptyHint=`<li class="emptyhint">Nothing here yet — tap + Add.</li>`;
  const todoInner = (todos.length||sched.length)
    ? todos.map(todoRow).join("") + sched.map(schedStepRow).join("")
    : emptyHint;

  document.getElementById("day").innerHTML = `
    ${comingUpHTML()}
    <div class="dayhead">
      <div class="dtitle">${DAY_FULL[selDay]}, ${dateLabel}${isToday?'<span class="todaytag">Today</span>':''}</div>
      <div class="prog">${pr.done}/${pr.total} done</div>
    </div>

    <div class="card">
      <div class="ctitle"><svg><use href="#i-clock"/></svg>Appointments <button class="addmini" data-act="addappt"><svg><use href="#i-plus"/></svg>Add</button></div>
      <ul class="items">${appts.length?appts.map(a=>apptRow(a,selDayISO())).join(""):'<li class="emptyhint">No appointments — tap + Add.</li>'}</ul>
    </div>

    ${peopleCardHTML(shifts, care)}

    <div class="card">
      <div class="ctitle"><svg><use href="#i-tool"/></svg>To-dos</div>
      <ul class="items">${todoInner}</ul>
      <div class="addrow">
        <input type="text" id="newText" placeholder="Add a to-do for ${DAY_SHORT[selDay]}…" autocomplete="off" />
        <button class="add" id="addBtn" aria-label="Add"><svg width="22" height="22"><use href="#i-plus"/></svg></button>
      </div>
    </div>

    <div class="card">
      <div class="ctitle clean"><svg><use href="#i-broom"/></svg>Cleaning today ${addMini("clean",selDay,true)}</div>
      <ul class="items">${clean.length?clean.map(tplRow).join(""):emptyHint}</ul>
    </div>

    <div class="card">
      <div class="ctitle"><svg><use href="#i-rotate"/></svg>Every day</div>
      <div class="grp morning"><svg><use href="#i-sun"/></svg>Every morning ${addMini("morning","daily",true)}</div>
      <ul class="items">${tplList("morning","daily").map(tplRow).join("")||emptyHint}</ul>
      <div class="grp night"><svg><use href="#i-moon"/></svg>Every night ${addMini("night","daily",true)}</div>
      <ul class="items">${tplList("night","daily").map(tplRow).join("")||emptyHint}</ul>
      <div class="grp each"><svg><use href="#i-book"/></svg>Each day ${addMini("each","daily",true)}</div>
      <ul class="items">${tplList("each","daily").map(tplRow).join("")||emptyHint}</ul>
    </div>
  `;

  const j=document.getElementById("toToday");
  if(j) j.onclick=()=>{ currentMonday=mondayOf(new Date()); selDay=todayMonIndex(); render(); };
  wireWeek();
}

/* master List — the digital "Household To-Do List": who, then area */
function renderList(){
  const all=masterTodos();
  const groups=[["both", members().length>2?"Everyone":"Both of Us", null]]
    .concat(members().map(m=>[m.id, m.name, MEMBER_COLORS[m.color][0]]));
  const secs=groups.map(function(g){
    const w=g[0], label=g[1], col=g[2];
    const mine=all.filter(t=>normWho(t.who||"both")===w);
    if(!mine.length) return "";
    const open=mine.filter(t=>!t.done).length;
    const byArea=AREA_ORDER.map(a=>{
      const rows=mine.filter(t=>(t.area||"other")===a);
      if(!rows.length) return "";
      return `<div class="grp">${esc(AREAS[a])}</div><ul class="items">${rows.map(todoRow).join("")}</ul>`;
    }).join("");
    return `<div class="card"><div class="ctitle"${col?` style="color:${col}"`:""}><svg><use href="#i-list"/></svg>${esc(label)} · ${open} to do</div>${byArea}</div>`;
  }).join("");
  const empty=`<div class="emptybig"><svg width="34" height="34"><use href="#i-list"/></svg><p>The master list is empty.<br>Type above, say it to Siri, or import a dump — it sorts itself.</p></div>`;
  document.getElementById("listBody").innerHTML = `
    <div class="card">
      <div class="addrow" style="margin-top:0;padding-top:0;border-top:0">
        <input type="text" id="listNewText" placeholder="Dump a task — it sorts itself…" autocomplete="off" />
        <button class="add" id="listAddBtn" aria-label="Add"><svg width="22" height="22"><use href="#i-plus"/></svg></button>
      </div>
      <div class="pmeta" style="margin-top:8px">Sorted by who, then area — tap a tag to fix a guess. Say "on Thursday" to send it straight to a day.</div>
      <button class="bigadd" data-act="planweek" style="margin-top:10px"><svg width="18" height="18"><use href="#i-clock"/></svg> Plan my week</button>
      ${autoPlannedItems().length ? `<button class="bigadd" data-act="unplanweek" style="margin-top:8px"><svg width="18" height="18"><use href="#i-rotate"/></svg> Un-plan (back to the List)</button>` : ""}
    </div>
    ${secs || empty}`;
  wireList();
}
function wireList(){
  const add=document.getElementById("listAddBtn"), input=document.getElementById("listNewText");
  if(!add||!input) return;
  const go=()=>{ const v=input.value.trim(); if(!v) return; importOne({text:v}); render();
    const i2=document.getElementById("listNewText"); if(i2) i2.focus(); };
  add.onclick=go;
  input.addEventListener("keydown",e=>{ if(e.key==="Enter") go(); });
}

function projectProgress(p){ const s=stepsFor(p.id); return s.length ? s.filter(x=>x.done).length/s.length : 0; }
function projectDone(p){ const s=stepsFor(p.id); return s.length>0 && s.every(x=>x.done); }
function projectNextDate(p){
  const ds=stepsFor(p.id).filter(s=>!s.done&&s.schedISO).map(stepEffectiveISO);
  return ds.length ? ds.sort()[0] : null;
}
function projectCompare(mode){
  switch(mode){
    // self-ordering default: active projects with the soonest scheduled step
    // first; unscheduled next; finished ones sink to the bottom.
    case "smart": return (a,b)=>{
      const ad=projectDone(a), bd=projectDone(b);
      if(ad!==bd) return ad?1:-1;
      const an=projectNextDate(a), bn=projectNextDate(b);
      if(an&&bn) return an.localeCompare(bn) || (a.order||0)-(b.order||0);
      if(an) return -1; if(bn) return 1;
      return (a.order||0)-(b.order||0);
    };
    case "progress": return (a,b)=> projectProgress(a)-projectProgress(b) || (a.order||0)-(b.order||0);
    case "who":      return (a,b)=> WHO_ORDER.indexOf(a.who)-WHO_ORDER.indexOf(b.who) || (a.order||0)-(b.order||0);
    case "name":     return (a,b)=> (a.title||"Untitled").localeCompare(b.title||"Untitled", undefined, {sensitivity:"base"}) || (a.order||0)-(b.order||0);
    case "recent":   return (a,b)=> (b.ts||0)-(a.ts||0);
    default:         return (a,b)=> (a.order||0)-(b.order||0);   // custom / as added
  }
}
function projectCardHTML(p){
  const steps=stepsFor(p.id);
  const done=steps.filter(s=>s.done).length;
  const pct = steps.length ? Math.round(done/steps.length*100) : 0;
  const unscheduled = steps.some(s=>!s.done && !s.schedISO);
  return `<div class="proj" data-id="${p.id}">
    <div class="projhd">
      <span class="ptitle" data-act="editproj">${esc(p.title||"Untitled project")}</span>
      <button class="who ${normWho(p.who)}" data-act="editproj">${whoLabel(p.who)}</button>
      <button class="editb" data-act="editproj" aria-label="Edit"><svg width="17" height="17"><use href="#i-edit"/></svg></button>
    </div>
    <div class="pbar"><span style="width:${pct}%"></span></div>
    <div class="pmeta">${done}/${steps.length} done</div>
    <ul class="items">${steps.map(stepRow).join("")||'<li class="emptyhint">No steps yet.</li>'}</ul>
    <div class="projactions">
      <button class="addmini left" data-act="addstep" data-pid="${p.id}"><svg><use href="#i-plus"/></svg>Add step</button>
      ${unscheduled?`<button class="addmini" data-act="autosched" data-pid="${p.id}"><svg><use href="#i-clock"/></svg>Auto-schedule</button>`:""}
    </div>
  </div>`;
}
function renderProjects(){
  const projs=projectsAll().slice().sort(projectCompare(projSort));
  const cnt=document.getElementById("projCount");
  if(cnt) cnt.textContent = projs.length+" project"+(projs.length===1?"":"s");
  const sel=document.getElementById("projSort");
  if(sel && sel.value!==projSort) sel.value=projSort;

  let html="", lastWho=null;
  projs.forEach(p=>{
    if(projSort==="who" && p.who!==lastWho){ html+=`<div class="grp">${whoLabel(p.who)}</div>`; lastWho=p.who; }
    html+=projectCardHTML(p);
  });
  if(!projs.length) html = `<div class="emptybig"><svg width="34" height="34"><use href="#i-folder"/></svg><p>No projects yet.<br>Add one to track a multi-step job like the stairs.</p></div>`;
  html += `<button class="bigadd" data-act="addproj"><svg width="18" height="18"><use href="#i-plus"/></svg> New project</button>`;
  document.getElementById("projectsBody").innerHTML = html;
}
function stepRow(s){
  const p=projectOf(s);
  const who=normWho(s.who||(p?p.who:"both")||"both");
  const sched = s.schedISO ? `<span class="sub"><svg class="tiny"><use href="#i-clock"/></svg> ${fmtDateShort(stepEffectiveISO(s))}${(!s.done&&s.schedISO<todayISO())?" (rolled to today)":""}</span>` : "";
  return `<li><div class="item ${who} ${s.done?'done':''}" data-id="${s.id}">
    <div class="box" data-act="stepcheck"><svg><use href="#i-check"/></svg></div>
    <div class="lab"><span class="txt" data-act="editstep">${esc(s.text)}</span>${sched}</div>
    <button class="who ${who}" data-act="editstep">${whoLabel(who)}</button>
    <button class="editb" data-act="editstep" aria-label="Edit"><svg width="17" height="17"><use href="#i-edit"/></svg></button>
  </div></li>`;
}

function renderNotes(){
  const notes=notesAll();
  let html = notes.map(n=>{
    const mine = n.by===me;
    const status = mine
      ? (n.seenBy ? `<span class="seen">Seen by ${WHO[n.seenBy.who]||"them"}</span>` : `<span class="unseen">Not seen yet</span>`)
      : (n.seenBy ? `<span class="seen">Got it</span>` : `<button class="gotit" data-act="ack">Got it</button>`);
    return `<div class="note ${mine?'mine':''}" data-id="${n.id}">
      <div class="nmeta"><span class="nby">${WHO[n.by]||"Someone"}</span> · ${relTime(n.ts)}
        <button class="ndel" data-act="ndel" aria-label="Delete"><svg width="14" height="14"><use href="#i-trash"/></svg></button></div>
      <div class="ntext">${esc(n.text)}</div>
      <div class="nstatus">${status}</div>
    </div>`;
  }).join("");
  if(!notes.length){
    const others=members().filter(m=>m.id!==me);
    html = `<div class="emptybig"><svg width="34" height="34"><use href="#i-note"/></svg><p>No notes yet.<br>Leave one for ${others.length===1?esc(others[0].name):"each other"}.</p></div>`;
  }
  document.getElementById("notesBody").innerHTML = html;
}

/* ============================== wiring =========================== */
function wireWeek(){
  document.querySelectorAll("#days .daypill").forEach(el=>{
    el.onclick=()=>{ selDay=Number(el.dataset.day); renderWeek();
      el.scrollIntoView({behavior:"smooth", inline:"center", block:"nearest"}); };
  });
  const add=document.getElementById("addBtn"), input=document.getElementById("newText");
  if(add&&input){ add.onclick=()=>addTodo(input.value); input.addEventListener("keydown",e=>{ if(e.key==="Enter") addTodo(input.value); }); }
  wireRolodex();
}
/* the person-card carousel: open on your own card, remember where you
   swiped to across re-renders, keep the dots in step */
function wireRolodex(){
  const ro=document.getElementById("rolodex"); if(!ro) return;
  const slides=[...ro.querySelectorAll(".slide")];
  if(slides.length<2) return;
  let idx=slides.findIndex(s=>s.dataset.mid===rolodexMid);
  if(idx<0) idx=Math.max(0, slides.findIndex(s=>s.dataset.mid===me));
  const left=i=>slides[i].offsetLeft - slides[0].offsetLeft;
  if(idx>0) ro.scrollLeft=left(idx);
  const dots=document.querySelectorAll("#rolodots span");
  const paint=i=>dots.forEach((d,j)=>d.classList.toggle("on", j===i));
  paint(idx);
  ro.addEventListener("scroll", ()=>{
    const step=slides.length>1 ? left(1) : 1;
    const i=Math.max(0, Math.min(slides.length-1, Math.round(ro.scrollLeft/Math.max(1,step))));
    rolodexMid=slides[i].dataset.mid; paint(i);
  }, {passive:true});
}

/* ===================== printable week (blank planner) ============= */
function pItem(text, who){
  const both = who==="both";
  const w = (who && who!=="both" && WHO[who]) ? `<span class="pwho">${WHO[who]}</span>` : "";
  return `<div class="pitem"><span class="pbox"></span><span class="${both?'pboth':''}">${esc(text)}</span> ${w}</div>`;
}
function printWeekHTML(){
  let h = `<h1>Our Week</h1><div class="prange">${esc(fmtRange())}</div>`;
  for(let i=0;i<7;i++){
    const d=dateForDay(i), iso=isoOf(d), wk=weekKeyOf(d);
    const todos=Object.values(items).filter(t=>t.kind==="todo"&&!t._gone&&(t.repeat?t.day===i:(t.weekKey===wk&&t.day===i))).sort(byOrder);
    const sched=Object.values(items).filter(t=>t.kind==="pstep"&&!t._gone&&t.schedISO&&stepEffectiveISO(t)===iso).sort(byOrder);
    const clean=tplList("clean", i);
    const care=careItems(i);
    const appts=apptsForDate(iso);
    h += `<div class="pday"><div class="pdayname">${DAY_FULL[i]}, ${d.toLocaleDateString("en-US",{month:"long",day:"numeric"})}</div>`;
    const shifts=shiftsForDate(iso);
    members().forEach(m=>{
      const nid = m.id==="lindsay" ? "info:"+i+":headline" : "info:"+i+":note:"+m.id;
      const txt = items[nid] ? (items[nid].text||"") : "";
      if(txt) h += `<div class="pmeta"><b>${m.name}:</b> ${esc(txt)}</div>`;
    });
    if(shifts.length){
      const owners={}; shifts.forEach(s=>{ owners[shiftWho(s)]=1; });
      const named = Object.keys(owners).length>1;   // several people work → say whose is whose
      h += `<div class="pmeta2">Shifts: ${shifts.map(s=>(named?(WHO[shiftWho(s)]||"?")+" ":"")+(s.start?fmtTime(s.start):"TBD")+(s.end?"–"+fmtTime(s.end):"")+(s.label?" "+s.label:"")).join(" · ")}</div>`;
    }
    h += `<div class="pmeta2">Energy: ${esc(energyInfo(i, iso).text)} · ${noteRowLabel()}: ${esc(infoText(i,"furniture"))}</div>`;
    if(care.length) h += `<div class="pmeta2">${care.map(c=>esc(c.text)).join(" · ")}</div>`;
    if(appts.length){
      h += `<div class="psec">Appointments</div>`;
      h += appts.map(a=>pItem((a.time?fmtTime(a.time)+" — ":"")+(a.title||"Appointment"), a.who)).join("");
    }
    h += `<div class="psec">To-dos</div>`;
    h += (todos.length||sched.length)
      ? todos.map(t=>pItem(t.text,t.who)).join("") + sched.map(s=>pItem(s.text+" ("+(projectOf(s)?projectOf(s).title:"project")+")", s.who||"")).join("")
      : `<div class="pline">—</div>`;
    h += `<div class="psec">Cleaning</div>`;
    h += clean.length ? clean.map(c=>pItem(c.text,c.who)).join("") : `<div class="pline">—</div>`;
    h += `</div>`;
  }
  h += `<div class="proutine"><div class="pdayname">Every day</div>`;
  h += `<div class="psec">Every morning</div>` + tplList("morning","daily").map(r=>pItem(r.text,r.who)).join("");
  h += `<div class="psec">Every night</div>` + tplList("night","daily").map(r=>pItem(r.text,r.who)).join("");
  h += `<div class="psec">Each day</div>` + tplList("each","daily").map(r=>pItem(r.text,r.who)).join("");
  const mems=members();
  h += `<div class="pfoot">Bold = ${mems.length>2 ? "for everyone" : "needs both "+mems[0].name+" &amp; "+mems[1].name}.</div></div>`;
  return h;
}
function doPrint(){
  if(!HAS_DOM) return;
  document.getElementById("printSheet").innerHTML = printWeekHTML();
  window.print();
}

if(HAS_DOM){
  /* tabs */
  document.getElementById("tabs").addEventListener("click", e=>{
    const b=e.target.closest("button[data-view]"); if(!b) return;
    view=b.dataset.view; render();
  });

  /* week view delegation */
  document.getElementById("day").addEventListener("click", e=>{
    const el=e.target.closest("[data-act]"); if(!el) return;
    const act=el.dataset.act;
    if(act==="addtpl"){ const sc=el.dataset.scope; addTpl(el.dataset.sec, sc==="daily"?"daily":Number(sc), el.dataset.check==="1"); return; }
    if(act==="addcare"){ addCare(Number(el.dataset.scope)); return; }
    if(act==="addappt"){ addAppt(); return; }
    if(act==="addshift"){ addShift(el.dataset.mid); return; }
    if(act==="editnote"){
      // a person's day-note: create the doc on first tap, then edit as usual
      const nid=el.dataset.noteid;
      if(!items[nid]){
        // info:<weekday>:headline | info:<weekday>:furniture | info:<weekday>:note:<memberId>
        const parts=nid.split(":");
        const field = (parts[2]==="headline"||parts[2]==="furniture") ? parts[2] : "note";
        put({ id:nid, kind:"info", weekday:Number(parts[1]), field, mid:parts[3]||null, text:"" });
      }
      openEditor(nid);
      return;
    }
    const row=el.closest("[data-id]"); if(!row) return;
    const id=row.dataset.id;
    if(act==="tplcheck"){ toggleTpl(id); row.classList.toggle("done"); refreshProgress(); }
    else if(act==="todocheck"){ toggleTodo(id); row.classList.toggle("done"); refreshProgress(); }
    else if(act==="stepcheck"){ toggleStep(id); render(); }
    else if(act==="apptcheck"){ toggleAppt(id, selDayISO()); render(); }
    else if(act==="edititem" || act==="editbtn"){ openEditor(id); }
    else if(act==="editstep" || act==="editappt" || act==="editshift"){ openEditor(id); }
  });

  /* master list delegation */
  document.getElementById("listBody").addEventListener("click", e=>{
    const el=e.target.closest("[data-act]"); if(!el) return;
    if(el.dataset.act==="planweek"){
      const pending = masterTodos().filter(t=>!t.done).length
        + Object.values(items).filter(t=>t.kind==="pstep"&&!t._gone&&!t.done&&!t.schedISO).length;
      if(!pending){ showToast("Nothing left to schedule"); return; }
      if(!confirm("Spread your "+pending+" unscheduled task"+(pending===1?"":"s")+" across the coming days? (Already-dated items are left alone.)")) return;
      const n=planWeek(); view="week"; render();
      showToast("Planned "+n+" onto your week");
      return;
    }
    if(el.dataset.act==="unplanweek"){
      const cnt=autoPlannedItems().length;
      if(!cnt){ showToast("Nothing to un-plan"); return; }
      if(!confirm("Move the "+cnt+" auto-scheduled item"+(cnt===1?"":"s")+" back to the List / undated? (Anything you dated yourself stays put.)")) return;
      const n=unplanWeek(); render();
      showToast("Moved "+n+" back");
      return;
    }
    const row=el.closest("[data-id]"); if(!row) return;
    const id=row.dataset.id, act=el.dataset.act;
    if(act==="todocheck"){ toggleTodo(id); render(); }
    else if(act==="edititem" || act==="editbtn"){ openEditor(id); }
  });

  /* projects view delegation */
  document.getElementById("projectsBody").addEventListener("click", e=>{
    const el=e.target.closest("[data-act]"); if(!el) return;
    const act=el.dataset.act;
    if(act==="addproj"){ addProject(); return; }
    if(act==="addstep"){ addStep(el.dataset.pid); return; }
    if(act==="autosched"){ const n=autoScheduleProject(el.dataset.pid); showToast(n?("Scheduled "+n+" step"+(n===1?"":"s")):"No steps to schedule"); render(); return; }
    const row=el.closest("[data-id]"); if(!row) return;
    const id=row.dataset.id;
    if(act==="stepcheck"){ toggleStep(id); render(); }
    else if(act==="editstep"){ openEditor(id); }
    else if(act==="editproj"){ openEditor(id); }
  });

  /* notes view delegation */
  document.getElementById("notesBody").addEventListener("click", e=>{
    const el=e.target.closest("[data-act]"); if(!el) return;
    const row=el.closest("[data-id]"); if(!row) return;
    const id=row.dataset.id;
    if(el.dataset.act==="ack") ackNote(id);
    else if(el.dataset.act==="ndel") delNote(id);
  });
  document.getElementById("notePost").onclick=()=>{ const i=document.getElementById("noteText"); addNote(i.value); i.value=""; };
  document.getElementById("noteText").addEventListener("keydown",e=>{ if(e.key==="Enter"){ const i=e.target; addNote(i.value); i.value=""; } });

  /* projects sort */
  const projSortSel=document.getElementById("projSort");
  if(projSortSel){
    projSortSel.value=projSort;
    projSortSel.addEventListener("change", e=>{ projSort=e.target.value; localStorage.setItem("ow-projsort", projSort); renderProjects(); });
  }

  /* week nav */
  document.getElementById("prev").onclick=()=>{ currentMonday.setDate(currentMonday.getDate()-7); currentMonday=new Date(currentMonday); renderWeek(); };
  document.getElementById("next").onclick=()=>{ currentMonday.setDate(currentMonday.getDate()+7); currentMonday=new Date(currentMonday); renderWeek(); };

  /* toast undo */
  document.getElementById("toastUndo").onclick=()=>{
    if(lastDeleted){
      if(lastDeleted.seeded){ const t=items[lastDeleted.id]||lastDeleted.doc; t._gone=false; t.done=false; put(t); }
      else put(lastDeleted.doc);
      lastDeleted=null; render();
    }
    document.getElementById("toast").classList.remove("show");
  };

  /* editor wiring */
  document.getElementById("edWhoBtns").addEventListener("click", e=>{
    const b=e.target.closest("[data-who]"); if(!b) return;
    edWho=b.dataset.who; updateEdWho();
  });
  document.getElementById("edIconBtn").onclick=()=>{ edIcon=CARE_ICONS[(CARE_ICONS.indexOf(edIcon)+1)%CARE_ICONS.length]; updateEdIcon(); };
  document.getElementById("edDateClear").onclick=()=>{ document.getElementById("edDate").value=""; };
  document.getElementById("edTimeClear").onclick=()=>{ document.getElementById("edTime").value=""; };
  document.getElementById("edEndClear").onclick=()=>{ document.getElementById("edEnd").value=""; };
  document.getElementById("edSplitToggle").onclick=toggleSplit;
  document.getElementById("edSave").onclick=saveEditor;
  document.getElementById("edSkipWeek").onclick=()=>{
    if(editingId) toggleShiftSkip(editingId);
    editingFresh=false; editingId=null; closeEditorRaw(); render();
  };
  document.getElementById("edDelete").onclick=deleteFromEditor;
  document.getElementById("edCancel").onclick=closeEditor;
  document.getElementById("edText").addEventListener("keydown",e=>{ if(e.key==="Enter"&&!splitMode) saveEditor(); });
  document.getElementById("edText2").addEventListener("keydown",e=>{ if(e.key==="Enter") saveEditor(); });

  /* identity pickers */
  function paintIdPick(container, val){
    document.querySelectorAll(container+" [data-id]").forEach(b=> b.classList.toggle("on", b.dataset.id===val));
  }
  document.getElementById("welcomeId").addEventListener("click", e=>{
    const b=e.target.closest("[data-idx]"); if(!b) return;
    welcomeId=b.dataset.idx; paintWelcomeNames();
  });
  /* the welcome card grows one name box per person (2 to start, up to 6);
     the who-am-I buttons mirror whatever names are being typed */
  function welcomeNameInputs(){ return Array.prototype.slice.call(document.querySelectorAll("#welcomeNames input")); }
  function addWelcomeName(){
    const wrap=document.getElementById("welcomeNames");
    const n=welcomeNameInputs().length; if(n>=MAX_MEMBERS) return;
    const inp=document.createElement("input");
    inp.type="text"; inp.placeholder="Person "+(n+1); inp.autocomplete="off";
    inp.addEventListener("input", paintWelcomeNames);
    wrap.appendChild(inp);
    paintWelcomeNames();
    if(n>=2) inp.focus();
  }
  function paintWelcomeNames(){
    const names=welcomeNameInputs().map((el,i)=>cleanName(el.value)||("Person "+(i+1)));
    const idp=document.getElementById("welcomeId");
    idp.querySelectorAll("button").forEach(b=>b.remove());
    names.forEach((nm,i)=>{
      const b=document.createElement("button");
      b.dataset.idx=String(i); b.textContent=nm;
      b.classList.toggle("on", welcomeId===String(i));
      idp.appendChild(b);
    });
    const addBtn=document.getElementById("welcomeAddPerson");
    if(addBtn) addBtn.style.display = names.length>=MAX_MEMBERS ? "none" : "";
  }
  document.getElementById("setIdRow").addEventListener("click", e=>{
    const b=e.target.closest("[data-id]"); if(!b) return;
    me=b.dataset.id; localStorage.setItem("ow-me", me); paintIdPick("#setIdRow", me);
  });

  /* settings + welcome */
  const overlaySettings=document.getElementById("settings");
  const overlayWelcome=document.getElementById("welcome");
  let setPeopleDraft=[];   // working copy of the people list while settings is open
  function nextFreeColor(){
    const used=setPeopleDraft.map(m=>m.color);
    for(let i=0;i<MEMBER_COLORS.length;i++) if(used.indexOf(i)<0) return i;
    return setPeopleDraft.length % MEMBER_COLORS.length;
  }
  function paintSetPeople(){
    const wrap=document.getElementById("setPeople"); if(!wrap) return;
    wrap.innerHTML = setPeopleDraft.map((m,i)=>
      '<div class="prow" data-i="'+i+'">'+
        '<button class="pdot" data-act="pcolor" title="Tap to change colour" style="background:'+MEMBER_COLORS[m.color][0]+'"></button>'+
        '<input type="text" value="'+esc(m.name)+'" placeholder="Name" autocomplete="off" />'+
        (setPeopleDraft.length>2 ? '<button class="pdel" data-act="pdel" aria-label="Remove">✕</button>' : '')+
      '</div>').join("");
    const addBtn=document.getElementById("setAddPerson");
    if(addBtn) addBtn.style.display = setPeopleDraft.length>=MAX_MEMBERS ? "none" : "";
  }
  function syncDraftNames(){
    document.querySelectorAll("#setPeople .prow").forEach(row=>{
      const i=Number(row.dataset.i);
      const inp=row.querySelector("input");
      if(setPeopleDraft[i] && inp) setPeopleDraft[i].name=cleanName(inp.value);
    });
  }
  document.getElementById("setPeople").addEventListener("click", e=>{
    const b=e.target.closest("[data-act]"); if(!b) return;
    const row=b.closest(".prow"); if(!row) return;
    const i=Number(row.dataset.i);
    syncDraftNames();
    if(b.dataset.act==="pcolor"){
      setPeopleDraft[i].color=(setPeopleDraft[i].color+1)%MEMBER_COLORS.length;
      paintSetPeople();
    } else if(b.dataset.act==="pdel"){
      if(setPeopleDraft.length<=2) return;
      const m=setPeopleDraft[i];
      if(m.id && !confirm("Remove "+(m.name||"this person")+"? Their tasks move to shared, and their shifts are removed. (Takes effect when you press Save.)")) return;
      setPeopleDraft.splice(i,1);
      paintSetPeople();
    }
  });
  document.getElementById("setAddPerson").onclick=()=>{
    if(setPeopleDraft.length>=MAX_MEMBERS) return;
    syncDraftNames();
    setPeopleDraft.push({ id:null, name:"", color:nextFreeColor() });
    paintSetPeople();
    const rows=document.querySelectorAll("#setPeople .prow input");
    if(rows.length) rows[rows.length-1].focus();
  };
  function openSettings(){
    document.getElementById("setCode").value=household;
    setPeopleDraft = members().map(m=>({ id:m.id, name:m.name, color:m.color }));
    paintSetPeople();
    // starter to-dos belong to the original household only
    document.getElementById("setReseed").style.display = namesDoc() ? "none" : "";
    paintIdPick("#setIdRow", me);
    const st=document.getElementById("setStatus");
    const dot='<svg width="10" height="10" viewBox="0 0 10 10"><circle cx="5" cy="5" r="5" fill="currentColor"/></svg>';
    if(CONFIGURED){ st.innerHTML=dot+" Live sync is ON"; st.className="statusline synced"; }
    else { st.innerHTML=dot+" This device only — sync keys not added yet"; st.className="statusline local"; }
    document.getElementById("setMeta").innerHTML=CONFIGURED
      ? "Everyone using this code shares one live plan. Changing the code switches to a different plan."
      : "To sync across phones, add your Firebase keys in <code>app.js</code> — see <code>SETUP-GUIDE.md</code>.";
    paintReminders();
    overlaySettings.classList.add("show");
  }
  async function paintReminders(){
    const st=document.getElementById("remindStatus"), btn=document.getElementById("remindBtn");
    const dot='<svg width="10" height="10" viewBox="0 0 10 10"><circle cx="5" cy="5" r="5" fill="currentColor"/></svg>';
    const s=await reminderState();
    const map={
      on:           [dot+" Reminders are ON for this phone", "synced", "Turn off"],
      off:          [dot+" Reminders are off on this phone", "local", "Turn on reminders"],
      denied:       [dot+" Notifications are blocked in your phone settings", "local", "How to fix"],
      "needs-sync": [dot+" Turn on live sync first (Option 2 in the setup guide)", "local", null],
      "needs-keys": [dot+" Reminders aren't set up yet — see REMINDERS-SETUP.md", "local", null],
      unsupported:  [dot+" Add the app to your Home Screen first, then reminders can turn on", "local", null],
    };
    const row=map[s]||map.off;
    st.innerHTML=row[0]; st.className="statusline "+row[1];
    if(row[2]){ btn.style.display=""; btn.textContent=row[2]; } else { btn.style.display="none"; }
    btn.dataset.state=s;
  }
  document.getElementById("remindBtn").onclick=async ()=>{
    const s=document.getElementById("remindBtn").dataset.state;
    if(s==="on"){ await disableReminders(); }
    else if(s==="denied"){ alert("Notifications are blocked for the app. On iPhone: Settings → Notifications → Our Week → allow. (Or delete the Home Screen app and re-add it, then turn reminders on again.)"); }
    else { const r=await enableReminders(); if(r==="error") alert("Couldn't turn on reminders — check REMINDERS-SETUP.md is finished."); }
    await paintReminders();
  };
  document.getElementById("gear").onclick=openSettings;
  document.getElementById("printBtn").onclick=doPrint;
  document.getElementById("setClose").onclick=()=>overlaySettings.classList.remove("show");
  document.getElementById("setSave").onclick=async ()=>{
    // Save the people list — renames, colours, added or removed people.
    syncDraftNames();
    const list=setPeopleDraft.filter(m=>m.id || m.name);   // an empty brand-new row just goes away
    if(list.filter(m=>m.name).length<2){ alert("Keep at least two named people."); return; }
    list.forEach((m,i)=>{ if(!m.name) m.name="Person "+(i+1); });
    const usedIds={}; list.forEach(m=>{ if(m.id) usedIds[m.id]=1; });
    list.forEach(m=>{ if(!m.id){ let id; do{ id="p"+Math.random().toString(36).slice(2,7); }while(usedIds[id]); usedIds[id]=1; m.id=id; } });
    const plain=list.map(m=>({id:m.id, name:m.name, color:m.color}));
    const removed=members().map(m=>m.id).filter(id=>!usedIds[id]);
    if(JSON.stringify(plain)!==JSON.stringify(members().map(m=>({id:m.id,name:m.name,color:m.color})))){
      // a removed person's tasks become shared; their shifts go away
      removed.forEach(id=>{
        Object.values(items).forEach(t=>{
          if(!t || t._gone) return;
          if(t.kind==="shift" && shiftWho(t)===id) drop(t.id);
          else if(t.who===id){ t.who="both"; put(t); }
        });
      });
      put({ id:"meta:members", kind:"members", list:plain });
      // mirror the first two names into meta:names so a phone still on the
      // old app version keeps showing the right names (noteLabel preserved)
      put(Object.assign({}, namesDoc()||{}, { id:"meta:names", kind:"names",
          ben:plain[0].name, lindsay:(plain[1]||{}).name||"Person 2" }));
      if(removed.indexOf(me)>=0){ me=plain[0].id; localStorage.setItem("ow-me", me); }
      applyNames();
    }
    const v=document.getElementById("setCode").value.trim(); if(!v){ overlaySettings.classList.remove("show"); render(); return; }
    // Changing to a new code? Keep a copy of the plan so it can move along.
    const prevCode=household;
    const prev = (prevCode && v!==prevCode) ? Object.assign({}, items) : null;
    household=v; localStorage.setItem("ow-household",household);
    overlaySettings.classList.remove("show"); connect();
    if(prev && Object.keys(prev).length &&
       confirm("Bring your plan's data over to this new code? (OK = everything moves with you. Do this on each phone — it's safe to repeat.)")){
      Object.values(prev).forEach(d=>put(d));
      if((await reminderState())==="on") enableReminders();   // re-point this phone's reminders
      showToast("Moved your plan to the new code");
      render();
    } else if(prev && (await reminderState())==="on"){
      enableReminders();   // even without moving data, reminders follow the code
    }
  };
  document.getElementById("setReseed").onclick=()=>{
    if(confirm("Re-add this week's starter to-dos? (Your own added items stay.)")){
      seedTodosIfNeeded(true); overlaySettings.classList.remove("show"); render();
    }
  };
  /* import an agent-sorted dump — JSON format in DUMP-IMPORT.md */
  document.getElementById("setImport").onclick=()=>document.getElementById("importFile").click();
  document.getElementById("importFile").addEventListener("change", e=>{
    const f=e.target.files[0]; e.target.value=""; if(!f) return;
    const r=new FileReader();
    r.onload=()=>{
      let n=0;
      try{ n=importMany(JSON.parse(r.result)); }
      catch(err){ alert("Couldn't read that file — expected a JSON list of tasks (see DUMP-IMPORT.md)."); return; }
      overlaySettings.classList.remove("show");
      view="list"; render();
      showToast("Imported "+n+" task"+(n===1?"":"s"));
    };
    r.readAsText(f);
  });
  document.getElementById("welcomeStart").onclick=()=>{
    const v=document.getElementById("welcomeCode").value.trim();
    if(!v){ document.getElementById("welcomeCode").focus(); return; }
    const inputs=welcomeNameInputs();
    const raw=inputs.map(el=>cleanName(el.value));
    if(!raw[0]){ inputs[0].focus(); return; }
    if(!raw[1]){ inputs[1].focus(); return; }
    // an extra box added by mistake and left blank just gets skipped
    const names=[], mapIdx=[];
    raw.forEach((n,i)=>{ if(n){ mapIdx[i]=names.length; names.push(n); } else mapIdx[i]=-1; });
    const picked = welcomeId==="" ? -1 : mapIdx[Number(welcomeId)];
    if(picked==null || picked<0){ document.getElementById("welcomeId").classList.add("shake"); setTimeout(()=>document.getElementById("welcomeId").classList.remove("shake"),400); return; }
    household=v; me=memberIdFor(picked);
    localStorage.setItem("ow-household",household); localStorage.setItem("ow-me", me);
    // names + picked identity travel to the first look at this household;
    // they only take effect if the code turns out to be brand new
    localStorage.setItem("ow-pending-setup", JSON.stringify({ people:names, picked:names[picked] }));
    overlayWelcome.classList.remove("show"); connect();
  };

  /* boot */
  if(!household || !me){
    document.getElementById("welcomeCode").value = household || "our-home-"+Math.random().toString(36).slice(2,8);
    welcomeId = "";
    addWelcomeName(); addWelcomeName();
    document.getElementById("welcomeAddPerson").onclick=addWelcomeName;
    // NOTE: no seeding before a code is chosen — the backdrop behind the
    // welcome card stays generic, so the public URL shows no family's plan.
    loadLocal(); render();
    overlayWelcome.classList.add("show");
  } else {
    connect();
  }

  if("serviceWorker" in navigator && location.protocol.indexOf("http")===0){
    navigator.serviceWorker.register("service-worker.js").catch(()=>{});
  }
}

function showToast(msg){
  if(!HAS_DOM) return;
  const toast=document.getElementById("toast");
  document.getElementById("toastMsg").textContent=msg;
  document.getElementById("toastUndo").style.display = lastDeleted ? "" : "none";
  toast.classList.add("show");
  clearTimeout(undoTimer);
  undoTimer=setTimeout(()=>{ toast.classList.remove("show"); lastDeleted=null; },5000);
}

/* ===================== node self-test (no DOM) ==================== */
if(!HAS_DOM){
  household="testcode"; me="ben"; items={};
  seedTodosIfNeeded(); seedTemplateIfNeeded();
  const all=()=>Object.values(items);
  console.log("info:", all().filter(t=>t.kind==="info").length, "(21)",
              "| clean:", all().filter(t=>t.kind==="tpl"&&t.sec==="clean").length, "(7)",
              "| routine:", all().filter(t=>t.kind==="tpl"&&["morning","night","each"].includes(t.sec)).length, "(14)");

  /* notes */
  me="ben"; addNote("Grabbed the mail");
  let note=notesAll()[0];
  console.log("note by ben, unseen → unread for lindsay:", (function(){ me="lindsay"; const u=unreadCount(); me="ben"; return u; })()===1);
  me="lindsay"; ackNote(note.id); me="ben";
  console.log("after ack, unread:", unreadCount(), "(0)", "| seenBy set:", !!items[note.id].seenBy);

  /* projects + scheduled step (dates relative to today so it never goes stale) */
  const futSat=(()=>{ const d=new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate() + (5-((d.getDay()+6)%7)) + 14); return d; })(); // a Saturday ~2 weeks out
  const futISO=isoOf(futSat);
  const proj={id:"proj:test", kind:"project", title:"Stairs", who:"ben", order:0, ts:1000};
  items[proj.id]=proj;
  const sid="pstep:test"; items[sid]={id:sid, kind:"pstep", projectId:proj.id, text:"Prime + paint", done:false, schedISO:futISO, order:0};
  saveLocalSafe();
  console.log("project steps:", stepsFor(proj.id).length, "(1)");
  console.log("shows on its scheduled date:", scheduledStepsFor(futISO).length===1);
  // gentle drift: an old undone step shows on today
  items["pstep:old"]={id:"pstep:old", kind:"pstep", projectId:proj.id, text:"Old step", done:false, schedISO:"2000-01-01", order:1};
  console.log("old undone step drifts to today:", scheduledStepsFor(todayISO()).some(s=>s.id==="pstep:old"));
  console.log("old step NOT shown on its past date:", scheduledStepsFor("2000-01-01").length===0);
  // done step stays on its date (history), not today
  items[sid].done=true;
  console.log("done step stays on date:", scheduledStepsFor(futISO).length===1);
  // week-view progress includes scheduled steps
  selDay=5; currentMonday=mondayOf(futSat);
  const pr=dayProgress(); console.log("Sat progress total includes sched step:", pr.total>=16, "total", pr.total);
  const ph=printWeekHTML();
  console.log("print: Monday:", ph.includes("Monday"), "| Every day:", ph.includes("Every day"), "| boxes:", ph.includes("pbox"), "| bold-both:", ph.includes("pboth"));
  // appointments
  items["appt:1"]={id:"appt:1",kind:"appt",title:"Dentist",who:"lindsay",date:todayISO(),time:"14:30",repeat:false,remind:"morning",done:false};
  const wd=(new Date(todayISO()+"T00:00:00").getDay()+6)%7;
  items["appt:2"]={id:"appt:2",kind:"appt",title:"Sam gymnastics",who:"both",date:"2026-06-17",time:"10:30",repeat:true,remind:"dayBefore",done:false};
  console.log("appt today shows:", apptsForDate(todayISO()).some(a=>a.id==="appt:1"));
  console.log("weekly appt shows on its weekday:", apptsForDate(isoOf((()=>{const m=mondayOf(new Date());const x=new Date(m);x.setDate(x.getDate()+2);return x;})())).some(a=>a.id==="appt:2"));
  console.log("fmtTime 14:30 →", fmtTime("14:30"), "| blank →", fmtTime(""));
  console.log("comingUp includes today's dentist:", comingUp().some(o=>o.a.id==="appt:1"));
  items["appt:1"].remind="none";
  console.log("remind=none drops from comingUp:", !comingUp().some(o=>o.a.id==="appt:1"));

  /* master list: auto-sorting + dumps */
  console.log("classify rake → yard/ben:", (function(){const c=classify("Rake the lawn"); return c.area==="yard"&&c.who==="ben";})());
  console.log("classify list TVs → selling/lindsay:", (function(){const c=classify("List the TVs"); return c.area==="selling"&&c.who==="lindsay";})());
  console.log("classify paint toenails → personal (not paint):", classify("Paint toenails").area==="personal");
  console.log("classify dresser to shop → shop/both:", (function(){const c=classify("Take the dresser to the shop"); return c.area==="shop"&&c.who==="both";})());
  const mt=importOne({text:"Fabric-clean the ottoman"});
  console.log("dump lands on master list:", mt.weekKey===null && mt.area==="cleaning");
  const st2=importOne({text:"Mow the lawn on Thursday"});
  console.log("'on Thursday' schedules to a day:", !!st2.weekKey && st2.day===3 && st2.text==="Mow the lawn");
  console.log("import file shape works:", importMany([{text:"Water the plants"},"Bottle depot"])===2);
  console.log("dictation splits on commas, keeps 'and':",
    JSON.stringify(splitDictation("buy milk, wash and fold laundry"))==='["buy milk","wash and fold laundry"]');
  console.log("dictation single line stays whole:", splitDictation("clean the garage").length===1);
  console.log("masterTodos groups them:", masterTodos().length>=3);

  /* Johny is gone from the seed */
  console.log("no Johny in care seed:", !Object.values(items).some(t=>t.kind==="tpl"&&t.sec==="care"&&/johny/i.test(t.text||"")));
  console.log("migration tombstones a stray Johny chip:", (function(){
    items["care:0:9"]={id:"care:0:9",kind:"tpl",sec:"care",scope:0,text:"Johny — outside 3×",icon:"i-paw",order:9};
    delete items["meta:mig:nojohny"]; migrateRemoveJohny();
    return items["care:0:9"]._gone===true;
  })());

  /* shifts: dated, with start times, weekly-repeatable */
  items["shift:1"]={id:"shift:1",kind:"shift",label:"Night",date:todayISO(),start:"15:00",end:"23:00",repeat:false};
  console.log("shift shows on its date:", shiftsForDate(todayISO()).some(s=>s.id==="shift:1"));
  const wd2=(new Date(todayISO()+"T00:00:00").getDay()+6)%7;
  items["shift:2"]={id:"shift:2",kind:"shift",label:"Day",date:todayISO(),start:"07:00",end:"",repeat:true};
  const nextWk=new Date(); nextWk.setDate(nextWk.getDate()+7);
  console.log("weekly shift repeats next week:", shiftsForDate(isoOf(nextWk)).some(s=>s.id==="shift:2"));
  console.log("shifts sort by start time:", shiftsForDate(todayISO())[0].id==="shift:2");
  console.log("shift prints under Lindsay:", (function(){ selDay=todayMonIndex(); currentMonday=mondayOf(new Date()); return printWeekHTML().includes("Shifts:"); })());

  /* energy auto-derives from shifts */
  delete items["shift:1"]; delete items["shift:2"];
  (function(){
    const iso="2026-08-03", prev="2026-08-02";           // Mon / Sun, no other shifts
    console.log("energy blank with no shift:", deriveEnergy(iso)==="");
    items["shift:e1"]={id:"shift:e1",kind:"shift",date:iso,start:"15:00",end:"23:00",repeat:false};
    console.log("night shift → works tonight/light:", /works tonight/i.test(deriveEnergy(iso)) && /— light$/.test(deriveEnergy(iso)));
    items["shift:e2"]={id:"shift:e2",kind:"shift",date:iso,start:"07:00",end:"15:00",repeat:false};
    delete items["shift:e1"];
    console.log("day shift only → moderate:", /day shift/i.test(deriveEnergy(iso)) && /— moderate$/.test(deriveEnergy(iso)));
    items["shift:e1"]={id:"shift:e1",kind:"shift",date:iso,start:"15:00",end:"23:00",repeat:false};
    items["shift:e0"]={id:"shift:e0",kind:"shift",date:prev,start:"15:00",end:"23:00",repeat:false};
    console.log("off-a-shift + works → lightest:", /Off a night shift/.test(deriveEnergy(iso)) && /— lightest$/.test(deriveEnergy(iso)));
    delete items["shift:e0"]; delete items["shift:e1"]; delete items["shift:e2"];
  })();

  /* regular shifts auto-seed as repeating + skip-this-week */
  seedShiftsIfNeeded();
  console.log("seeds 3 regular repeating shifts:", Object.values(items).filter(t=>t.kind==="shift"&&t.repeat&&/^shift:reg:/.test(t.id)).length===3);
  console.log("Mon regular shows 5:30pm:", shiftsForDate("2026-08-03").some(s=>s.id==="shift:reg:mon"&&s.start==="17:30"));
  console.log("Fri regular shows 4pm:", shiftsForDate("2026-08-07").some(s=>s.id==="shift:reg:fri"&&s.start==="16:00"));
  (function(){
    const monISO="2026-08-03";
    selDay=0; currentMonday=mondayOf(new Date(monISO+"T00:00:00"));
    toggleShiftSkip("shift:reg:mon");
    console.log("skip hides it that week (active):", !shiftsForDate(monISO).some(s=>s.id==="shift:reg:mon"));
    console.log("skip keeps it visible on card (muted):", allShiftsOccurring(monISO).some(s=>s.id==="shift:reg:mon"));
    console.log("skip doesn't touch next week:", shiftsForDate("2026-08-10").some(s=>s.id==="shift:reg:mon"));
    toggleShiftSkip("shift:reg:mon");
    console.log("un-skip restores it:", shiftsForDate(monISO).some(s=>s.id==="shift:reg:mon"));
  })();

  /* project sorting */
  items["proj:apple"]={id:"proj:apple",kind:"project",title:"Apple",who:"lindsay",order:5,ts:1};
  items["proj:zebra"]={id:"proj:zebra",kind:"project",title:"Zebra",who:"ben",order:2,ts:9};
  items["pstep:z1"]={id:"pstep:z1",kind:"pstep",projectId:"proj:zebra",text:"a",done:true,order:0};
  const nm=projectsAll().slice().sort(projectCompare("name")).map(p=>p.title);
  console.log("name sort A→Z:", nm.indexOf("Apple")<nm.indexOf("Zebra"));
  const wh=projectsAll().slice().sort(projectCompare("who")).map(p=>p.who);
  console.log("who sort ben before lindsay:", wh.indexOf("ben")<wh.indexOf("lindsay"));
  const rc=projectsAll().slice().sort(projectCompare("recent")).map(p=>p.id);
  console.log("recent sort newest first:", rc.indexOf("proj:zebra")<rc.indexOf("proj:apple"));
  const pg=projectsAll().slice().sort(projectCompare("progress")).map(p=>p.id);
  console.log("progress sort least-done first:", pg.indexOf("proj:apple")<pg.indexOf("proj:zebra"));

  /* auto-sort who + auto-schedule around Lindsay's recovery days */
  console.log("classifyWho picks lindsay from wording:", classifyWho("wash the walls","ben")==="lindsay");
  console.log("classifyWho inherits project who when generic:", classifyWho("second coat","ben")==="ben");
  (function(){
    // one active Monday-night shift → Tuesday is her recovery day (blocked)
    items["shift:as"]={id:"shift:as",kind:"shift",date:"2026-08-03",start:"17:30",end:"",repeat:false}; // Mon
    console.log("Lindsay blocked on recovery day (Tue):", dayBlockedFor("lindsay","2026-08-04")===true);
    console.log("Lindsay free on the work day itself (Mon):", dayBlockedFor("lindsay","2026-08-03")===false);
    console.log("Ben never blocked:", dayBlockedFor("ben","2026-08-04")===false);
    items["proj:sch"]={id:"proj:sch",kind:"project",title:"Test",who:"lindsay",order:0,ts:1};
    items["pstep:s1"]={id:"pstep:s1",kind:"pstep",projectId:"proj:sch",text:"a",who:"lindsay",done:false,schedISO:null,order:0};
    items["pstep:s2"]={id:"pstep:s2",kind:"pstep",projectId:"proj:sch",text:"b",who:"lindsay",done:false,schedISO:null,order:1};
    const n=autoScheduleProject("proj:sch");
    const dates=[items["pstep:s1"].schedISO, items["pstep:s2"].schedISO];
    console.log("auto-schedule placed both steps:", n===2 && dates.every(Boolean));
    console.log("auto-schedule kept Lindsay off recovery days:", dates.every(d=>!dayBlockedFor("lindsay",d)));
    delete items["shift:as"]; delete items["proj:sch"]; delete items["pstep:s1"]; delete items["pstep:s2"];
  })();

  /* day-capacity packing: multiple per day up to capacity + per-project cap */
  (function(){
    items["proj:cap"]={id:"proj:cap",kind:"project",title:"Cap",who:"ben",order:0,ts:1};
    for(let i=0;i<6;i++) items["pstep:c"+i]={id:"pstep:c"+i,kind:"pstep",projectId:"proj:cap",text:"s"+i,who:"ben",done:false,schedISO:null,order:i};
    const n=autoScheduleProject("proj:cap");
    const placed=Object.values(items).filter(t=>t.kind==="pstep"&&t.projectId==="proj:cap");
    const byDay={}; placed.forEach(s=>{ byDay[s.schedISO]=(byDay[s.schedISO]||0)+1; });
    console.log("packs multiple per day (some day has >1):", Object.values(byDay).some(c=>c>1));
    console.log("respects per-project cap of "+PROJ_PER_DAY+":", Object.values(byDay).every(c=>c<=PROJ_PER_DAY));
    console.log("all 6 steps placed:", n===6);
    // capacity respects existing load
    const iso=placed[0].schedISO;
    console.log("personLoad counts placed steps:", personLoad("ben", iso)>=1);
    ["proj:cap"].concat(placed.map(s=>s.id)).forEach(id=>delete items[id]);
  })();

  /* recurring to-dos + un-plan */
  (function(){
    items["c:rep"]={id:"c:rep",kind:"todo",text:"Water plants",who:"lindsay",repeat:true,day:0,weekKey:null,done:false,order:1};
    selDay=0; currentMonday=mondayOf(new Date("2026-08-03T00:00:00"));
    console.log("recurring shows on its weekday every week:", todosForSel().some(t=>t.id==="c:rep"));
    console.log("recurring stays off the master List:", !masterTodos().some(t=>t.id==="c:rep"));
    toggleTodo("c:rep");
    console.log("recurring checks per-week:", todoDone(items["c:rep"])===true);
    currentMonday=mondayOf(new Date("2026-08-10T00:00:00"));
    console.log("next week starts unchecked:", todoDone(items["c:rep"])===false);
    delete items["c:rep"]; delete items["tdone:c:rep:2026-08-03"];
    // un-plan reverses only auto-scheduled items
    items["c:mine"]={id:"c:mine",kind:"todo",text:"by hand",who:"ben",weekKey:"2026-08-03",day:2,done:false,order:1};
    items["c:auto"]={id:"c:auto",kind:"todo",text:"auto",who:"ben",weekKey:"2026-08-03",day:2,done:false,autoPlanned:true,order:2};
    const u=unplanWeek();
    console.log("un-plan moved only the auto one:", u===1 && !items["c:auto"].weekKey && items["c:mine"].weekKey==="2026-08-03");
    delete items["c:mine"]; delete items["c:auto"];
  })();
  /* friend-ready: neutral households, dynamic names, name-aware classify */
  (function(){
    // a brand-new code set up through the welcome card seeds neutral
    items={};
    localStorage.setItem("ow-pending-setup", JSON.stringify({ben:"Alex", lindsay:"Jamie", picked:"Jamie"}));
    runSeeders();
    const vals=()=>Object.values(items);
    console.log("neutral: no starter todos:", vals().filter(t=>t.kind==="todo").length===0);
    console.log("neutral: no shifts:", vals().filter(t=>t.kind==="shift").length===0);
    console.log("neutral: no partner-day template:", vals().filter(t=>t.kind==="info").length===0);
    console.log("neutral: cleaning rota seeded:", vals().filter(t=>t.kind==="tpl"&&t.sec==="clean").length===7);
    console.log("neutral: names applied:", WHO.ben==="Alex" && WHO.lindsay==="Jamie");
    console.log("neutral: picked name adopted as identity:", me==="lindsay");
    // node has Firebase keys but no SDK, so writes can't be confirmed — the
    // pending setup must survive for the next (live) look at the household
    console.log("neutral: pending kept until cloud confirms:", pendingSetup()!==null);
    // sentinels keep the original seeders out of a neutral household
    seedTodosIfNeeded(); seedTemplateIfNeeded(); seedShiftsIfNeeded();
    console.log("neutral: legacy seeders stay out:", vals().filter(t=>t.kind==="info").length===0 && vals().filter(t=>t.kind==="shift").length===0);
    // explicit names win over keyword guessing; "both" words still win overall
    console.log("classify: name beats keywords:", classify("fold laundry with Alex").who==="ben");
    console.log("classify: both still wins:", classify("family walk with Alex").who==="both");
    // new households don't inherit the original family's habits: no name → Everyone
    console.log("classify: neutral household guesses Everyone:", classify("fold laundry with Maria").who==="both");
    console.log("classify: original household still keyword-guesses:", (function(){
      const saved=items["meta:names"]; delete items["meta:names"];
      const w=classify("fold laundry").who; items["meta:names"]=saved; return w==="lindsay";
    })());
    /* members: any number of people, each with their own shifts */
    console.log("members: welcome seeded a members list:", !!membersDoc() && members().length===2);
    items["meta:members"]={id:"meta:members",kind:"members",list:[
      {id:"ben",name:"Alex",color:0},{id:"lindsay",name:"Jamie",color:1},{id:"p3",name:"Sam",color:2}]};
    applyNames();
    console.log("members: three people + Everyone:", WHO_ORDER.join(",")==="ben,lindsay,p3,both" && WHO.both==="Everyone" && WHO.p3==="Sam");
    console.log("members: shared work spreads over all three:", whoList("both").length===3);
    console.log("members: a night shift blocks ITS owner next day:", (function(){
      items["shift:p3"]={id:"shift:p3",kind:"shift",who:"p3",date:"2026-08-03",start:"17:30",repeat:false};
      const ok = dayBlockedFor("p3","2026-08-04")===true && dayBlockedFor("ben","2026-08-04")===false
              && personCapacity("p3","2026-08-03")===Math.max(1,DAY_CAPACITY-2)
              && /works tonight/i.test(deriveEnergyFor("p3","2026-08-03")) && deriveEnergyFor("ben","2026-08-03")==="";
      delete items["shift:p3"]; return ok;
    })());
    console.log("members: ownerless shift stays the second slot's:", (function(){
      items["shift:ol"]={id:"shift:ol",kind:"shift",date:"2026-08-03",start:"17:30",repeat:false};
      const ok = dayBlockedFor("lindsay","2026-08-04")===true && dayBlockedFor("p3","2026-08-04")===false;
      delete items["shift:ol"]; return ok;
    })());
    console.log("members: add-shift from a person's card is theirs:", (function(){
      addShift("p3");
      const s=Object.values(items).find(t=>t.kind==="shift"&&t.who==="p3");
      const ok=!!s; if(s) drop(s.id); editingId=null; editingFresh=false; return ok;
    })());
    console.log("members: a gone person's tag reads as shared:", normWho("ghost")==="both" && whoLabel("ghost")===WHO.both);
    // names are cleaned so template injections stay safe
    items["meta:members"]={id:"meta:members",kind:"members",list:[
      {id:"ben",name:"<img src=x>Evil",color:0},{id:"lindsay",name:"O&K",color:1}]};
    applyNames();
    console.log("names sanitized:", WHO.ben==="img src=xEvil" && WHO.lindsay==="OK");
    // a household that already has data is never overwritten by a joining phone
    items={ "c:1":{id:"c:1",kind:"todo",text:"existing",who:"ben",done:false} };
    localStorage.setItem("ow-pending-setup", JSON.stringify({ben:"X", lindsay:"Y", picked:"X"}));
    runSeeders();
    console.log("existing household untouched by setup:", !items["meta:names"] && !!items["c:1"]);
    localStorage.removeItem("ow-pending-setup");
    items={}; applyNames(); me="ben";
    console.log("defaults restored:", WHO.ben==="Ben" && WHO.lindsay==="Lindsay");
  })();
  console.log("OK");
}
function saveLocalSafe(){ try{ saveLocal(); }catch(e){} }
