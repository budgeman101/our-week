// Our Kitchen — vision broker Worker (Cloudflare), with a family guest pass.
// Holds the Anthropic API key as a secret and does several jobs over one endpoint:
//   1) Receipt scan      — POST { household, image:<base64>, mediaType }        -> JSON array of items
//   2) Recipe import     — POST { household, mode:"recipe", url:"https://…" }   -> JSON recipe object
//                          POST { household, mode:"recipe", image, mediaType }  (cookbook photo)
//   3) "What's for dinner"— POST { household, mode:"suggest", pantry:[…] }      -> JSON array of ideas
//   4) Handwritten list  — POST { household, mode:"list", image, mediaType }    -> JSON array of items
//
// THE GUEST PASS: every request carries the sender's household code. Only codes
// listed in the HOUSEHOLDS setting are served, each with a monthly allowance;
// everyone else is politely refused, so a leaked URL can't spend the key.
//
// Cloudflare settings (Worker → Settings → Variables and Secrets):
//   ANTHROPIC_API_KEY  (Secret)  — the sk-ant-… key. Never in code.
//   HOUSEHOLDS         (Secret)  — who may use AI + monthly allowance, e.g.
//                                  "my-code=200, their-code=30"
//                                  (a code with no =number gets 30)
// KV binding (Worker → Settings → Bindings → KV namespace):
//   USAGE — the monthly counters. Without it, allowances aren't counted
//           (listed households get unlimited); the allowlist still applies.
//
// Successful responses carry an "x-uses-left" header so the app can warn
// when a family is running low. Counters reset on the 1st (UTC).

const MODEL = "claude-haiku-4-5-20251001"; // ~1/3 the cost; small accuracy tradeoff on messy receipts/pages. For best accuracy, switch back to "claude-sonnet-4-6".
const DEFAULT_LIMIT = 30;

const CATS = ["produce","dairy","meat","bakery","frozen","pantry","beverages","snacks","household","other"];
const UNITS = ["each","g","kg","ml","L","pack","bag","box","can","bottle","bunch","dozen"];
const SLOTS = ["breakfast","lunch","dinner","snack"];

const RECEIPT_PROMPT = `You are reading a photo of a grocery store receipt. Extract ONLY the purchased food and household line items.

Ignore everything that is not a product: subtotal, tax, total, change, tender, savings, loyalty/points, card numbers, dates, cashier, and the store name / address / phone.

Rules:
- De-abbreviate cryptic names into normal ones. e.g. "GV MLK 2%" -> "Milk 2%", "ORG BROCC" -> "Broccoli", "BNLS CHK BRST" -> "Chicken breast".
- For weight-priced lines like "0.84 kg @ $3.99/kg" use the weight as qty and the matching unit (kg), NOT the price-per-kg.
- price = the line total in dollars for that item (use 0 if you can't tell).
- cat must be exactly one of: ${CATS.join(", ")}.
- unit must be exactly one of: ${UNITS.join(", ")}.
- perishable = true for fresh produce, dairy, meat/seafood, and bakery; false otherwise.

Return ONLY a JSON array, no prose and no code fences. Each element:
{"name": string, "qty": number, "unit": string, "price": number, "cat": string, "perishable": boolean}`;

const RECIPE_PROMPT = `You are extracting ONE recipe — either from the text of a web page or from a photo of a cookbook / recipe card.

Return ONLY a JSON object, no prose and no code fences:
{"name": string, "slot": string, "ingredients": [{"name": string, "qty": number, "unit": string, "cat": string}], "steps": [string]}

Rules:
- name: the dish's name (e.g. "Spaghetti bolognese").
- slot: the meal it best fits, exactly one of: ${SLOTS.join(", ")}. If unsure, use "dinner".
- ingredients: one entry per ingredient.
  - name: the plain food name only — NO amounts, prep words or descriptors. e.g. "onion" not "1 large onion, finely chopped"; "olive oil" not "extra-virgin olive oil for drizzling".
  - qty: a number for the amount. Convert fractions to decimals (½ -> 0.5). If no amount is given, use 1.
  - unit: exactly one of: ${UNITS.join(", ")}. Use "each" for whole/countable items (onions, eggs, cloves) and whenever no listed unit fits. For units NOT in the list (cup, tbsp, tsp, oz, lb), convert to a listed metric unit where reasonable (liquid by volume -> ml, dry weight -> g); otherwise use "each".
  - cat: exactly one of: ${CATS.join(", ")}.
- steps: the method as an ordered array of short instruction strings. Use an empty array [] if no method is given.
- Ignore ads, comments, nutrition tables, story/blog text, related-recipe links and other page chrome. If several recipes appear, pick the main one.`;

const LIST_PROMPT = `You are reading a photo of a handwritten (or typed) grocery shopping list. Extract every item the person wants to buy.

Rules:
- One entry per item. Read messy handwriting as best you can; if a word is genuinely illegible, skip it rather than guess wildly.
- Tidy each item into a normal product name. e.g. "2 doz eggs" -> name "Eggs"; "milk x2" -> name "Milk"; "bananas" -> name "Banana". Drop leading bullet characters, dashes, checkboxes and crossed-out lines (ignore anything struck through).
- qty: the amount written for that item (convert fractions to decimals, ½ -> 0.5). If no amount is written, use 1.
- unit: exactly one of: ${UNITS.join(", ")}. Use "each" for whole/countable items and whenever no written unit fits. Convert units NOT in the list (cup, tbsp, tsp, oz, lb, loaf, head, dozen-of-something) to the closest listed unit where reasonable; use "dozen" only when the list literally says a dozen.
- price = 0 always (shopping lists have no prices).
- cat must be exactly one of: ${CATS.join(", ")}. Pick the aisle the item normally lives in.
- perishable = true for fresh produce, dairy, meat/seafood, and bakery; false otherwise.
- Ignore headings, dates, store names, notes-to-self and anything that isn't a thing to buy.

Return ONLY a JSON array, no prose and no code fences. Each element:
{"name": string, "qty": number, "unit": string, "price": number, "cat": string, "perishable": boolean}`;

const SUGGEST_PROMPT = `You are a helpful, practical home cook. Using the pantry stock provided, suggest meals the user could realistically make right now. It's fine to assume they have basic staples (salt, pepper, oil, water).

Favour ideas that use what they already have — ESPECIALLY items flagged "EXPIRING NOW" or "use within Nd" (use these up first to avoid food waste), then items flagged "low". Avoid anything in the "recently eaten" list. Honour the dietary preferences if any are given.

Return ONLY a JSON array (no prose, no code fences) of 4 to 6 ideas. Each element:
{"name": string, "slot": string, "note": string, "ingredients": [{"name": string, "qty": number, "unit": string, "cat": string, "have": boolean}], "steps": [string]}

Rules:
- name: the dish's name.
- slot: exactly one of: ${SLOTS.join(", ")}. Default "dinner".
- note: one short line on why it's a good pick (e.g. "Uses up your spinach and eggs"). Keep it under ~12 words.
- ingredients.name: the plain food name only — no amounts, prep words or descriptors.
- qty: a number (convert fractions to decimals; default 1). unit: exactly one of: ${UNITS.join(", ")} (use "each" when unsure). cat: exactly one of: ${CATS.join(", ")}.
- have: true if that item is in the pantry stock provided, false if they'd need to buy it.
- steps: 2 to 6 short instruction strings.
- Prefer ideas where most ingredients are already in the pantry. Don't suggest a meal that needs many things they don't have.`;

/* ------------------------- the guest pass -------------------------- */
// "code=200, other-code=30" -> { "code":200, "other-code":30 }
function parseFamilies(env) {
  const out = {};
  String(env.HOUSEHOLDS || "").split(",").forEach((part) => {
    const [code, lim] = part.split("=").map((s) => (s || "").trim());
    if (code) out[code] = Math.max(1, Number(lim) || DEFAULT_LIMIT);
  });
  return out;
}
function monthKey(hh) {
  const d = new Date();
  return `use:${hh}:${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
// Returns { limit, used } when allowed, or { block: Response } when not.
async function checkPass(env, hh, cors) {
  const families = parseFamilies(env);
  if (!Object.keys(families).length)
    return { block: json({ error: "The Worker is missing its HOUSEHOLDS setting — see AI-GUEST-PASS.md in the repo." }, 403, cors) };
  if (!hh || !families[hh])
    return { block: json({ error: "This household isn't set up for AI scanning yet — ask Ben to add your code." }, 403, cors) };
  const limit = families[hh];
  let used = 0;
  if (env.USAGE) used = Number(await env.USAGE.get(monthKey(hh))) || 0;
  if (used >= limit)
    return { block: json({ error: `This month's ${limit} AI scans are used up. They run on a small paid service that Ben covers — if you need more this month, just ask him. A fresh allowance starts on the 1st.` }, 429, cors) };
  return { limit, used };
}
// Successful AI work counts against the month; failures don't.
async function countUse(env, hh, pass, res) {
  if (!env.USAGE || res.status !== 200) return res;
  const used = pass.used + 1;
  // ~40 days: old months clean themselves up
  await env.USAGE.put(monthKey(hh), String(used), { expirationTtl: 60 * 60 * 24 * 40 }).catch(() => {});
  const h = new Headers(res.headers);
  h.set("x-uses-left", String(Math.max(0, pass.limit - used)));
  return new Response(res.body, { status: res.status, headers: h });
}

export default {
  async fetch(request, env) {
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Expose-Headers": "x-uses-left",
    };
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });
    if (request.method !== "POST") return json({ error: "POST only" }, 405, cors);
    if (!env.ANTHROPIC_API_KEY) return json({ error: "Worker missing ANTHROPIC_API_KEY secret" }, 500, cors);

    try {
      const body = (await request.json()) || {};
      const hh = String(body.household || "").trim();
      const pass = await checkPass(env, hh, cors);
      if (pass.block) return pass.block;

      let res;
      if (body.mode === "recipe") res = await handleRecipe(body, env, cors);
      else if (body.mode === "suggest") res = await handleSuggest(body, env, cors);
      else if (body.mode === "list") res = await handleList(body, env, cors);
      else res = await handleReceipt(body, env, cors);
      return await countUse(env, hh, pass, res);
    } catch (e) {
      return json({ error: String(e) }, 500, cors);
    }
  },
};

/* ---------- receipt scan (unchanged behaviour) ---------- */
async function handleReceipt(body, env, cors) {
  const { image, mediaType } = body;
  if (!image) return json({ error: "no image provided" }, 400, cors);

  const res = await callClaude(env, [
    { type: "image", source: { type: "base64", media_type: mediaType || "image/jpeg", data: image } },
    { type: "text", text: RECEIPT_PROMPT },
  ], 2000);
  if (res.error) return json(res.error, res.status, cors);

  let items = parseArray(res.text);
  // Clamp to known categories/units so the app never gets a surprise value.
  items = items.map((it) => ({
    name: String((it && it.name) || "").trim(),
    qty: Number(it && it.qty) > 0 ? Number(it.qty) : 1,
    unit: UNITS.includes(it && it.unit) ? it.unit : "each",
    price: Number(it && it.price) || 0,
    cat: CATS.includes(it && it.cat) ? it.cat : "other",
    perishable: !!(it && it.perishable),
  })).filter((it) => it.name);

  return json(items, 200, cors);
}

/* ---------- handwritten / typed shopping list (photo) ---------- */
async function handleList(body, env, cors) {
  const { image, mediaType } = body;
  if (!image) return json({ error: "no image provided" }, 400, cors);

  const res = await callClaude(env, [
    { type: "image", source: { type: "base64", media_type: mediaType || "image/jpeg", data: image } },
    { type: "text", text: LIST_PROMPT },
  ], 2000);
  if (res.error) return json(res.error, res.status, cors);

  // Same shape as a receipt so the app's review screen can reuse it. Price is
  // forced to 0 — a shopping list has no prices to log.
  let items = parseArray(res.text);
  items = items.map((it) => ({
    name: String((it && it.name) || "").trim(),
    qty: Number(it && it.qty) > 0 ? Number(it.qty) : 1,
    unit: UNITS.includes(it && it.unit) ? it.unit : "each",
    price: 0,
    cat: CATS.includes(it && it.cat) ? it.cat : "other",
    perishable: !!(it && it.perishable),
  })).filter((it) => it.name);

  return json(items, 200, cors);
}

/* ---------- recipe import (link or photo) ---------- */
async function handleRecipe(body, env, cors) {
  let content;

  if (body.url) {
    let u;
    try { u = new URL(String(body.url)); } catch (_) { return json({ error: "That doesn't look like a valid link" }, 400, cors); }
    if (u.protocol !== "http:" && u.protocol !== "https:") return json({ error: "Link must start with http(s)" }, 400, cors);

    let html;
    try {
      const pr = await fetch(u.toString(), {
        headers: {
          "user-agent": "Mozilla/5.0 (compatible; OurKitchenBot/1.0; +recipe-import)",
          "accept": "text/html,application/xhtml+xml",
        },
        redirect: "follow",
      });
      if (!pr.ok) return json({ error: "Couldn't open that page (" + pr.status + ")" }, 502, cors);
      html = await pr.text();
    } catch (e) {
      return json({ error: "Couldn't reach that page" }, 502, cors);
    }

    const pageText = htmlToText(html);
    if (!pageText.trim()) return json({ error: "That page had no readable text" }, 422, cors);
    content = [{ type: "text", text: RECIPE_PROMPT + "\n\nRecipe page content follows:\n\n" + pageText }];

  } else if (body.image) {
    content = [
      { type: "image", source: { type: "base64", media_type: body.mediaType || "image/jpeg", data: body.image } },
      { type: "text", text: RECIPE_PROMPT },
    ];

  } else {
    return json({ error: "Provide a recipe url or an image" }, 400, cors);
  }

  const res = await callClaude(env, content, 4000);
  if (res.error) return json(res.error, res.status, cors);
  return json(clampRecipe(parseObject(res.text)), 200, cors);
}

/* ---------- "what's for dinner?" suggester ---------- */
async function handleSuggest(body, env, cors) {
  const pantry = Array.isArray(body.pantry) ? body.pantry : [];
  if (!pantry.length) return json({ error: "Your pantry is empty — add a few things first" }, 400, cors);

  const lines = pantry.slice(0, 250).map((p) => {
    const nm = String((p && p.name) || "").trim();
    if (!nm) return null;
    const qty = (p && p.qty != null && p.qty !== "") ? p.qty : "";
    const unit = (p && p.unit) || "each";
    const amt = qty !== "" ? ": " + qty + (unit === "each" ? "" : " " + unit) : "";
    const flags = [];
    const e = p && p.expires;
    if (typeof e === "number") {
      if (e <= 0) flags.push("EXPIRING NOW");
      else if (e <= 3) flags.push("use within " + e + "d");
    }
    if (p && p.low) flags.push("low");
    const tag = flags.length ? " (" + flags.join(", ") + ")" : "";
    return "- " + nm + amt + tag;
  }).filter(Boolean).join("\n");

  const recent = Array.isArray(body.recent)
    ? body.recent.filter((x) => typeof x === "string" && x.trim()).slice(0, 40).join(", ")
    : "";
  const prefs = (typeof body.prefs === "string" ? body.prefs : "").trim().slice(0, 400);

  let text = SUGGEST_PROMPT + "\n\nPANTRY STOCK:\n" + lines;
  if (recent) text += "\n\nRECENTLY EATEN (don't repeat these): " + recent;
  if (prefs) text += "\n\nDIETARY PREFERENCES: " + prefs;

  const res = await callClaude(env, [{ type: "text", text }], 3000);
  if (res.error) return json(res.error, res.status, cors);
  return json(clampSuggestions(parseArray(res.text)), 200, cors);
}

// Reuse the recipe clamp, then re-attach the per-ingredient "have" hint + the note.
function clampSuggestions(arr) {
  arr = Array.isArray(arr) ? arr : [];
  return arr.map((s) => {
    const r = clampRecipe(s);
    const src = Array.isArray(s && s.ingredients) ? s.ingredients : [];
    r.ingredients = r.ingredients.map((g) => {
      const hit = src.find((x) => String((x && x.name) || "").trim() === g.name);
      return { ...g, have: !!(hit && hit.have) };
    });
    r.note = String((s && s.note) || "").trim().slice(0, 140);
    return r;
  }).filter((r) => r.name && r.ingredients.length).slice(0, 8);
}

/* ---------- Anthropic call ---------- */
// Returns { text } on success, or { error, status } to forward to the client.
async function callClaude(env, content, maxTokens) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens || 2000,
      messages: [{ role: "user", content }],
    }),
  });

  if (!r.ok) {
    const detail = (await r.text().catch(() => "")).slice(0, 300);
    return { error: { error: "anthropic " + r.status, detail }, status: 502 };
  }
  const data = await r.json();
  const text = (data.content && data.content[0] && data.content[0].text) || "";
  return { text };
}

/* ---------- parsing helpers ---------- */
function stripFences(t) {
  return String(t || "").trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
}
function parseArray(t) {
  t = stripFences(t);
  const s = t.indexOf("["), e = t.lastIndexOf("]");
  if (s !== -1 && e !== -1) t = t.slice(s, e + 1);
  try { const a = JSON.parse(t); return Array.isArray(a) ? a : []; } catch (_) { return []; }
}
function parseObject(t) {
  t = stripFences(t);
  const s = t.indexOf("{"), e = t.lastIndexOf("}");
  if (s !== -1 && e !== -1) t = t.slice(s, e + 1);
  try { const o = JSON.parse(t); return o && typeof o === "object" ? o : {}; } catch (_) { return {}; }
}

// Clamp the model's recipe object to shapes the app expects.
function clampRecipe(obj) {
  obj = obj || {};
  let ings = Array.isArray(obj.ingredients) ? obj.ingredients : [];
  ings = ings.map((g) => ({
    name: String((g && g.name) || "").trim(),
    qty: Number(g && g.qty) > 0 ? Number(g.qty) : 1,
    unit: UNITS.includes(g && g.unit) ? g.unit : "each",
    cat: CATS.includes(g && g.cat) ? g.cat : "other",
  })).filter((g) => g.name).slice(0, 80);

  const steps = (Array.isArray(obj.steps) ? obj.steps : [])
    .map((s) => String(s || "").trim()).filter(Boolean).slice(0, 50);

  return {
    name: String(obj.name || "").trim(),
    slot: SLOTS.includes(obj.slot) ? obj.slot : "dinner",
    ingredients: ings,
    steps,
  };
}

// Turn a fetched HTML page into compact text for the model. Keeps any
// schema.org JSON-LD blocks (recipe pages usually embed the full recipe there),
// strips scripts/styles/tags, decodes the common entities, and trims length.
function htmlToText(html) {
  html = String(html || "");

  let ld = "";
  const ldRe = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = ldRe.exec(html))) ld += "\n" + m[1];

  const body = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/(p|div|li|tr|h[1-6]|section|article|br)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#0?39;|&apos;|&rsquo;|&lsquo;/gi, "'")
    .replace(/&quot;|&ldquo;|&rdquo;/gi, '"')
    .replace(/&frac12;/gi, "0.5")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/[ \t\f\r]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  let out = "";
  if (ld.trim()) out += "STRUCTURED DATA (JSON-LD):\n" + ld.trim() + "\n\n";
  out += "PAGE TEXT:\n" + body;
  return out.slice(0, 16000);
}

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json", ...cors },
  });
}
