/* ============================================================
   FoodPet — a gentle metabolic-health companion
   No accounts, no backend. Everything lives in localStorage.
   ============================================================ */
(() => {
'use strict';

/* ---------------- meal schedule ---------------- */
const MEAL_DEFS = [
  { id:'breakfast',   name:'Breakfast',            h:7,  m:0  },
  { id:'midmorning',  name:'Mid-Morning Fuel',     h:10, m:0  },
  { id:'lunch',       name:'Lunch',                h:12, m:30 },
  { id:'preworkout',  name:'Pre-Workout Spark',    h:15, m:0  },
  { id:'postworkout', name:'Post-Workout Recovery',h:16, m:15 },
  { id:'dinner',      name:'Dinner',               h:18, m:30 },
];
// The live schedule: defaults unless Settings overrides a time. Kept sorted, so
// "next up" and the weekly grid follow the clock rather than the original order.
let MEALS = MEAL_DEFS.map(m => ({ ...m }));
function applyTimes(){
  MEALS = MEAL_DEFS.map(d => {
    const t = (S.times || {})[d.id];
    if (!t) return { ...d };
    const [h, m] = t.split(':').map(Number);
    return Number.isFinite(h) && Number.isFinite(m) ? { ...d, h, m } : { ...d };
  }).sort((a, b) => (a.h*60 + a.m) - (b.h*60 + b.m));
}
const hhmm = meal => `${pad(meal.h)}:${pad(meal.m)}`;
const RECIPES = window.FOODPET_RECIPES;
const POINTS_PER_MEAL = 10;
const PERFECT_BONUS = 20;
const NO_REPEAT_DAYS = 6;      // a slot won't repeat an idea within this many picks
const DUE_WINDOW_MIN = 120;    // how long a meal counts as "now" after its time
const PUSH_GRACE_MIN = 12;     // with background reminders on, wait this long for the
                               // push before the app announces a meal itself
const NOTIFY_WINDOW_MIN = 90;  // how long after a meal time a reminder may still fire.
                               // Phones suspend the page, so a tick can easily land
                               // 20+ minutes late; 15 minutes silently missed most of them.
const APP_VERSION = 'v7.4 — hats that fit';

/* ---------------- fuel: targets and portions ---------------- */
// How the day's energy is split across the six slots.
const SLOT_SHARE = {
  breakfast: 0.20, midmorning: 0.10, lunch: 0.25,
  preworkout: 0.10, postworkout: 0.15, dinner: 0.20,
};
const RANGE_SPREAD = 0.15;     // targets are shown as mid +/- 15%, never a single number
const ACTIVITY = [
  { id:'sedentary', label:'Sedentary',         factor:1.2,   hint:'mostly sitting, little planned movement' },
  { id:'light',     label:'Lightly active',    factor:1.4,   hint:'daily home weight training' },
  { id:'moderate',  label:'Moderately active', factor:1.55,  hint:'training most days, on your feet' },
  { id:'very',      label:'Very active',       factor:1.725, hint:'hard training daily, or a physical job' },
];
const PORTIONS = [
  { id:'small', label:'Small',      sub:'lighter than usual', mult:0.70 },
  { id:'right', label:'Just right', sub:'the usual serving',  mult:1.00 },
  { id:'big',   label:'Big',        sub:'a generous plate',   mult:1.35 },
];

/* ---------------- cosmetics ---------------- */
const PALETTES = [
  { id:'mint',   name:'Mint',      cost:0,   body:'#bfe3d4', dark:'#7fb69f', cheek:'#f4b6b6' },
  { id:'peach',  name:'Peach',     cost:50,  body:'#fbd9c9', dark:'#d9a086', cheek:'#ef9f9f' },
  { id:'lilac',  name:'Lilac',     cost:100, body:'#d9c8f2', dark:'#a68ccf', cheek:'#f2a8c4' },
  { id:'lemon',  name:'Lemon',     cost:180, body:'#fbeeb0', dark:'#cfb469', cheek:'#f0a99a' },
  { id:'sky',    name:'Sky',       cost:280, body:'#c3ddf7', dark:'#8bb0d6', cheek:'#f1a9b8' },
  { id:'rose',   name:'Rose Gold', cost:420, body:'#f6c9d4', dark:'#c98fa2', cheek:'#e78ea3' },
  { id:'moss',   name:'Moss',      cost:600, body:'#cfe0a8', dark:'#96ab6d', cheek:'#eda6a0' },
  { id:'cocoa',  name:'Cocoa',     cost:800, body:'#e2c9b0', dark:'#a98a6c', cheek:'#e39a92' },
];
const HATS = [
  { id:'none',   name:'Bare head', emoji:'🚫',  cost:0 },
  { id:'beanie', name:'Beanie',    emoji:'🧢',  cost:60,  a:'#f2a0a0', b:'#d97c7c' },
  { id:'chef',   name:'Chef hat',  emoji:'👨‍🍳', cost:150, a:'#ffffff', b:'#d9d2e4' },
  { id:'crown',  name:'Crown',     emoji:'👑',  cost:320, a:'#ffd869', b:'#d9ac3d' },
  { id:'party',  name:'Party hat', emoji:'🥳',  cost:500, a:'#9fd9f2', b:'#6fb3d6' },
  { id:'flower', name:'Flower',    emoji:'🌸',  cost:700, a:'#f7b8d4', b:'#d98cb0' },
];

/* ---------------- storage ---------------- */
const KEY = 'foodpet.v1';
const blank = () => ({
  profile: null,      // { age, weight, height, sex, activity } — set once, edited on request
  times: {},          // slotId -> 'HH:MM' override from Settings
  showFuel: true,     // calorie ranges and the portion prompt can be switched off
  pushOn: false,      // background reminders via the worker in server/
  pantry: [],         // the things you usually buy, from FOODPET_INGREDIENTS
  points: 0,
  streak: 0,
  lastStreakDay: null,
  history: {},        // 'YYYY-MM-DD' -> { slotId: { t: isoTimestamp, kcal: number|null } }
  picks: {},          // 'YYYY-MM-DD' -> { slotId: recipeId }
  recent: {},         // slotId -> [recipeId, …] most recent first
  perfectDays: [],    // ['YYYY-MM-DD', …]
  notified: {},       // 'YYYY-MM-DD' -> [slotId, …]
  owned: ['mint','none'],
  wearing: { palette:'mint', hat:'none' },
  soundOn: true,
});
let S = load();

function load(){
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return blank();
    return Object.assign(blank(), JSON.parse(raw));
  } catch { return blank(); }
}
function save(){
  try { localStorage.setItem(KEY, JSON.stringify(S)); } catch {}
}

/* ---------------- dates ---------------- */
const pad = n => String(n).padStart(2,'0');
const dayKey = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const today = () => dayKey(new Date());
function mealDate(meal, base = new Date()){
  const d = new Date(base);
  d.setHours(meal.h, meal.m, 0, 0);
  return d;
}
function clockLabel(meal){
  const d = mealDate(meal);
  return d.toLocaleTimeString([], { hour:'numeric', minute:'2-digit' });
}
function dayLabel(key){
  const [y,mo,da] = key.split('-').map(Number);
  const d = new Date(y, mo-1, da);
  if (key === today()) return 'Today';
  return d.toLocaleDateString([], { weekday:'short', day:'numeric' });
}

/* ---------------- recipe rotation ---------------- */
// Deterministic per day+slot so the pick is stable across reloads,
// but filtered against the last NO_REPEAT_DAYS picks so ideas don't repeat.
function seededIndex(str, len){
  let h = 2166136261;
  for (let i = 0; i < str.length; i++){ h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return Math.abs(h) % len;
}
// What this idea needs that isn't on your usual list. An empty shop means no
// opinion at all — nothing is "missing" until you've told FoodPet what you buy.
function missingFor(recipe){
  if (!S.pantry || !S.pantry.length) return [];
  const have = new Set(S.pantry);
  return (recipe.items || []).filter(i => !have.has(i));
}

// Pure so the week ahead can be projected without touching stored state.
//
// What you can actually cook comes first, variety second. Applying the
// no-repeat rule first looked tidier but broke the feature: with a short
// shopping list there may be only one covered idea per slot, and excluding it
// as "recent" pushed the rotation straight back to meals needing a shop.
// So: narrow to the best-covered ideas, then pick the least recently used.
function chooseRecipe(slotId, dateKey, recentIds, salt = ''){
  const all = RECIPES[slotId];

  let pool = all;
  if (S.pantry && S.pantry.length){
    const fewest = Math.min(...all.map(r => missingFor(r).length));
    pool = all.filter(r => missingFor(r).length === fewest);
  }

  const fresh = pool.filter(r => !recentIds.includes(r.id));
  if (fresh.length){
    pool = fresh;
  } else {
    // Everything covered has been seen lately — take whatever was longest ago.
    const oldest = Math.max(...pool.map(r => recentIds.indexOf(r.id)));
    pool = pool.filter(r => recentIds.indexOf(r.id) === oldest);
  }
  return pool[seededIndex(dateKey + slotId + salt, pool.length)];
}

function pickRecipe(slotId, dateKey, salt = ''){
  return chooseRecipe(slotId, dateKey, (S.recent[slotId] || []).slice(0, NO_REPEAT_DAYS), salt);
}

// The coming week, simulated the way ensureDay would actually pick it. Today's
// picks are already fixed, so they're used as-is.
function projectWeek(days = 7){
  const recent = {};
  for (const k of Object.keys(S.recent)) recent[k] = (S.recent[k] || []).slice();
  const out = [];
  const base = new Date();
  for (let i = 0; i < days; i++){
    const d = new Date(base); d.setDate(d.getDate() + i);
    const key = dayKey(d);
    const picks = {};
    for (const meal of MEALS){
      const fixed = (S.picks[key] || {})[meal.id];
      let r;
      if (fixed){
        r = RECIPES[meal.id].find(x => x.id === fixed) || RECIPES[meal.id][0];
      } else {
        r = chooseRecipe(meal.id, key, (recent[meal.id] || []).slice(0, NO_REPEAT_DAYS));
        recent[meal.id] = [r.id, ...(recent[meal.id] || [])].slice(0, 14);
      }
      picks[meal.id] = r;
    }
    out.push({ key, picks });
  }
  return out;
}

// Everything the next week needs that isn't on your list, commonest first.
function shoppingGaps(days = 7){
  const counts = new Map();
  for (const day of projectWeek(days))
    for (const meal of MEALS)
      for (const item of missingFor(day.picks[meal.id]))
        counts.set(item, (counts.get(item) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}
function ensureDay(){
  const key = today();
  if (!S.picks[key]){
    S.picks[key] = {};
    for (const meal of MEALS){
      const r = pickRecipe(meal.id, key);
      S.picks[key][meal.id] = r.id;
      S.recent[meal.id] = [r.id, ...(S.recent[meal.id] || [])].slice(0, 14);
    }
    prune();
    save();
  }
}
function prune(){
  // keep ~60 days of history so localStorage never grows unbounded
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 60);
  const min = dayKey(cutoff);
  for (const store of [S.history, S.picks, S.notified])
    for (const k of Object.keys(store)) if (k < min) delete store[k];
  S.perfectDays = S.perfectDays.filter(k => k >= min);
}
function recipeFor(slotId, dateKey = today()){
  const id = (S.picks[dateKey] || {})[slotId];
  return RECIPES[slotId].find(r => r.id === id) || RECIPES[slotId][0];
}

/* ---------------- fuel maths ---------------- */
// Mifflin-St Jeor. For 'unspecified' we sit between the two constants rather than
// guessing, so the number stays a reasonable estimate either way.
function bmrOf(p){
  const base = 10*p.weight + 6.25*p.height - 5*p.age;
  const offset = p.sex === 'female' ? -161 : p.sex === 'male' ? 5 : -78;
  return Math.round(base + offset);
}
function activityOf(p){ return ACTIVITY.find(a => a.id === p.activity) || ACTIVITY[1]; }
function tdee(){ return S.profile ? Math.round(bmrOf(S.profile) * activityOf(S.profile).factor) : null; }

const to5 = n => Math.round(n/5)*5;
// Targets change only when the profile changes — never recalculated day to day.
function slotTarget(slotId){
  const t = tdee();
  if (!t) return null;
  const mid = t * SLOT_SHARE[slotId];
  return { mid: to5(mid), min: to5(mid * (1 - RANGE_SPREAD)), max: to5(mid * (1 + RANGE_SPREAD)) };
}
function verdict(slotId, kcal){
  const target = slotTarget(slotId);
  if (!target || kcal == null) return null;
  if (kcal < target.min) return 'low';
  if (kcal > target.max) return 'high';
  return 'in';
}
// Deliberately warm and non-judgemental: awareness, never restriction.
function verdictNote(slotId, kcal){
  const meal = MEALS.find(m => m.id === slotId);
  switch (verdict(slotId, kcal)){
    case 'in':   return { icon:'\u2713', text:`Right in range for ${meal.name}. Nicely fuelled.` };
    case 'low':  return { icon:'\u25CB', text:`That might not be much fuel for ${meal.name} — a little more protein or fat would round it out.` };
    case 'high': return { icon:'\u25CF', text:`A bit more than usual for ${meal.name} — no problem at all, just noting it.` };
    default:     return null;
  }
}

/* ---------------- meal state ---------------- */
// 'logged' | 'now' (its time has come, still waiting) | 'past' (gently skipped) | 'later'
// Entries used to be a bare timestamp string; normalise either shape.
function entryOf(v){ return (v == null || typeof v === 'object') ? v : { t:v, kcal:null }; }
function logOf(dateKey){ return S.history[dateKey] || {}; }
function kcalOf(dateKey, slotId){ const e = entryOf(logOf(dateKey)[slotId]); return e ? e.kcal : null; }
function dayKcal(dateKey){
  return MEALS.reduce((sum, m) => sum + (kcalOf(dateKey, m.id) || 0), 0);
}

function mealState(meal, now = new Date()){
  const log = S.history[today()] || {};
  if (log[meal.id]) return 'logged';
  const t = mealDate(meal, now);
  const mins = (now - t) / 60000;
  if (mins < 0) return 'later';
  if (mins <= DUE_WINDOW_MIN) return 'now';
  return 'past';
}
function loggedToday(){ return Object.keys(S.history[today()] || {}).length; }
function currentMeal(now = new Date()){
  // the one that is due right now, else the next one coming up, else tomorrow's breakfast
  const due = MEALS.filter(m => mealState(m, now) === 'now');
  if (due.length) return { meal: due[due.length-1], tense:'now' };
  const next = MEALS.find(m => mealDate(m, now) > now);
  if (next) return { meal: next, tense:'later' };
  const skipped = MEALS.filter(m => mealState(m, now) === 'past');
  if (skipped.length) return { meal: skipped[skipped.length-1], tense:'past' };
  return { meal: MEALS[0], tense:'tomorrow' };
}

/* ---------------- logging ---------------- */
function logMeal(slotId, kcal = null){
  const key = today();
  S.history[key] = S.history[key] || {};
  if (S.history[key][slotId]) return;
  S.history[key][slotId] = { t: new Date().toISOString(), kcal };

  // Full points either way. Portion size is information, never a score.
  S.points += POINTS_PER_MEAL;
  floatPoints('+' + POINTS_PER_MEAL);

  // streak counts days with at least one logged meal, consecutive
  if (S.lastStreakDay !== key){
    const y = new Date(); y.setDate(y.getDate()-1);
    S.streak = (S.lastStreakDay === dayKey(y)) ? S.streak + 1 : 1;
    S.lastStreakDay = key;
  }
  // perfect day bonus
  if (Object.keys(S.history[key]).length === MEALS.length && !S.perfectDays.includes(key)){
    S.perfectDays.push(key);
    S.points += PERFECT_BONUS;
    setTimeout(() => floatPoints('Perfect day! +' + PERFECT_BONUS), 700);
    jingle('perfect');
  } else {
    jingle('eat');
  }
  save();
  pet.eat();

  // A short, gentle reaction to how much fuel that was.
  const note = verdictNote(slotId, kcal);
  if (note){
    showNote(note);
    const v = verdict(slotId, kcal);
    if (v === 'low')  pet.tempMood('tired', 6000);   // "still hungry", never sad
    if (v === 'high') pet.tempMood('happy', 6000);   // pleasantly full
  } else {
    hideNote();                                      // don't leave the last meal's note up
  }
  renderAll();
}

// The estimate sheet: tap a portion, or type a number if you know it.
function startLog(slotId){
  unlockAudio();
  if (!S.profile || !S.showFuel){ logMeal(slotId); return; }  // nothing to compare against

  const meal = MEALS.find(m => m.id === slotId);
  const recipe = recipeFor(slotId);
  const target = slotTarget(slotId);

  openSheet(`How much was that?`, `${meal.name} — ${recipe.name}`, body => {
    const range = document.createElement('p');
    range.className = 'sheet-range';
    range.innerHTML = `Usual range for this slot <strong>${target.min}–${target.max} kcal</strong>`;
    body.appendChild(range);

    const grid = document.createElement('div');
    grid.className = 'portion-grid';
    for (const p of PORTIONS){
      const kcal = to5(recipe.kcal * p.mult);
      const b = document.createElement('button');
      b.className = 'portion';
      b.innerHTML = `<span class="portion-label">${p.label}</span>
        <span class="portion-kcal">~${kcal}</span>
        <span class="portion-sub">${p.sub}</span>`;
      b.onclick = () => { closeSheet(); logMeal(slotId, kcal); };
      grid.appendChild(b);
    }
    body.appendChild(grid);

    const row = document.createElement('div');
    row.className = 'sheet-row';
    row.innerHTML = `<input id="kcal-input" class="field" type="number" inputmode="numeric"
      min="0" max="3000" placeholder="or type kcal">`;
    const go = document.createElement('button');
    go.className = 'btn primary compact';
    go.textContent = 'Log';
    go.onclick = () => {
      const v = parseInt(document.getElementById('kcal-input').value, 10);
      closeSheet();
      logMeal(slotId, Number.isFinite(v) && v > 0 ? v : null);
    };
    row.appendChild(go);
    body.appendChild(row);

    const skip = document.createElement('button');
    skip.className = 'linkbtn wide';
    skip.textContent = 'Just log it — no estimate';
    skip.onclick = () => { closeSheet(); logMeal(slotId, null); };
    body.appendChild(skip);
  });
}

/* ---------------- the sheet ---------------- */
function openSheet(title, sub, build){
  document.getElementById('sheet-title').textContent = title;
  document.getElementById('sheet-sub').textContent = sub || '';
  const body = document.getElementById('sheet-body');
  body.innerHTML = '';
  build(body);
  document.getElementById('sheet-wrap').hidden = false;
}
function closeSheet(){ document.getElementById('sheet-wrap').hidden = true; }

// Profile setup — asked once on first launch, and whenever you tap Edit profile.
function openProfileSheet(firstRun){
  const p = S.profile || { age:'', weight:'', height:'', sex:'female', activity:'light' };
  openSheet(
    firstRun ? 'Hello! A few numbers first' : 'Your profile',
    firstRun
      ? 'This sets a rough daily energy target so FoodPet can show a range per meal. You can skip it and add it later.'
      : 'Targets only recalculate when you change something here.',
    body => {
      body.innerHTML = `
        <div class="field-grid">
          <label class="fieldwrap"><span>Age</span>
            <input class="field" id="f-age" type="number" inputmode="numeric" min="13" max="100" value="${p.age}"></label>
          <label class="fieldwrap"><span>Weight (kg)</span>
            <input class="field" id="f-weight" type="number" inputmode="decimal" min="30" max="250" value="${p.weight}"></label>
          <label class="fieldwrap"><span>Height (cm)</span>
            <input class="field" id="f-height" type="number" inputmode="numeric" min="120" max="220" value="${p.height}"></label>
          <label class="fieldwrap"><span>Sex</span>
            <select class="field" id="f-sex">
              <option value="female">Female</option>
              <option value="male">Male</option>
              <option value="unspecified">Rather not say</option>
            </select></label>
        </div>
        <label class="fieldwrap"><span>Activity</span>
          <select class="field" id="f-activity">
            ${ACTIVITY.map(a => `<option value="${a.id}">${a.label} — ${a.hint}</option>`).join('')}
          </select></label>
        <p class="sheet-note" id="f-preview"></p>`;

      document.getElementById('f-sex').value = p.sex;
      document.getElementById('f-activity').value = p.activity;

      const read = () => ({
        age: +document.getElementById('f-age').value,
        weight: +document.getElementById('f-weight').value,
        height: +document.getElementById('f-height').value,
        sex: document.getElementById('f-sex').value,
        activity: document.getElementById('f-activity').value,
      });
      const preview = () => {
        const d = read();
        const ok = d.age > 0 && d.weight > 0 && d.height > 0;
        document.getElementById('f-preview').textContent = ok
          ? `That works out to about ${Math.round(bmrOf(d) * (ACTIVITY.find(a => a.id === d.activity).factor))} kcal a day.`
          : 'Fill in age, weight and height to see your estimate.';
      };
      body.querySelectorAll('.field').forEach(el => el.addEventListener('input', preview));
      preview();

      const save2 = document.createElement('button');
      save2.className = 'btn primary';
      save2.textContent = firstRun ? 'Start' : 'Save';
      save2.onclick = () => {
        const d = read();
        if (!(d.age > 0 && d.weight > 0 && d.height > 0)){ preview(); return; }
        S.profile = { ...d, updated: new Date().toISOString() };
        save();
        closeSheet();
        renderAll();
      };
      body.appendChild(save2);

      const later = document.createElement('button');
      later.className = 'linkbtn wide';
      later.textContent = firstRun ? 'Maybe later' : 'Cancel';
      later.onclick = closeSheet;
      body.appendChild(later);
    });
}

/* ---------------- pixel pet ---------------- */
const SPRITE = [
  '................',
  '.....DDDDDD.....',
  '...DDBBBBBBDD...',
  '..DBBBBBBBBBBD..',
  '.DBBBBBBBBBBBBD.',
  '.DBBBBBBBBBBBBD.',
  'DBBBBBBBBBBBBBBD',
  'DBBB##BBBB##BBBD',
  'DBBB##BBBB##BBBD',
  'DBBBBBBBBBBBBBBD',
  'DBCCBB@@@@BBCCBD',
  'DBCCBBB@@BBBCCBD',
  '.DBBBBBBBBBBBBD.',
  '..DBBBBBBBBBBD..',
  '...DDBBBBBBDD...',
  '.....DD..DD.....',
];
const COLS = SPRITE[0].length, ROWS = SPRITE.length;
/* Hats are anchored to the head, not floated above it.

   The dome narrows fast — row 1 is only 6 pixels wide (cols 5-10), row 2 is 10
   (3-12), row 3 is 12 (2-13) — so a 12-wide brim placed above the crown hangs
   in mid-air, which is exactly how these used to look. Each hat now carries the
   sprite row its art starts on, and its lowest band is drawn at the width the
   head actually is there, so it sits on the head and covers the outline. */
const HAT_ART = {
  none:   null,
  beanie: { top: 0, rows: [
    '.....aaaaaa.....',   // row 0 — above the dome
    '....aaaaaaaa....',   // row 1 — over the crown, a little overhang, as a beanie does
    '...bbbbbbbbbb...',   // row 2 — turned-up brim, exactly the dome width here
  ]},
  // Outlined, because a white hat on the near-white pet screen read as a
  // floating grey band with nothing above it.
  chef:   { top: -2, rows: [
    '....bbbbbbbb....',
    '...baaaaaaaab...',   // the puff, edged so it reads against a pale background
    '...baaaaaaaab...',
    '....baaaaaab....',   // gathers onto the crown
    '...bbbbbbbbbb...',   // band, flush with the dome
  ]},
  crown:  { top: 0, rows: [
    '.....a.aa.a.....',   // points
    '.....aaaaaa.....',   // sits exactly on the crown row
    '...bbbbbbbbbb...',   // band around the dome
  ]},
  party:  { top: -3, rows: [
    '.......a........',   // a real point — the old one was too blunt to read as a cone
    '......aaa.......',
    '.....aabaa......',
    '....aaaaaaaa....',
    '....aaaaaaaa....',
    '...bbbbbbbbbb...',   // base band, flush with the dome
  ]},
  // Petals with gaps between them, so the pet shows through and it reads as a
  // flower rather than the solid pink square it was.
  flower: { top: 2, rows: [
    '...a.a..........',
    '...aba..........',   // tucked against the side of the dome,
    '...a.a..........',   // where the head is wide enough to hold it
  ]},
};

const pet = (() => {
  const cv = document.getElementById('pet-canvas');
  const cx = cv.getContext('2d');
  const OY = 4;          // rows of headroom above the pet, so tall hats fit
  const OX = 1;          // a column of breathing room either side, so the pet
  const OB = 2;          // never touches the frame, and rows below for bob + shadow
  let PX = 16;           // device pixels per sprite pixel — always a whole number
  let mood = 'ok', baseMood = 'ok', eatUntil = 0, tempUntil = 0, t0 = performance.now();
  let pokeAt = 0, hearts = [], strokes = 0, lastStroke = 0, smileUntil = 0;

  /* Every sprite pixel must occupy a whole number of device pixels, or the
     browser resamples the canvas and the rounding pattern crawls as the pet
     bobs — visible as shimmering pixel edges. So: pick the largest whole
     device-pixel size that fits, size the backing store to exactly that, and
     set the CSS size to match it 1:1. No scaling, nothing to resample. */
  const gridCols = COLS + OX*2, gridRows = ROWS + OY + OB;
  function layout(){
    const dpr = Math.max(1, Math.min(4, Math.round(window.devicePixelRatio || 1)));
    const parent = cv.parentElement;
    const avail = Math.min(236, Math.max(140, (parent ? parent.clientWidth : 236) - 24));
    PX = Math.max(4, Math.floor((avail * dpr) / gridCols));
    cv.width  = PX * gridCols;
    cv.height = PX * gridRows;
    cv.style.width  = (cv.width  / dpr) + 'px';
    cv.style.height = (cv.height / dpr) + 'px';
  }
  layout();
  let relayout;
  window.addEventListener('resize', () => {
    clearTimeout(relayout);
    relayout = setTimeout(layout, 150);
  });

  function palette(){ return PALETTES.find(p => p.id === S.wearing.palette) || PALETTES[0]; }

  function rows(){
    const r = SPRITE.slice();
    const eating = performance.now() < eatUntil;
    const chomp = eating && Math.floor(performance.now()/160) % 2 === 0;
    const smiling = performance.now() < smileUntil;

    // --- eyes --- (the base sprite's are already wide open)
    if (mood === 'tired' || mood === 'sleepy'){          // soft closed lids
      r[7] = 'DBBBBBBBBBBBBBBD';
      r[8] = 'DBBB##BBBB##BBBD';
    }
    // --- mouth ---
    if (chomp){                                          // wide open, mid-bite
      r[10] = 'DBCCBB@@@@BBCCBD';
      r[11] = 'DBCCBB@@@@BBCCBD';
    } else if (mood === 'tired' || mood === 'sleepy'){    // small neutral mouth
      r[10] = 'DBCCBBB@@BBBCCBD';
      r[11] = 'DBCCBBBBBBBBCCBD';
    } else if (mood === 'ok'){                            // content little smile
      r[11] = 'DBCCBBB@@BBBCCBD';
    }
    return r;
  }

  function draw(){
    const p = palette();
    const now = performance.now();
    const eating = now < eatUntil;
    const speed = eating ? 320 : (mood === 'happy' ? 700 : mood === 'tired' ? 1600 : 1100);
    const amp   = eating ? 7 : (mood === 'happy' ? 5 : mood === 'tired' ? 1.5 : 3);
    const bob   = Math.round(Math.sin((now - t0) / speed * Math.PI * 2) * amp);

    cx.clearRect(0,0,cv.width,cv.height);

    // A poke squashes the pet briefly, like a stress ball.
    const sinceP = now - pokeAt;
    const poking = sinceP >= 0 && sinceP < 560;
    if (poking){
      const k = Math.sin((sinceP / 560) * Math.PI);
      const sx = 1 + 0.07 * k, sy = 1 - 0.08 * k;
      cx.save();
      cx.translate(cv.width/2, PX*(ROWS+OY));
      cx.scale(sx, sy);
      cx.translate(-cv.width/2, -PX*(ROWS+OY));
    }

    // shadow
    cx.fillStyle = 'rgba(120,100,150,.12)';
    cx.fillRect(PX*(3+OX), PX*(ROWS-1+OY) + PX, PX*10, PX*0.6);

    const colors = { B:p.body, D:p.dark, C:p.cheek, '#':'#3a3350', '@':'#7d4a54' };
    const body = rows();
    for (let y = 0; y < body.length; y++)
      for (let x = 0; x < body[y].length; x++){
        const c = colors[body[y][x]];
        if (!c) continue;
        cx.fillStyle = c;
        cx.fillRect((x+OX)*PX, (y+OY)*PX + bob, PX, PX);
      }

    // The hat is drawn inside the squash transform, so it stretches with the head
    // while the pet is being petted. Drawn after the restore it sat rigid on a
    // squashing head, which looked like it was hovering.
    const hat = HATS.find(h => h.id === S.wearing.hat);
    const art = HAT_ART[S.wearing.hat];
    if (hat && art){
      for (let y = 0; y < art.rows.length; y++)
        for (let x = 0; x < art.rows[y].length; x++){
          const ch = art.rows[y][x];
          if (ch === '.') continue;
          cx.fillStyle = ch === 'a' ? hat.a : hat.b;
          cx.fillRect((x+OX)*PX, (OY + art.top + y)*PX + bob, PX, PX);
        }
    }

    if (poking) cx.restore();

    // a little snack floating into the mouth
    if (eating){
      const k = 1 - (eatUntil - now) / 1500;
      cx.font = `${Math.round(PX*2.4)}px serif`;
      cx.textAlign = 'center';
      cx.globalAlpha = Math.max(0, 1 - k);
      cx.fillText('\u{1F957}', cv.width/2, PX*(10+OY) + bob - (1-k)*30 + 28);
      cx.globalAlpha = 1;
    }
    // little hearts drifting up from where you touched
    hearts = hearts.filter(h => now - h.born < 1100);
    for (const h of hearts){
      const k = (now - h.born) / 1100;
      cx.globalAlpha = Math.max(0, 1 - k);
      cx.font = `${Math.round(PX*0.9 + h.size)}px serif`;
      cx.textAlign = 'center';
      cx.fillText('💛', h.x + Math.sin(k * 6 + h.seed) * PX*0.7, h.y - k * PX*4.5);
      cx.globalAlpha = 1;
    }

    requestAnimationFrame(draw);
  }
  requestAnimationFrame(draw);

  function apply(m){ if (m !== mood){ mood = m; t0 = performance.now(); } }

  return {
    // Touch is pure affection — no points, nothing to farm, nothing to miss.
    touch(x, y){
      const now = performance.now();
      pokeAt = now;
      // Smile without switching mood: the happy mood bobs much faster, which
      // made petting feel frantic rather than fond.
      smileUntil = now + 2600;
      hearts.push({ x, y, born: now, size: Math.random()*8, seed: Math.random()*6 });
      if (hearts.length > 12) hearts.shift();
      strokes = (now - lastStroke < 1400) ? strokes + 1 : 1;
      lastStroke = now;
      return strokes;
    },
    setMood(m){ baseMood = m; if (performance.now() >= tempUntil) apply(m); },
    // A brief reaction to one meal, which fades back to how the day is going.
    tempMood(m, ms){
      tempUntil = performance.now() + ms;
      apply(m);
      setTimeout(() => { if (performance.now() >= tempUntil) apply(baseMood); }, ms + 50);
    },
    eat(){ eatUntil = performance.now() + 1500; },
  };
})();

const MOOD_LINES = {
  happy:  ['Full and buzzing!', 'Feeling great today.', 'Glucose curve: flat as a pancake.'],
  ok:     ['Doing nicely.', 'Ticking along.', 'Comfy and steady.'],
  tired:  ['A little low on fuel.', 'Running on fumes, gently.', 'Could use a snack whenever.'],
  sleepy: ['Just waking up…', 'Morning. No rush.', 'Quiet start to the day.'],
};
function moodNow(){
  const now = new Date();
  const passed = MEALS.filter(m => mealDate(m, now) <= now);
  if (!passed.length) return 'sleepy';
  const done = passed.filter(m => (S.history[today()]||{})[m.id]).length;
  const ratio = done / passed.length;
  if (ratio >= 0.8) return 'happy';
  if (ratio >= 0.5) return 'ok';
  return 'tired';
}

/* ---------------- sound ---------------- */
let audioCtx = null;
function unlockAudio(){
  if (!audioCtx){
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) audioCtx = new AC();
  }
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
}
function jingle(kind){
  if (!S.soundOn) return;
  unlockAudio();
  if (!audioCtx) return;
  const notes =
    kind === 'meal'    ? [659,784,988,1319] :         // reminder chime
    kind === 'perfect' ? [523,659,784,1047,1319] :    // perfect-day fanfare
                         [784,988,1175];              // nom nom
  notes.forEach((f, i) => {
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = 'triangle';
    o.frequency.value = f;
    const t = audioCtx.currentTime + i * 0.13;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
    o.connect(g).connect(audioCtx.destination);
    o.start(t); o.stop(t + 0.3);
  });
}

/* ---------------- notifications ---------------- */
let swReg = null;
if ('serviceWorker' in navigator){
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  // A new worker claiming this page means fresh files are ready. Reload once, so
  // an update never sits behind a stale cached shell.
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    reloading = true;
    location.reload();
  });
  navigator.serviceWorker.register('sw.js')
    .then(r => { swReg = r; r.update(); })
    .catch(() => {});
}
function notifySupported(){ return 'Notification' in window; }
function notifyState(){ return notifySupported() ? Notification.permission : 'unsupported'; }

async function askNotify(){
  unlockAudio();
  if (!notifySupported()){ updateNotifyUI(); renderSettings(); return; }
  try { await Notification.requestPermission(); } catch {}
  updateNotifyUI(); renderSettings();
  if (Notification.permission === 'granted'){
    showNotification('FoodPet is watching over you',
      'Reminders are on. They arrive while FoodPet is open or recently used.');
    jingle('meal');
  }
}
// Returns whether a notification actually appeared, so a failure can be retried
// rather than silently recorded as delivered.
async function showNotification(title, body){
  const opts = {
    body,
    icon: 'icons/icon-192.png',
    badge: 'icons/icon-192.png',
    tag: 'foodpet-meal',
    renotify: true,
  };
  try {
    // Phones require the service worker's showNotification — `new Notification()`
    // throws an Illegal constructor there — so wait briefly for registration
    // rather than falling through to a path that cannot work.
    let reg = swReg;
    if (!reg && 'serviceWorker' in navigator){
      reg = await Promise.race([
        navigator.serviceWorker.ready,
        new Promise(res => setTimeout(() => res(null), 3000)),
      ]);
      if (reg) swReg = reg;
    }
    if (reg && reg.showNotification){ await reg.showNotification(title, opts); return true; }
    new Notification(title, opts);   // desktop browsers without a worker
    return true;
  } catch { return false; }
}
function showBanner(title, text){
  document.getElementById('banner-title').textContent = title;
  document.getElementById('banner-text').textContent = text;
  document.getElementById('banner').hidden = false;
}

async function remindFor(meal){
  const r = recipeFor(meal.id);
  const title = `${meal.name} — ${clockLabel(meal)}`;
  const body = `${r.name}. ${r.prep}`;
  let shown;
  if (notifyState() === 'granted'){
    shown = await showNotification(title, body);
    if (!shown) showBanner(title, `${r.name} — tap Meals to log it.`);  // notification failed
  } else {
    showBanner(title, `${r.name} — tap Meals to log it.`);
  }
  jingle('meal');
  return true;   // either the notification or the banner reached you
}

// Did the service worker already show this meal, from a push?
async function pushAlreadyShowed(slotId){
  try {
    const cache = await caches.open('foodpet-plan');
    const res = await cache.match('/shown');
    if (!res) return false;
    const rec = await res.json();
    return rec.date === today() && !!(rec.slots || {})[slotId];
  } catch { return false; }
}

const firing = new Set();   // in-flight reminders, so a slow one can't double-fire
function tick(){
  ensureDay();
  const now = new Date();
  const key = today();
  S.notified[key] = S.notified[key] || [];
  for (const meal of MEALS){
    const mins = (now - mealDate(meal, now)) / 60000;
    const due = mins >= 0 && mins <= NOTIFY_WINDOW_MIN;
    if (!due || S.notified[key].includes(meal.id) || firing.has(meal.id)) continue;
    if (mealState(meal, now) === 'logged') continue;
    firing.add(meal.id);
    // Record it only once something has actually been displayed. Marking first
    // meant any failure — a worker that wasn't ready yet, say — lost that meal's
    // reminder for the whole day with nothing to show for it.
    (async () => {
      // With background reminders on, the worker owns delivery. Announcing it
      // here as well is how you end up with two notifications per meal.
      if (S.pushOn && notifyState() === 'granted'){
        if (await pushAlreadyShowed(meal.id)){
          S.notified[key].push(meal.id); save();
          return;
        }
        // Give the push a chance to arrive before stepping in. If it never
        // does, the fallback below still reaches you.
        if (mins < PUSH_GRACE_MIN) return;
      }
      const delivered = await remindFor(meal);
      if (delivered){ S.notified[key].push(meal.id); save(); }
    })().finally(() => firing.delete(meal.id));
  }
  renderPet();
}

// Phones suspend the page, so most reminders are missed at the moment they are
// due. Whenever the app is opened or brought back, surface anything still waiting.
let lastBanner = null;
function catchUpOnOpen(){
  const now = new Date();
  const due = MEALS.filter(m => mealState(m, now) === 'now');
  if (!due.length){ lastBanner = null; return; }
  const meal = due[due.length-1];
  if (lastBanner === meal.id) return;          // don't re-announce the same one
  lastBanner = meal.id;
  const r = recipeFor(meal.id);
  showBanner(`${meal.name} is waiting`, `${r.name} — ${r.prep}`);
}

/* ---------------- background reminders ---------------- */
const CFG = window.FOODPET_CONFIG || {};
const pushConfigured = () => !!(CFG.PUSH_ENDPOINT && CFG.VAPID_PUBLIC_KEY);

// The worker sends an empty push; the service worker fills in the words from
// this, so meals, recipes and calories never leave the device.
async function publishPlan(){
  if (!('caches' in window)) return;
  try {
    const plan = {
      date: today(),
      meals: MEALS.map(m => {
        const r = recipeFor(m.id);
        return { id:m.id, name:m.name, h:m.h, m:m.m, time:clockLabel(m),
                 recipe:{ name:r.name, prep:r.prep } };
      }),
    };
    const cache = await caches.open('foodpet-plan');
    await cache.put('/plan', new Response(JSON.stringify(plan),
      { headers:{ 'content-type':'application/json' } }));
  } catch {}
}

const b64ToBytes = b64 => {
  const pad = (b64 + '='.repeat((4 - b64.length % 4) % 4)).replace(/-/g,'+').replace(/_/g,'/');
  return Uint8Array.from(atob(pad), c => c.charCodeAt(0));
};

async function pushSubscription(){
  if (!pushConfigured() || !('serviceWorker' in navigator)) return null;
  const reg = swReg || await navigator.serviceWorker.ready;
  if (!reg || !reg.pushManager) return null;
  return reg.pushManager.getSubscription();
}

// Times and timezone go to the worker; nothing else does.
async function syncPush(){
  if (!S.pushOn) return;
  const sub = await pushSubscription();
  if (!sub) return;
  await postPush('/subscribe', { subscription: sub.toJSON(), times: scheduleForServer(),
                                 tz: Intl.DateTimeFormat().resolvedOptions().timeZone });
}
function scheduleForServer(){
  const out = {};
  for (const m of MEALS) out[m.id] = `${pad(m.h)}:${pad(m.m)}`;
  return out;
}
async function postPush(path, body){
  const res = await fetch(CFG.PUSH_ENDPOINT.replace(/\/$/, '') + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error('push server said ' + res.status);
  return res.json();
}

async function enablePush(){
  if (notifyState() !== 'granted'){
    await askNotify();
    if (notifyState() !== 'granted') return false;
  }
  const reg = swReg || await navigator.serviceWorker.ready;
  if (!reg || !reg.pushManager) return false;
  let sub = await reg.pushManager.getSubscription();
  if (!sub){
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: b64ToBytes(CFG.VAPID_PUBLIC_KEY),
    });
  }
  await postPush('/subscribe', { subscription: sub.toJSON(), times: scheduleForServer(),
                                 tz: Intl.DateTimeFormat().resolvedOptions().timeZone });
  S.pushOn = true; save();
  await publishPlan();
  return true;
}

async function disablePush(){
  const sub = await pushSubscription();
  if (sub){
    try { await postPush('/unsubscribe', { endpoint: sub.endpoint }); } catch {}
    try { await sub.unsubscribe(); } catch {}
  }
  S.pushOn = false; save();
}

/* ---------------- rendering ---------------- */
function floatPoints(text){
  const el = document.createElement('div');
  el.className = 'float';
  el.textContent = text;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1000);
}

let noteTimer = null;
function showNote({ icon, text }){
  const el = document.getElementById('pet-note');
  el.textContent = `${icon}  ${text}`;
  el.hidden = false;
  clearTimeout(noteTimer);
  noteTimer = setTimeout(() => { el.hidden = true; }, 9000);
}

function hideNote(){
  clearTimeout(noteTimer);
  document.getElementById('pet-note').hidden = true;
}

function renderPet(){
  const mood = moodNow();
  pet.setMood(mood);
  const lines = MOOD_LINES[mood];
  document.getElementById('pet-mood').textContent =
    lines[seededIndex(today() + mood + loggedToday(), lines.length)];

  const level = Math.floor(S.points / 100) + 1;
  const into = S.points % 100;
  document.getElementById('chip-level').textContent = 'Lv ' + level;
  document.getElementById('chip-points').textContent = S.points + ' pts';
  document.getElementById('chip-streak').textContent = '🔥 ' + S.streak;
  document.getElementById('xp-fill').style.width = into + '%';
  document.getElementById('xp-label').textContent = (100 - into) + ' to Lv ' + (level + 1);

  // next / current meal card
  const { meal, tense } = currentMeal();
  const r = recipeFor(meal.id);
  const logged = mealState(meal) === 'logged';
  document.getElementById('next-kicker').textContent =
    logged ? 'Logged' : tense === 'now' ? 'Right now' : tense === 'past' ? 'Still waiting' : tense === 'tomorrow' ? 'Tomorrow' : 'Next up';
  document.getElementById('next-time').textContent = clockLabel(meal);
  document.getElementById('next-meal').textContent = meal.name;
  document.getElementById('next-recipe').textContent = r.name + ' — ' + r.prep;
  document.getElementById('next-why').textContent = r.why;
  const btn = document.getElementById('next-log');
  btn.textContent = logged ? '✓ Logged' : 'I ate this';
  btn.className = 'btn ' + (logged ? 'done' : 'primary');
  btn.disabled = logged;
  btn.onclick = () => startLog(meal.id);

  // today's pips
  const pips = document.getElementById('pips');
  pips.innerHTML = '';
  for (const m of MEALS){
    const st = mealState(m);
    const d = document.createElement('div');
    d.className = 'pip' + (st === 'logged' ? ' done' : st === 'now' ? ' waiting' : '');
    d.title = m.name;
    pips.appendChild(d);
  }
  document.getElementById('today-count').textContent = loggedToday() + ' of ' + MEALS.length;
}

// The range is guidance, not a rule — shown plainly, without a progress bar to chase.
function fuelLine(meal, state){
  if (!S.showFuel) return '';
  const target = slotTarget(meal.id);
  if (!target) return '';
  const logged = kcalOf(today(), meal.id);
  if (state === 'logged'){
    return logged == null
      ? `<p class="meal-fuel">Usual range ${target.min}–${target.max} kcal</p>`
      : `<p class="meal-fuel logged-fuel">Logged ~${logged} kcal &middot; range ${target.min}–${target.max}</p>`;
  }
  return `<p class="meal-fuel">Usual range ${target.min}–${target.max} kcal</p>`;
}

// Never phrased as a failure: it's a note about the basket, not about you.
function shopLine(recipe){
  if (!S.pantry || !S.pantry.length) return '';
  const missing = missingFor(recipe);
  return missing.length
    ? `<p class="meal-shop">needs ${missing.join(', ')}</p>`
    : `<p class="meal-shop have">✓ all from your usual shop</p>`;
}

function renderMeals(){
  const wrap = document.getElementById('meal-list');
  wrap.innerHTML = '';
  for (const meal of MEALS){
    const st = mealState(meal);
    const r = recipeFor(meal.id);
    const el = document.createElement('div');
    el.className = 'meal' + (st === 'now' ? ' now' : '') + (st === 'logged' ? ' logged' : '');
    const stateLabel = st === 'logged' ? 'Logged ✓' : st === 'now' ? 'Ready when you are' : st === 'past' ? 'Still waiting' : 'Coming up';
    const stateCls = st === 'logged' ? ' done' : st === 'now' ? ' now' : '';
    el.innerHTML = `
      <div class="meal-top">
        <span class="meal-time">${clockLabel(meal)}</span>
        <span class="meal-state${stateCls}">${stateLabel}</span>
      </div>
      <div class="meal-title">${meal.name}</div>
      ${fuelLine(meal, st)}
      ${shopLine(r)}
      <p class="meal-recipe">${r.name}</p>
      <p class="meal-prep">${r.prep}</p>
      <p class="meal-why">${r.why}</p>`;
    const btn = document.createElement('button');
    btn.className = 'btn ' + (st === 'logged' ? 'done' : 'primary');
    btn.textContent = st === 'logged' ? '✓ Logged' : 'I ate this';
    btn.disabled = st === 'logged';
    btn.onclick = () => startLog(meal.id);
    el.appendChild(btn);
    if (st !== 'logged'){
      const re = document.createElement('button');
      re.className = 'reroll';
      re.textContent = 'Not feeling it — swap idea';
      re.onclick = () => {
        const next = pickRecipe(meal.id, today(), String(Date.now()));
        S.picks[today()][meal.id] = next.id;
        S.recent[meal.id] = [next.id, ...(S.recent[meal.id] || []).filter(x => x !== next.id)].slice(0, 14);
        save(); renderAll();
      };
      el.appendChild(re);
    }
    wrap.appendChild(el);
  }
}

function renderShop(){
  const pg = document.getElementById('palette-grid');
  pg.innerHTML = '';
  for (const p of PALETTES){
    const owned = S.owned.includes(p.id);
    const worn = S.wearing.palette === p.id;
    const el = document.createElement('div');
    el.className = 'item' + (owned ? '' : ' locked') + (worn ? ' worn' : '');
    el.innerHTML = `<div class="swatch" style="background:${p.body};border-color:${p.dark}"></div>
      <span class="item-name">${p.name}</span>
      <span class="item-cost">${owned ? (worn ? 'wearing' : 'tap to wear') : p.cost + ' pts'}</span>`;
    el.onclick = () => buyOrWear(p, 'palette');
    pg.appendChild(el);
  }
  const hg = document.getElementById('hat-grid');
  hg.innerHTML = '';
  for (const h of HATS){
    const owned = S.owned.includes(h.id);
    const worn = S.wearing.hat === h.id;
    const el = document.createElement('div');
    el.className = 'item' + (owned ? '' : ' locked') + (worn ? ' worn' : '');
    el.innerHTML = `<span class="item-emoji">${h.emoji}</span>
      <span class="item-name">${h.name}</span>
      <span class="item-cost">${owned ? (worn ? 'wearing' : 'tap to wear') : h.cost + ' pts'}</span>`;
    el.onclick = () => buyOrWear(h, 'hat');
    hg.appendChild(el);
  }
}
function buyOrWear(item, kind){
  if (!S.owned.includes(item.id)){
    if (S.points < item.cost) return;
    S.points -= item.cost;
    S.owned.push(item.id);
    jingle('perfect');
    floatPoints('Unlocked!');
  }
  S.wearing[kind] = item.id;
  save();
  renderAll();
}

function renderWeek(){
  const days = [];
  for (let i = 6; i >= 0; i--){
    const d = new Date(); d.setDate(d.getDate() - i);
    days.push(dayKey(d));
  }
  const now = new Date();
  // Days before you first opened FoodPet aren't counted as skipped — no phantom guilt.
  const firstDay = Object.keys(S.picks).sort()[0] || today();
  let logged = 0, missed = 0;
  const rows = document.getElementById('week-rows');
  rows.innerHTML = '';
  for (const key of days){
    const log = S.history[key] || {};
    const before = key < firstDay;
    const row = document.createElement('div');
    row.className = 'wk-row' + (before ? ' pre' : '');
    const dots = MEALS.map(m => {
      if (log[m.id]){ logged++; return '<div class="dot done"></div>'; }
      if (key === today()){
        const st = mealState(m, now);
        if (st === 'later') return '<div class="dot"></div>';
        if (st === 'now') return '<div class="dot waiting"></div>';
        missed++; return '<div class="dot"></div>';
      }
      if (!before) missed++;
      return '<div class="dot"></div>';
    }).join('');
    row.innerHTML = `<span class="wk-day">${dayLabel(key)}</span><div class="wk-dots">${dots}</div>`;
    rows.appendChild(row);
  }
  document.getElementById('wk-logged').textContent = logged;
  document.getElementById('wk-missed').textContent = missed;
  document.getElementById('wk-streak').textContent = S.streak;
  document.getElementById('wk-points').textContent = S.points;
  document.getElementById('wk-perfect').textContent = S.perfectDays.filter(k => days.includes(k)).length;
  document.getElementById('app-version').textContent = 'FoodPet ' + APP_VERSION;
  renderFuel(days);
  renderShoppingList();
}

function renderShoppingList(){
  const card = document.getElementById('shop-card');
  const body = document.getElementById('shop-body');
  if (!S.pantry || !S.pantry.length){ card.hidden = true; return; }
  card.hidden = false;

  const gaps = shoppingGaps(7);
  if (!gaps.length){
    body.innerHTML = `<p class="muted small">Nothing to add — the whole week comes out of
      what you already buy.</p>`;
    return;
  }
  body.innerHTML = `
    <p class="muted small">Everything the next seven days need that isn't on your usual
      list. Swapping an idea changes this.</p>
    <div class="chips">
      ${gaps.map(([item, n]) =>
        `<span class="chip-need">${item}${n > 1 ? `<em>&times;${n}</em>` : ''}</span>`).join('')}
    </div>`;
}

function renderFuel(days){
  const body = document.getElementById('fuel-body');
  document.getElementById('fuel-card').hidden = !S.showFuel;
  if (!S.showFuel) return;
  const target = tdee();
  if (!target){
    body.innerHTML = `<p class="muted small">Add your details and FoodPet will show a gentle calorie
      range for each meal slot. Entirely optional.</p>`;
    return;
  }
  const p = S.profile;

  // Only days where something was actually estimated — a day you didn't log
  // isn't a day you didn't eat, so it shouldn't drag the average down.
  const withEstimates = days.filter(k => MEALS.some(m => kcalOf(k, m.id) != null));
  const avg = withEstimates.length
    ? Math.round(withEstimates.reduce((sum, k) => sum + dayKcal(k), 0) / withEstimates.length)
    : null;

  body.innerHTML = `
    <div class="fuel-top">
      <div><span class="fuel-num">${target}</span><span class="fuel-lbl">daily target</span></div>
      <div><span class="fuel-num">${avg == null ? '—' : avg}</span><span class="fuel-lbl">avg logged</span></div>
    </div>
    <p class="muted small">
      ${avg == null
        ? 'Log a few estimates and your weekly average appears here.'
        : `Averaged over ${withEstimates.length} day${withEstimates.length === 1 ? '' : 's'} where you estimated at least one meal. Partly logged days read low — that is expected.`}
    </p>
    <p class="muted small fuel-basis">
      BMR ${bmrOf(p)} kcal &middot; ${activityOf(p).label} &times;${activityOf(p).factor}
    </p>
    <div class="slot-targets">
      ${MEALS.map(m => {
        const t = slotTarget(m.id);
        return `<div class="slot-row"><span>${m.name}</span><span class="slot-range">${t.min}–${t.max}</span></div>`;
      }).join('')}
    </div>`;
}

/* ---------------- settings ---------------- */
function renderSettings(){
  // profile summary
  const box = document.getElementById('set-profile');
  if (!S.profile){
    box.innerHTML = `<p class="muted small">No details yet. Add them and FoodPet can show a
      gentle calorie range per meal — entirely optional.</p>`;
  } else {
    const p = S.profile;
    const sexLabel = p.sex === 'female' ? 'Female' : p.sex === 'male' ? 'Male' : 'Unspecified';
    box.innerHTML = `
      <div class="set-facts">
        <div><span>${p.age}</span>years</div>
        <div><span>${p.weight}</span>kg</div>
        <div><span>${p.height}</span>cm</div>
        <div><span>${tdee()}</span>kcal/day</div>
      </div>
      <p class="muted small">${sexLabel} &middot; ${activityOf(p).label} &middot; BMR ${bmrOf(p)} kcal</p>`;
  }

  // reminders
  const st = notifyState();
  const nb = document.getElementById('set-notify');
  nb.textContent = st === 'granted' ? 'On' : st === 'denied' ? 'Blocked' : st === 'unsupported' ? 'N/A' : 'Turn on';
  nb.className = 'chipbtn' + (st === 'granted' ? ' on' : '');
  nb.disabled = st !== 'default';
  document.getElementById('set-notify-state').textContent =
    st === 'granted' ? 'a notification at each meal time' :
    st === 'denied'  ? 'blocked in your browser settings' :
    st === 'unsupported' ? 'this browser has no notifications' :
                       'not turned on yet';
  document.getElementById('set-notify-note').textContent =
    st === 'granted'
      ? 'Reminders fire while FoodPet is open or alive in the background. If your phone has closed it completely, you will see a banner next time you open the app instead.'
      : 'Without notifications FoodPet shows a gentle in-app banner when you open it near a meal time.';

  setSwitch('set-sound', S.soundOn);
  setSwitch('set-fuel', S.showFuel);

  // background reminders only make sense once a worker is configured
  const pushRow = document.getElementById('set-push-row');
  pushRow.hidden = !pushConfigured();
  if (pushConfigured()){
    setSwitch('set-push', S.pushOn);
    document.getElementById('set-push-hint').textContent = S.pushOn
      ? 'reminders arrive even when FoodPet is closed'
      : 'let FoodPet nudge you with the app closed';
  }

  // meal times
  const times = document.getElementById('set-times');
  times.innerHTML = '';
  for (const meal of MEALS){
    const row = document.createElement('div');
    row.className = 'set-row';
    row.innerHTML = `<div class="set-label">${meal.name}</div>`;
    const input = document.createElement('input');
    input.type = 'time';
    input.className = 'field time-field';
    input.value = hhmm(meal);
    input.onchange = () => {
      if (!input.value) { input.value = hhmm(meal); return; }
      S.times[meal.id] = input.value;
      applyTimes(); save(); renderAll(); syncPush();
    };
    row.appendChild(input);
    times.appendChild(row);
  }

  renderShopPicker();

  document.getElementById('set-about').textContent =
    `FoodPet ${APP_VERSION} · everything stored on this device`;
}

function renderShopPicker(){
  const box = document.getElementById('set-shop');
  const vocab = window.FOODPET_INGREDIENTS || {};
  const have = new Set(S.pantry || []);
  box.innerHTML = '';
  for (const [group, items] of Object.entries(vocab)){
    const h = document.createElement('div');
    h.className = 'shop-group';
    h.textContent = group;
    box.appendChild(h);
    const wrap = document.createElement('div');
    wrap.className = 'chips';
    for (const item of items){
      const chip = document.createElement('button');
      chip.className = 'chip-toggle' + (have.has(item) ? ' on' : '');
      chip.textContent = item;
      chip.setAttribute('aria-pressed', have.has(item) ? 'true' : 'false');
      chip.onclick = () => togglePantry(item);
      wrap.appendChild(chip);
    }
    box.appendChild(wrap);
  }
  const total = Object.values(vocab).flat().length;
  document.getElementById('set-shop-count').textContent =
    have.size ? `${have.size} of ${total} ticked` : 'nothing ticked yet';

  // Honest about the trade-off: a short list means the same meals come round often.
  const note = document.getElementById('set-shop-note');
  if (!have.size){
    note.textContent = '';
  } else {
    const all = Object.values(RECIPES).flat();
    const covered = all.filter(r => missingFor(r).length === 0).length;
    note.textContent = covered < 12
      ? `${covered} of ${all.length} ideas need nothing extra — tick a few more for variety.`
      : `${covered} of ${all.length} ideas need nothing extra.`;
  }
}

function togglePantry(item){
  const have = new Set(S.pantry || []);
  have.has(item) ? have.delete(item) : have.add(item);
  S.pantry = [...have];
  // Re-pick today's unlogged meals so the change is visible straight away
  // rather than only from tomorrow.
  const key = today();
  const log = S.history[key] || {};
  if (S.picks[key]){
    for (const meal of MEALS){
      if (log[meal.id]) continue;
      const r = chooseRecipe(meal.id, key, (S.recent[meal.id] || []).slice(1, NO_REPEAT_DAYS));
      S.picks[key][meal.id] = r.id;
    }
  }
  save();
  renderAll();
}

function setSwitch(id, on){
  const el = document.getElementById(id);
  el.classList.toggle('on', !!on);
  el.setAttribute('aria-checked', on ? 'true' : 'false');
}

function copyBackup(){
  const data = JSON.stringify(S, null, 2);
  const done = () => openSheet('Backup copied', 'Paste it somewhere safe — a note to yourself is fine. Restoring it later brings back your meals, points and profile.', b => {
    const ok = document.createElement('button');
    ok.className = 'btn primary'; ok.textContent = 'Done'; ok.onclick = closeSheet;
    b.appendChild(ok);
  });
  // Clipboard access isn't available everywhere (older browsers, some in-app
  // browsers), so fall back to text you can select and copy by hand.
  const fallback = () => openSheet('Your backup', 'Copy this text and keep it somewhere safe.', b => {
    const ta = document.createElement('textarea');
    ta.className = 'field'; ta.rows = 8; ta.readOnly = true; ta.value = data;
    b.appendChild(ta);
    const ok = document.createElement('button');
    ok.className = 'btn primary'; ok.textContent = 'Done'; ok.onclick = closeSheet;
    b.appendChild(ok);
    ta.focus(); ta.select();
  });
  if (navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(data).then(done).catch(fallback);
  } else fallback();
}

function restoreBackup(){
  openSheet('Restore a backup', 'Paste a backup below. It replaces what is on this device.', body => {
    const ta = document.createElement('textarea');
    ta.className = 'field'; ta.rows = 8; ta.placeholder = '{ "points": … }';
    body.appendChild(ta);
    const msg = document.createElement('p');
    msg.className = 'sheet-note';
    body.appendChild(msg);

    const go = document.createElement('button');
    go.className = 'btn primary';
    go.textContent = 'Restore';
    go.onclick = () => {
      let parsed;
      try { parsed = JSON.parse(ta.value); } catch { msg.textContent = 'That does not look like a backup — check the whole text was pasted.'; return; }
      if (!parsed || typeof parsed !== 'object' || !('points' in parsed)){
        msg.textContent = 'That JSON is missing FoodPet data.'; return;
      }
      S = Object.assign(blank(), parsed);
      applyTimes(); save(); closeSheet(); renderAll();
    };
    body.appendChild(go);

    const cancel = document.createElement('button');
    cancel.className = 'linkbtn wide'; cancel.textContent = 'Cancel'; cancel.onclick = closeSheet;
    body.appendChild(cancel);
  });
}

function resetEverything(){
  openSheet('Start over?', 'This clears your meals, points, streak and profile on this device. It cannot be undone.', body => {
    const go = document.createElement('button');
    go.className = 'btn primary danger-btn';
    go.textContent = 'Yes, clear everything';
    go.onclick = () => {
      try { localStorage.removeItem(KEY); } catch {}
      S = blank();
      applyTimes(); save(); closeSheet(); renderAll();
      openProfileSheet(true);
    };
    body.appendChild(go);
    const cancel = document.createElement('button');
    cancel.className = 'linkbtn wide'; cancel.textContent = 'Keep my data'; cancel.onclick = closeSheet;
    body.appendChild(cancel);
  });
}

function updateNotifyUI(){
  // The Pet tab only asks once; after that, reminders live in Settings.
  document.getElementById('notify-prompt').hidden = notifyState() !== 'default';
}

function renderAll(){
  ensureDay();
  renderPet(); renderMeals(); renderShop(); renderWeek(); renderSettings(); updateNotifyUI();
  publishPlan();
}

/* ---------------- wiring ---------------- */
document.querySelectorAll('.tab').forEach(tab => {
  tab.onclick = () => {
    unlockAudio();
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t === tab));
    document.querySelectorAll('.view').forEach(v => { v.hidden = v.id !== 'view-' + tab.dataset.view; });
    window.scrollTo({ top:0, behavior:'smooth' });
  };
});
document.getElementById('btn-notify').onclick = askNotify;
document.getElementById('set-notify').onclick = askNotify;
document.getElementById('set-sound').onclick = () => {
  S.soundOn = !S.soundOn; save(); renderSettings();
  if (S.soundOn) jingle('eat');
};
document.getElementById('set-fuel').onclick = () => {
  S.showFuel = !S.showFuel; save(); renderAll();
};
document.getElementById('set-edit-profile').onclick = () => openProfileSheet(false);
document.getElementById('set-times-reset').onclick = () => {
  S.times = {}; applyTimes(); save(); renderAll(); syncPush();
};
document.getElementById('set-push').onclick = async () => {
  const hint = () => document.getElementById('set-push-hint');
  let problem = null;
  if (S.pushOn){
    await disablePush();
  } else {
    hint().textContent = 'setting up…';
    try {
      if (!await enablePush()) problem = 'needs notification permission first';
    } catch {
      problem = 'could not reach the reminder server';
    }
  }
  renderSettings();
  // after the re-render, or it would be overwritten by the standard hint
  if (problem) hint().textContent = problem;
};
document.getElementById('set-test').onclick = async () => {
  const out = document.getElementById('set-test-result');
  out.hidden = false;
  const st = notifyState();
  if (st !== 'granted'){
    out.textContent = st === 'denied'
      ? 'Notifications are blocked for this site in your browser settings, so FoodPet uses the in-app banner instead.'
      : 'Turn reminders on first, then try again.';
    jingle('meal');
    return;
  }
  out.textContent = 'Sending…';
  const ok = await showNotification('Test reminder', 'If you can see this, reminders are working.');
  jingle('meal');
  out.textContent = ok
    ? 'Sent. If nothing appeared, check notifications for this app in your phone settings.'
    : 'Your browser accepted the permission but refused to show it. On iPhone this usually means the app needs to be opened from the home-screen icon rather than a browser tab.';
};
document.getElementById('set-export').onclick = copyBackup;
document.getElementById('set-import').onclick = restoreBackup;
document.getElementById('set-reset').onclick = resetEverything;
document.getElementById('banner-close').onclick = () => { document.getElementById('banner').hidden = true; };
document.getElementById('btn-profile').onclick = () => openProfileSheet(false);
document.getElementById('sheet-backdrop').onclick = closeSheet;
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });
document.addEventListener('click', unlockAudio, { once:true });

/* Petting. Tap or stroke the pet and it squashes, blinks happily and gives off
   hearts. Deliberately unrewarded: affection you can't fall behind on. */
(() => {
  const cv = document.getElementById('pet-canvas');
  let down = false, lastTouch = 0;

  function at(e){
    const r = cv.getBoundingClientRect();
    const p = e.touches ? e.touches[0] : e;
    return { x: (p.clientX - r.left) * (cv.width / r.width),
             y: (p.clientY - r.top)  * (cv.height / r.height) };
  }

  function stroke(e){
    const now = performance.now();
    if (now - lastTouch < 150) return;    // one reaction per gesture step
    lastTouch = now;
    const { x, y } = at(e);
    const count = pet.touch(x, y);
    if (count === 1 || count % 4 === 0) chirp(count);
    if (count === 6) showNote({ icon:'💛', text: petLine() });
  }

  const onDown = e => { down = true; unlockAudio(); stroke(e); };
  const onMove = e => { if (down) { e.preventDefault(); stroke(e); } };
  const onUp = () => { down = false; };

  cv.addEventListener('mousedown', onDown);
  cv.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
  cv.addEventListener('touchstart', onDown, { passive:true });
  cv.addEventListener('touchmove', onMove, { passive:false });
  window.addEventListener('touchend', onUp);
})();

const PET_LINES = [
  'That is the spot.',
  'Happy little creature.',
  'Thoroughly pleased with you.',
  'Wriggling with joy.',
];
function petLine(){ return PET_LINES[Math.floor(Math.random() * PET_LINES.length)]; }

// A soft rising blip, climbing a little with each stroke.
function chirp(count){
  if (!S.soundOn) return;
  unlockAudio();
  if (!audioCtx) return;
  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  o.type = 'sine';
  o.frequency.value = 660 + Math.min(count, 8) * 40;
  const t = audioCtx.currentTime;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.10, t + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
  o.connect(g).connect(audioCtx.destination);
  o.start(t); o.stop(t + 0.18);
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  renderAll(); tick(); catchUpOnOpen();
});
window.addEventListener('focus', () => { tick(); catchUpOnOpen(); });

applyTimes();
ensureDay();
renderAll();
if (!S.profile) openProfileSheet(true);   // first launch: ask once, skippable
else catchUpOnOpen();
setInterval(tick, 20000);
setInterval(renderAll, 60000);
})();
