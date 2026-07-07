/* ================================================================== *
 *  Our Week — shared plan, projects & handoff notes for Ben & Lindsay.
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
  apiKey: "PASTE_API_KEY_HERE",
  authDomain: "PASTE_PROJECT.firebaseapp.com",
  projectId: "PASTE_PROJECT_ID",
  storageBucket: "PASTE_PROJECT.appspot.com",
  messagingSenderId: "PASTE_SENDER_ID",
  appId: "PASTE_APP_ID"
};
const CONFIGURED = !String(firebaseConfig.apiKey).startsWith("PASTE_");

/* ============================ constants =========================== */
const WHO = { ben:"Ben", lindsay:"Lindsay", both:"Both" };
const WHO_ORDER = ["ben","lindsay","both"];
const DAY_FULL  = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
const DAY_SHORT = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
const CARE_ICONS = ["i-paw","i-child","i-leaf","i-heart","i-list"];

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

function classify(text){
  const s=String(text).toLowerCase();
  let area="other";
  for(const r of AREA_RULES){ if(r[1].test(s)){ area=r[0]; break; } }
  let who=null;
  for(const r of WHO_RULES){ if(r[1].test(s)){ who=r[0]; break; } }
  return { area, who: who || AREA_WHO_DEFAULT[area] || "both" };
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
let currentMonday = mondayOf(new Date());
let selDay = todayMonIndex();
let pendWho = "ben";
let welcomeId = "";
let db = null, colRef = null, unsub = null, inboxUnsub = null, fbStarted = false;
let undoTimer = null, lastDeleted = null;
let editingId = null, edWho = "ben", edIcon = "i-paw", splitMode = false, editingFresh = false;

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
  loadLocal(); seedTodosIfNeeded(); seedTemplateIfNeeded(); autoRoll(); migrateRemoveJohny(); render();
  if(CONFIGURED && household && typeof firebase!=="undefined"){
    try{
      if(!fbStarted){ firebase.initializeApp(firebaseConfig); db=firebase.firestore();
        db.enablePersistence({synchronizeTabs:true}).catch(()=>{}); fbStarted=true; }
      colRef = db.collection("households").doc(household).collection("items");
      unsub = colRef.onSnapshot(snap=>{
        const next={}; snap.forEach(doc=> next[doc.id]=doc.data());
        items=next; seedTodosIfNeeded(); seedTemplateIfNeeded(); autoRoll(); migrateRemoveJohny(); saveLocal(); render(); setStatus(true);
      }, ()=> setStatus(false));
      drainInbox();
    }catch(e){ setStatus(false); }
  } else { setStatus(false); }
}

/* Siri (and remote dumps) drop raw docs into households/<code>/inbox —
   pull them in, auto-sort them, then clear the inbox. See SIRI-SETUP.md. */
function drainInbox(){
  inboxUnsub = db.collection("households").doc(household).collection("inbox")
    .onSnapshot(snap=>{
      let n=0;
      snap.forEach(doc=>{
        const f=doc.data()||{};
        const text=String(f.text||f.name||"").trim();
        if(text && importOne({text, who:f.who, area:f.area, date:f.date})) n++;
        doc.ref.delete().catch(()=>{});
      });
      if(n){ showToast("Added "+n+" to the List"); render(); }
    }, ()=>{});
}

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
function autoRoll(){
  const rk = realWeekKey(); let n=0;
  Object.values(items).forEach(t=>{
    if(t.kind==="todo" && !t._gone && !t.done && t.weekKey && t.weekKey < rk){
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
function todosForSel(){
  const wk=curWeekKey();
  return Object.values(items)
    .filter(t=>t.kind==="todo" && !t._gone && t.weekKey===wk && t.day===selDay)
    .sort((a,b)=>(a.done-b.done)||((a.order||0)-(b.order||0)));
}
function masterTodos(){
  return Object.values(items)
    .filter(t=>t.kind==="todo" && !t._gone && !t.weekKey)
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
function toggleTodo(id){ const t=items[id]; if(!t) return; t.done=!t.done; t.doneBy=t.done?(me||null):null; put(t); }
function toggleStep(id){ const t=items[id]; if(!t) return; t.done=!t.done; t.doneBy=t.done?(me||null):null; put(t); }
function cycleWho(id){ const t=items[id]; if(!t) return; t.who=WHO_ORDER[(WHO_ORDER.indexOf(t.who)+1)%WHO_ORDER.length]; put(t); render(); }
function addTodo(text){
  text=(text||"").trim(); if(!text) return;
  const id="c:"+Date.now()+Math.random().toString(36).slice(2,6);
  put({ id, kind:"todo", text, who:pendWho, area:classify(text).area,
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
  put({ id, kind:"pstep", projectId:pid, text:"", done:false, schedISO:null, order });
  openEditor(id, true);
}
function cycleProjWho(id){ cycleWho(id); }

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

/* Lindsay's work shifts — dated (or weekly-repeating), each with a start
   time. Kept separate from the weekly template so summer changes are just
   adding/removing shifts, never editing the recurring plan. */
function shiftsForDate(iso){
  return Object.values(items).filter(t=>t.kind==="shift"&&!t._gone&&apptOccursOn(t,iso))
    .sort((a,b)=>(a.start||"99:99").localeCompare(b.start||"99:99"));
}
function addShift(){
  const id="shift:"+Date.now()+Math.random().toString(36).slice(2,5);
  put({ id, kind:"shift", label:"", date:selDayISO(), start:"", end:"", repeat:false });
  openEditor(id, true);
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
function labelForInfo(f){ return f==="headline"?"Edit Lindsay's day":(f==="energy"?"Edit energy":(f==="furniture"?"Edit furniture":"Edit")); }
function updateEdWho(){ const b=document.getElementById("edWhoBtn"); b.className="who cyc "+edWho; b.textContent=WHO[edWho]; }
function updateEdIcon(){ document.getElementById("edIconBtn").innerHTML='<svg><use href="#'+edIcon+'"/></svg>'; }
function show(id, on){ document.getElementById(id).style.display = on?"":"none"; }
function openEditor(id, fresh){
  const t=items[id]; if(!t) return;
  editingId=id; editingFresh=!!fresh; splitMode=false;
  const isInfo = t.kind==="info";
  const isCare = t.kind==="tpl" && t.sec==="care";
  const isProj = t.kind==="project";
  const isStep = t.kind==="pstep";
  const isAppt = t.kind==="appt";
  const isShift = t.kind==="shift";
  const hasWho = t.kind==="todo" || (t.kind==="tpl" && t.check) || isProj || isAppt;
  edWho=t.who||"ben"; edIcon=t.icon||"i-paw";
  let title="Edit item";
  if(isInfo) title=labelForInfo(t.field);
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
  show("edRepeatRow", isAppt || isShift);
  show("edRemindRow", isAppt);
  show("edDelete", !isInfo);
  document.getElementById("edTimeLabel").textContent = isShift ? "Starts" : "Time";
  document.getElementById("edDateLabel").textContent = (isAppt||isShift) ? "Date" : (isTodo ? "Do on" : "Remind me on");
  show("edDateHint", isStep || isTodo);
  if(isStep){
    document.getElementById("edDateHint").textContent="A gentle nudge on that day — never a hard deadline. If it slips, it just drifts to today.";
    document.getElementById("edDate").value = t.schedISO || "";
  }
  if(isTodo){
    document.getElementById("edDateHint").textContent="Blank = stays on the master List. Day to-dos left unfinished roll forward each week.";
    document.getElementById("edDate").value = (t.weekKey && t.day!=null) ? isoOfWeekDay(t.weekKey, t.day) : "";
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
  const hasWho = t.kind==="todo" || (t.kind==="tpl" && t.check) || t.kind==="project" || t.kind==="appt";
  if(hasWho) t.who=edWho;
  if(t.kind==="tpl" && t.sec==="care") t.icon=edIcon;
  if(t.kind==="pstep"){ const v=document.getElementById("edDate").value; t.schedISO = v || null; }
  if(t.kind==="todo"){
    const v=document.getElementById("edDate").value;
    if(v){ const d=new Date(v+"T00:00:00"); t.weekKey=weekKeyOf(d); t.day=(d.getDay()+6)%7; }
    else { t.weekKey=null; t.day=null; }
    if(!t.area) t.area=classify(t.text).area;
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
function byTag(w){ return w ? `<span class="bytag">${WHO[w]?WHO[w][0]:"?"}</span>` : ""; }

function tplRow(it){
  const checked=isChecked(it.id);
  const who=it.who||"both";
  return `<li><div class="item ${who} ${checked?'done':''}" data-id="${it.id}">
    <div class="box" data-act="tplcheck"><svg><use href="#i-check"/></svg></div>
    <div class="lab"><span class="txt" data-act="edititem">${esc(it.text)}</span></div>
    <button class="who ${who}" data-act="cycwho">${WHO[who]}</button>
    <button class="editb" data-act="editbtn" aria-label="Edit"><svg width="17" height="17"><use href="#i-edit"/></svg></button>
  </div></li>`;
}
function todoRow(t){
  const sub = t.done && t.doneBy ? `<span class="sub">done by ${WHO[t.doneBy]}</span>` : "";
  return `<li><div class="item ${t.who} ${t.done?'done':''}" data-id="${t.id}">
    <div class="box" data-act="todocheck"><svg><use href="#i-check"/></svg></div>
    <div class="lab"><span class="txt" data-act="edititem">${esc(t.text)}</span>${sub}</div>
    <button class="who ${t.who}" data-act="cycwho">${WHO[t.who]}</button>
    <button class="editb" data-act="editbtn" aria-label="Edit"><svg width="17" height="17"><use href="#i-edit"/></svg></button>
  </div></li>`;
}
function schedStepRow(s){
  const p=projectOf(s);
  return `<li><div class="item reminder ${s.done?'done':''}" data-id="${s.id}">
    <div class="box" data-act="stepcheck"><svg><use href="#i-check"/></svg></div>
    <div class="lab"><span class="txt" data-act="editstep">${esc(s.text)}</span>
      <span class="sub"><svg class="tiny"><use href="#i-folder"/></svg> ${esc(p?p.title:"Project")}</span></div>
    <button class="editb" data-act="editstep" aria-label="Edit"><svg width="17" height="17"><use href="#i-edit"/></svg></button>
  </div></li>`;
}
function careChip(it){
  return `<span class="carechip tap" data-id="${it.id}" data-act="edititem"><svg><use href="#${it.icon||'i-paw'}"/></svg>${careHTML(it.text)}</span>`;
}
function shiftChip(s){
  const time = s.start ? fmtTime(s.start) : "time TBD";
  const span = s.end ? "–"+fmtTime(s.end) : "";
  const label = s.label ? ' <span class="shiftlabel">'+esc(s.label)+'</span>' : "";
  const rep = s.repeat ? ' <span class="apptrep">weekly</span>' : "";
  return `<span class="carechip shiftchip tap" data-id="${s.id}" data-act="editshift"><svg><use href="#i-clock"/></svg><b>${esc(time)}${esc(span)}</b>${label}${rep}</span>`;
}
function addMini(sec, scope, check){
  return `<button class="addmini" data-act="addtpl" data-sec="${sec}" data-scope="${scope}" data-check="${check?1:0}"><svg><use href="#i-plus"/></svg>Add</button>`;
}
function apptRow(a, iso){
  const done=apptDone(a, iso);
  const rep = a.repeat ? ` <span class="apptrep">weekly</span>` : "";
  return `<li><div class="item ${a.who} ${done?'done':''}" data-id="${a.id}">
    <div class="box" data-act="apptcheck"><svg><use href="#i-check"/></svg></div>
    <div class="lab"><span class="txt" data-act="editappt">${esc(a.title||"Appointment")}</span>
      <span class="sub"><span class="appttime">${fmtTime(a.time)}</span>${rep}</span></div>
    <button class="who ${a.who}" data-act="cycwho">${WHO[a.who]}</button>
    <button class="editb" data-act="editappt" aria-label="Edit"><svg width="17" height="17"><use href="#i-edit"/></svg></button>
  </div></li>`;
}
function comingUpHTML(){
  const list=comingUp();
  if(!list.length) return "";
  return `<div class="comingup"><div class="cuhd"><svg><use href="#i-clock"/></svg>Coming up</div>`+
    list.map(o=>`<div class="curow"><b>${o.when}${o.a.time?" · "+fmtTime(o.a.time):""}</b> ${esc(o.a.title||"Appointment")} <span class="cuwho ${o.a.who}">${WHO[o.a.who]}</span></div>`).join("")+
    `</div>`;
}

function dayProgress(){
  const ids = tplList("clean",selDay).map(x=>x.id)
    .concat(tplList("morning","daily").map(x=>x.id), tplList("night","daily").map(x=>x.id), tplList("each","daily").map(x=>x.id));
  let done=0; ids.forEach(id=>{ if(isChecked(id)) done++; });
  const todos=todosForSel(); const sched=scheduledStepsFor(selDayISO());
  const tdone=todos.filter(t=>t.done).length + sched.filter(s=>s.done).length;
  return { done: done+tdone, total: ids.length+todos.length+sched.length };
}
function refreshProgress(){ const pr=dayProgress(); const el=document.querySelector(".dayhead .prog"); if(el) el.textContent=pr.done+"/"+pr.total+" done"; }

function render(){
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
  const shifts=shiftsForDate(selDayISO());
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

    <div class="card lindsay">
      <div class="ctitle pink"><svg><use href="#i-heart"/></svg>With Lindsay</div>
      <p class="headline tap" data-id="info:${selDay}:headline" data-act="edititem">${esc(infoText(selDay,"headline"))}</p>
      <div class="shiftrow">
        <div class="lbl">Shifts</div>
        <div class="carechips">
          ${shifts.map(shiftChip).join("")}
          <button class="carechip add" data-act="addshift"><svg><use href="#i-plus"/></svg>Add shift</button>
        </div>
      </div>
      <div class="metarow">
        <div class="meta tap" data-id="info:${selDay}:energy" data-act="edititem"><div class="lbl">Energy</div><div class="val">${esc(infoText(selDay,"energy"))}</div></div>
        <div class="meta tap" data-id="info:${selDay}:furniture" data-act="edititem"><div class="lbl">Furniture</div><div class="val">${esc(infoText(selDay,"furniture"))}</div></div>
      </div>
      <div class="carechips">
        ${care.map(careChip).join("")}
        <button class="carechip add" data-act="addcare" data-scope="${selDay}"><svg><use href="#i-plus"/></svg>Add</button>
      </div>
    </div>

    <div class="card">
      <div class="ctitle"><svg><use href="#i-tool"/></svg>To-dos</div>
      <ul class="items">${todoInner}</ul>
      <div class="addrow">
        <input type="text" id="newText" placeholder="Add a to-do for ${DAY_SHORT[selDay]}…" autocomplete="off" />
        <button class="who cyc ${pendWho}" id="whoCyc" title="Tap to change person">${WHO[pendWho]}</button>
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
  const secs=[["both","Both of Us"],["ben","Ben"],["lindsay","Lindsay"]].map(function(g){
    const w=g[0], label=g[1];
    const mine=all.filter(t=>(t.who||"both")===w);
    if(!mine.length) return "";
    const open=mine.filter(t=>!t.done).length;
    const byArea=AREA_ORDER.map(a=>{
      const rows=mine.filter(t=>(t.area||"other")===a);
      if(!rows.length) return "";
      return `<div class="grp">${esc(AREAS[a])}</div><ul class="items">${rows.map(todoRow).join("")}</ul>`;
    }).join("");
    return `<div class="card"><div class="ctitle ${w==="lindsay"?"pink":""}"><svg><use href="#i-list"/></svg>${label} · ${open} to do</div>${byArea}</div>`;
  }).join("");
  const empty=`<div class="emptybig"><svg width="34" height="34"><use href="#i-list"/></svg><p>The master list is empty.<br>Type above, say it to Siri, or import a dump — it sorts itself.</p></div>`;
  document.getElementById("listBody").innerHTML = `
    <div class="card">
      <div class="addrow" style="margin-top:0;padding-top:0;border-top:0">
        <input type="text" id="listNewText" placeholder="Dump a task — it sorts itself…" autocomplete="off" />
        <button class="add" id="listAddBtn" aria-label="Add"><svg width="22" height="22"><use href="#i-plus"/></svg></button>
      </div>
      <div class="pmeta" style="margin-top:8px">Sorted by who, then area — tap a tag to fix a guess. Say "on Thursday" to send it straight to a day.</div>
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

function renderProjects(){
  const projs=projectsAll();
  let html = projs.map(p=>{
    const steps=stepsFor(p.id);
    const done=steps.filter(s=>s.done).length;
    const pct = steps.length ? Math.round(done/steps.length*100) : 0;
    return `<div class="proj" data-id="${p.id}">
      <div class="projhd">
        <span class="ptitle" data-act="editproj">${esc(p.title||"Untitled project")}</span>
        <button class="who ${p.who}" data-act="cycprojwho">${WHO[p.who]}</button>
        <button class="editb" data-act="editproj" aria-label="Edit"><svg width="17" height="17"><use href="#i-edit"/></svg></button>
      </div>
      <div class="pbar"><span style="width:${pct}%"></span></div>
      <div class="pmeta">${done}/${steps.length} done</div>
      <ul class="items">${steps.map(stepRow).join("")||'<li class="emptyhint">No steps yet.</li>'}</ul>
      <button class="addmini left" data-act="addstep" data-pid="${p.id}"><svg><use href="#i-plus"/></svg>Add step</button>
    </div>`;
  }).join("");
  if(!projs.length) html = `<div class="emptybig"><svg width="34" height="34"><use href="#i-folder"/></svg><p>No projects yet.<br>Add one to track a multi-step job like the stairs.</p></div>`;
  html += `<button class="bigadd" data-act="addproj"><svg width="18" height="18"><use href="#i-plus"/></svg> New project</button>`;
  document.getElementById("projectsBody").innerHTML = html;
}
function stepRow(s){
  const sched = s.schedISO ? `<span class="sub"><svg class="tiny"><use href="#i-clock"/></svg> ${fmtDateShort(stepEffectiveISO(s))}${(!s.done&&s.schedISO<todayISO())?" (rolled to today)":""}</span>` : "";
  return `<li><div class="item ${s.done?'done':''}" data-id="${s.id}">
    <div class="box" data-act="stepcheck"><svg><use href="#i-check"/></svg></div>
    <div class="lab"><span class="txt" data-act="editstep">${esc(s.text)}</span>${sched}</div>
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
  if(!notes.length) html = `<div class="emptybig"><svg width="34" height="34"><use href="#i-note"/></svg><p>No notes yet.<br>Leave one for ${me==="ben"?"Lindsay":(me==="lindsay"?"Ben":"each other")}.</p></div>`;
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
  const wc=document.getElementById("whoCyc");
  if(wc) wc.onclick=()=>{ pendWho=WHO_ORDER[(WHO_ORDER.indexOf(pendWho)+1)%WHO_ORDER.length]; wc.className="who cyc "+pendWho; wc.textContent=WHO[pendWho]; };
}

/* ===================== printable week (blank planner) ============= */
function pItem(text, who){
  const both = who==="both";
  const w = (who==="ben"||who==="lindsay") ? `<span class="pwho">${WHO[who]}</span>` : "";
  return `<div class="pitem"><span class="pbox"></span><span class="${both?'pboth':''}">${esc(text)}</span> ${w}</div>`;
}
function printWeekHTML(){
  let h = `<h1>Our Week</h1><div class="prange">${esc(fmtRange())}</div>`;
  for(let i=0;i<7;i++){
    const d=dateForDay(i), iso=isoOf(d), wk=weekKeyOf(d);
    const todos=Object.values(items).filter(t=>t.kind==="todo"&&!t._gone&&t.weekKey===wk&&t.day===i).sort(byOrder);
    const sched=Object.values(items).filter(t=>t.kind==="pstep"&&!t._gone&&t.schedISO&&stepEffectiveISO(t)===iso).sort(byOrder);
    const clean=tplList("clean", i);
    const care=careItems(i);
    const appts=apptsForDate(iso);
    h += `<div class="pday"><div class="pdayname">${DAY_FULL[i]}, ${d.toLocaleDateString("en-US",{month:"long",day:"numeric"})}</div>`;
    const shifts=shiftsForDate(iso);
    h += `<div class="pmeta"><b>Lindsay:</b> ${esc(infoText(i,"headline"))}</div>`;
    if(shifts.length) h += `<div class="pmeta2">Shifts: ${shifts.map(s=>(s.start?fmtTime(s.start):"TBD")+(s.end?"–"+fmtTime(s.end):"")+(s.label?" "+s.label:"")).join(" · ")}</div>`;
    h += `<div class="pmeta2">Energy: ${esc(infoText(i,"energy"))} · Furniture: ${esc(infoText(i,"furniture"))}</div>`;
    if(care.length) h += `<div class="pmeta2">${care.map(c=>esc(c.text)).join(" · ")}</div>`;
    if(appts.length){
      h += `<div class="psec">Appointments</div>`;
      h += appts.map(a=>pItem((a.time?fmtTime(a.time)+" — ":"")+(a.title||"Appointment"), a.who)).join("");
    }
    h += `<div class="psec">To-dos</div>`;
    h += (todos.length||sched.length)
      ? todos.map(t=>pItem(t.text,t.who)).join("") + sched.map(s=>pItem(s.text+" ("+(projectOf(s)?projectOf(s).title:"project")+")","")).join("")
      : `<div class="pline">—</div>`;
    h += `<div class="psec">Cleaning</div>`;
    h += clean.length ? clean.map(c=>pItem(c.text,c.who)).join("") : `<div class="pline">—</div>`;
    h += `</div>`;
  }
  h += `<div class="proutine"><div class="pdayname">Every day</div>`;
  h += `<div class="psec">Every morning</div>` + tplList("morning","daily").map(r=>pItem(r.text,r.who)).join("");
  h += `<div class="psec">Every night</div>` + tplList("night","daily").map(r=>pItem(r.text,r.who)).join("");
  h += `<div class="psec">Each day</div>` + tplList("each","daily").map(r=>pItem(r.text,r.who)).join("");
  h += `<div class="pfoot">Bold = needs both Ben &amp; Lindsay.</div></div>`;
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
    if(act==="addshift"){ addShift(); return; }
    const row=el.closest("[data-id]"); if(!row) return;
    const id=row.dataset.id;
    if(act==="tplcheck"){ toggleTpl(id); row.classList.toggle("done"); refreshProgress(); }
    else if(act==="todocheck"){ toggleTodo(id); row.classList.toggle("done"); refreshProgress(); }
    else if(act==="stepcheck"){ toggleStep(id); render(); }
    else if(act==="apptcheck"){ toggleAppt(id, selDayISO()); render(); }
    else if(act==="cycwho"){ cycleWho(id); }
    else if(act==="edititem" || act==="editbtn"){ openEditor(id); }
    else if(act==="editstep" || act==="editappt" || act==="editshift"){ openEditor(id); }
  });

  /* master list delegation */
  document.getElementById("listBody").addEventListener("click", e=>{
    const el=e.target.closest("[data-act]"); if(!el) return;
    const row=el.closest("[data-id]"); if(!row) return;
    const id=row.dataset.id, act=el.dataset.act;
    if(act==="todocheck"){ toggleTodo(id); render(); }
    else if(act==="cycwho"){ cycleWho(id); }
    else if(act==="edititem" || act==="editbtn"){ openEditor(id); }
  });

  /* projects view delegation */
  document.getElementById("projectsBody").addEventListener("click", e=>{
    const el=e.target.closest("[data-act]"); if(!el) return;
    const act=el.dataset.act;
    if(act==="addproj"){ addProject(); return; }
    if(act==="addstep"){ addStep(el.dataset.pid); return; }
    const row=el.closest("[data-id]"); if(!row) return;
    const id=row.dataset.id;
    if(act==="stepcheck"){ toggleStep(id); render(); }
    else if(act==="editstep"){ openEditor(id); }
    else if(act==="editproj"){ openEditor(id); }
    else if(act==="cycprojwho"){ cycleProjWho(id); }
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
  document.getElementById("edWhoBtn").onclick=()=>{ edWho=WHO_ORDER[(WHO_ORDER.indexOf(edWho)+1)%WHO_ORDER.length]; updateEdWho(); };
  document.getElementById("edIconBtn").onclick=()=>{ edIcon=CARE_ICONS[(CARE_ICONS.indexOf(edIcon)+1)%CARE_ICONS.length]; updateEdIcon(); };
  document.getElementById("edDateClear").onclick=()=>{ document.getElementById("edDate").value=""; };
  document.getElementById("edTimeClear").onclick=()=>{ document.getElementById("edTime").value=""; };
  document.getElementById("edEndClear").onclick=()=>{ document.getElementById("edEnd").value=""; };
  document.getElementById("edSplitToggle").onclick=toggleSplit;
  document.getElementById("edSave").onclick=saveEditor;
  document.getElementById("edDelete").onclick=deleteFromEditor;
  document.getElementById("edCancel").onclick=closeEditor;
  document.getElementById("edText").addEventListener("keydown",e=>{ if(e.key==="Enter"&&!splitMode) saveEditor(); });
  document.getElementById("edText2").addEventListener("keydown",e=>{ if(e.key==="Enter") saveEditor(); });

  /* identity pickers */
  function paintIdPick(container, val){
    document.querySelectorAll(container+" [data-id]").forEach(b=> b.classList.toggle("on", b.dataset.id===val));
  }
  document.getElementById("welcomeId").addEventListener("click", e=>{
    const b=e.target.closest("[data-id]"); if(!b) return;
    welcomeId=b.dataset.id; paintIdPick("#welcomeId", welcomeId);
  });
  document.getElementById("setIdRow").addEventListener("click", e=>{
    const b=e.target.closest("[data-id]"); if(!b) return;
    me=b.dataset.id; localStorage.setItem("ow-me", me); pendWho=me; paintIdPick("#setIdRow", me);
  });

  /* settings + welcome */
  const overlaySettings=document.getElementById("settings");
  const overlayWelcome=document.getElementById("welcome");
  function openSettings(){
    document.getElementById("setCode").value=household;
    paintIdPick("#setIdRow", me);
    const st=document.getElementById("setStatus");
    const dot='<svg width="10" height="10" viewBox="0 0 10 10"><circle cx="5" cy="5" r="5" fill="currentColor"/></svg>';
    if(CONFIGURED){ st.innerHTML=dot+" Live sync is ON"; st.className="statusline synced"; }
    else { st.innerHTML=dot+" This device only — sync keys not added yet"; st.className="statusline local"; }
    document.getElementById("setMeta").innerHTML=CONFIGURED
      ? "Everyone using this code shares one live plan. Changing the code switches to a different plan."
      : "To sync across phones, add your Firebase keys in <code>app.js</code> — see <code>SETUP-GUIDE.md</code>.";
    overlaySettings.classList.add("show");
  }
  document.getElementById("gear").onclick=openSettings;
  document.getElementById("printBtn").onclick=doPrint;
  document.getElementById("setClose").onclick=()=>overlaySettings.classList.remove("show");
  document.getElementById("setSave").onclick=()=>{
    const v=document.getElementById("setCode").value.trim(); if(!v) return;
    household=v; localStorage.setItem("ow-household",household);
    overlaySettings.classList.remove("show"); connect();
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
    if(!welcomeId){ document.getElementById("welcomeId").classList.add("shake"); setTimeout(()=>document.getElementById("welcomeId").classList.remove("shake"),400); return; }
    household=v; me=welcomeId; pendWho=me;
    localStorage.setItem("ow-household",household); localStorage.setItem("ow-me", me);
    overlayWelcome.classList.remove("show"); connect();
  };

  /* boot */
  if(!household || !me){
    document.getElementById("welcomeCode").value = household || "ben-lindsay-2026-"+Math.random().toString(36).slice(2,6);
    welcomeId = me || "";
    paintIdPick("#welcomeId", welcomeId);
    loadLocal(); seedTodosIfNeeded(); seedTemplateIfNeeded(); migrateRemoveJohny(); render();
    overlayWelcome.classList.add("show");
  } else {
    pendWho=me; connect();
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

  /* projects + scheduled step */
  addProject(); // creates blank; simulate edit
  let proj=projectsAll()[0]; proj.title="Stairs"; proj.who="ben"; put(proj);
  const sid="pstep:test"; items[sid]={id:sid, kind:"pstep", projectId:proj.id, text:"Prime + paint", done:false, schedISO:"2026-06-20", order:0};
  saveLocalSafe();
  console.log("project steps:", stepsFor(proj.id).length, "(1)");
  // scheduled on its date
  console.log("shows on 2026-06-20:", scheduledStepsFor("2026-06-20").length===1);
  // gentle drift: an old undone step shows on today
  items["pstep:old"]={id:"pstep:old", kind:"pstep", projectId:proj.id, text:"Old step", done:false, schedISO:"2000-01-01", order:1};
  console.log("old undone step drifts to today:", scheduledStepsFor(todayISO()).some(s=>s.id==="pstep:old"));
  console.log("old step NOT shown on its past date:", scheduledStepsFor("2000-01-01").length===0);
  // done step stays on its date (history), not today
  items[sid].done=true;
  console.log("done step stays on date:", scheduledStepsFor("2026-06-20").length===1);
  // week-view progress includes scheduled steps
  selDay=5; currentMonday=mondayOf(new Date("2026-06-16T00:00:00")); // Sat 2026-06-20
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
  console.log("OK");
}
function saveLocalSafe(){ try{ saveLocal(); }catch(e){} }
