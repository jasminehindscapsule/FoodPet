/* ============================================================
   FoodPet — a gentle metabolic-health companion
   No accounts, no backend. Everything lives in localStorage.
   ============================================================ */
(() => {
'use strict';

/* ---------------- meal schedule ---------------- */
const MEALS = [
  { id:'breakfast',   name:'Breakfast',            h:7,  m:0  },
  { id:'midmorning',  name:'Mid-Morning Fuel',     h:10, m:0  },
  { id:'lunch',       name:'Lunch',                h:12, m:30 },
  { id:'preworkout',  name:'Pre-Workout Spark',    h:15, m:0  },
  { id:'postworkout', name:'Post-Workout Recovery',h:16, m:15 },
  { id:'dinner',      name:'Dinner',               h:18, m:30 },
];
const RECIPES = window.FOODPET_RECIPES;
const POINTS_PER_MEAL = 10;
const PERFECT_BONUS = 20;
const NO_REPEAT_DAYS = 6;      // a slot won't repeat an idea within this many picks
const DUE_WINDOW_MIN = 120;    // how long a meal counts as "now" after its time
const NOTIFY_GRACE_MIN = 15;   // fire a reminder only within this long after the time

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
  points: 0,
  streak: 0,
  lastStreakDay: null,
  history: {},        // 'YYYY-MM-DD' -> { slotId: isoTimestamp }
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
function pickRecipe(slotId, dateKey, salt = ''){
  const all = RECIPES[slotId];
  const recent = (S.recent[slotId] || []).slice(0, NO_REPEAT_DAYS);
  let pool = all.filter(r => !recent.includes(r.id));
  if (!pool.length) pool = all;                       // tiny pools: allow a repeat
  return pool[seededIndex(dateKey + slotId + salt, pool.length)];
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

/* ---------------- meal state ---------------- */
// 'logged' | 'now' (its time has come, still waiting) | 'past' (gently skipped) | 'later'
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
function logMeal(slotId){
  const key = today();
  S.history[key] = S.history[key] || {};
  if (S.history[key][slotId]) return;
  S.history[key][slotId] = new Date().toISOString();
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
  renderAll();
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
  'DBB##BBBB##BBBBD',
  'DBB##BBBB##BBBBD',
  'DBBBBBBBBBBBBBBD',
  'DBCCBB@@@@BBCCBD',
  'DBCCBBB@@BBBCCBD',
  '.DBBBBBBBBBBBBD.',
  '..DBBBBBBBBBBD..',
  '...DDBBBBBBDD...',
  '.....DD..DD.....',
];
const HAT_ROWS = {
  none:   [],
  beanie: ['....aaaaaaaa....','...abbbbbbbba...','..aaaaaaaaaaaa..'],
  chef:   ['...aa.aaaa.aa...','..aaaaaaaaaaaa..','...abbbbbbba....'],
  crown:  ['...a...a...a....','...aa.aaa.aa....','...aaaaaaaaa....','....bbbbbbb.....'],
  party:  ['.......a........','......aaa.......','.....aabaa......','....aaaaaaa.....'],
  flower: ['.....a.a.a......','....aabbbaa.....','.....a.a.a......'],
};

const pet = (() => {
  const cv = document.getElementById('pet-canvas');
  const cx = cv.getContext('2d');
  const PX = 16;
  const OY = 4;          // rows of headroom above the pet, so tall hats fit
  let mood = 'ok', eatUntil = 0, t0 = performance.now();

  function palette(){ return PALETTES.find(p => p.id === S.wearing.palette) || PALETTES[0]; }

  function rows(){
    const r = SPRITE.slice();
    const eating = performance.now() < eatUntil;
    const chomp = eating && Math.floor(performance.now()/160) % 2 === 0;

    if (eating || mood === 'happy'){                       // bright open eyes
      // default sprite eyes are already open
    } else if (mood === 'tired'){                          // soft closed eyes
      r[7] = 'DBBBBBBBBBBBBBBD';
      r[8] = 'DBB##BBBB##BBBBD';
    } else if (mood === 'sleepy'){
      r[7] = 'DBBBBBBBBBBBBBBD';
      r[8] = 'DBB##BBBB##BBBBD';
    }
    if (chomp){                                            // wide-open mouth
      r[10] = 'DBCCBB@@@@BBCCBD';
      r[11] = 'DBCCBB@@@@BBCCBD';
    } else if (mood === 'tired'){                          // small neutral mouth
      r[10] = 'DBCCBBB@@BBBCCBD';
      r[11] = 'DBCCBBBBBBBBCCBD';
    } else if (mood === 'ok'){
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

    // shadow
    cx.fillStyle = 'rgba(120,100,150,.12)';
    cx.fillRect(PX*3, PX*(15+OY) + 4, PX*10, PX*0.6);

    const colors = { B:p.body, D:p.dark, C:p.cheek, '#':'#3a3350', '@':'#7d4a54' };
    const body = rows();
    for (let y = 0; y < body.length; y++)
      for (let x = 0; x < body[y].length; x++){
        const c = colors[body[y][x]];
        if (!c) continue;
        cx.fillStyle = c;
        cx.fillRect(x*PX, (y+OY)*PX + bob, PX, PX);
      }

    // hat sits on the head, riding the same bob
    const hat = HATS.find(h => h.id === S.wearing.hat);
    const hr = HAT_ROWS[S.wearing.hat] || [];
    if (hat && hr.length){
      const top = OY + 1 - hr.length;
      for (let y = 0; y < hr.length; y++)
        for (let x = 0; x < hr[y].length; x++){
          const ch = hr[y][x];
          if (ch === '.') continue;
          cx.fillStyle = ch === 'a' ? hat.a : hat.b;
          cx.fillRect(x*PX, (top + y)*PX + bob, PX, PX);
        }
    }

    // a little snack floating into the mouth
    if (eating){
      const k = 1 - (eatUntil - now) / 1500;
      cx.font = '38px serif';
      cx.textAlign = 'center';
      cx.globalAlpha = Math.max(0, 1 - k);
      cx.fillText('🥗', cv.width/2, PX*(10+OY) + bob - (1-k)*30 + 28);
      cx.globalAlpha = 1;
    }
    requestAnimationFrame(draw);
  }
  requestAnimationFrame(draw);

  return {
    setMood(m){ if (m !== mood){ mood = m; t0 = performance.now(); } },
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
  navigator.serviceWorker.register('sw.js')
    .then(r => { swReg = r; })
    .catch(() => {});
}
function notifySupported(){ return 'Notification' in window; }
function notifyState(){ return notifySupported() ? Notification.permission : 'unsupported'; }

async function askNotify(){
  unlockAudio();
  if (!notifySupported()){ updateNotifyUI(); return; }
  try { await Notification.requestPermission(); } catch {}
  updateNotifyUI();
  if (Notification.permission === 'granted'){
    showNotification('FoodPet is watching over you', 'Reminders are on. Keep this tab or the app open and I will chime at meal times.');
    jingle('meal');
  }
}
function showNotification(title, body){
  const opts = {
    body,
    icon: 'icons/icon-192.png',
    badge: 'icons/icon-192.png',
    tag: 'foodpet-meal',
    renotify: true,
    vibrate: [90, 60, 90],
  };
  try {
    if (swReg && swReg.showNotification) swReg.showNotification(title, opts);
    else new Notification(title, opts);
  } catch {}
}
function showBanner(title, text){
  document.getElementById('banner-title').textContent = title;
  document.getElementById('banner-text').textContent = text;
  document.getElementById('banner').hidden = false;
}

function remindFor(meal){
  const r = recipeFor(meal.id);
  const title = `${meal.name} — ${clockLabel(meal)}`;
  const body = `${r.name}. ${r.prep}`;
  if (notifyState() === 'granted') showNotification(title, body);
  else showBanner(title, `${r.name} — tap Meals to log it.`);
  jingle('meal');
}

function tick(){
  ensureDay();
  const now = new Date();
  const key = today();
  S.notified[key] = S.notified[key] || [];
  for (const meal of MEALS){
    const mins = (now - mealDate(meal, now)) / 60000;
    const due = mins >= 0 && mins <= NOTIFY_GRACE_MIN;
    if (due && !S.notified[key].includes(meal.id) && mealState(meal, now) !== 'logged'){
      S.notified[key].push(meal.id);
      save();
      remindFor(meal);
    }
  }
  renderPet();
}

// Fallback for a reminder that fired while the app was closed:
// on open, if something is due right now and unlogged, show the in-app banner.
function catchUpOnOpen(){
  const now = new Date();
  const due = MEALS.filter(m => mealState(m, now) === 'now');
  if (!due.length) return;
  const meal = due[due.length-1];
  const r = recipeFor(meal.id);
  showBanner(`${meal.name} is waiting`, `${r.name} — ${r.prep}`);
}

/* ---------------- rendering ---------------- */
function floatPoints(text){
  const el = document.createElement('div');
  el.className = 'float';
  el.textContent = text;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1000);
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
  btn.onclick = () => logMeal(meal.id);

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
      <p class="meal-recipe">${r.name}</p>
      <p class="meal-prep">${r.prep}</p>
      <p class="meal-why">${r.why}</p>`;
    const btn = document.createElement('button');
    btn.className = 'btn ' + (st === 'logged' ? 'done' : 'primary');
    btn.textContent = st === 'logged' ? '✓ Logged' : 'I ate this';
    btn.disabled = st === 'logged';
    btn.onclick = () => logMeal(meal.id);
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
}

function updateNotifyUI(){
  const btn = document.getElementById('btn-notify');
  const note = document.getElementById('notify-note');
  const st = notifyState();
  if (st === 'granted'){
    btn.textContent = 'Reminders on ✓';
    note.textContent = 'Reminders chime at each meal time while FoodPet is open or installed in the background.';
  } else if (st === 'denied'){
    btn.textContent = 'Reminders blocked';
    note.textContent = 'Notifications are blocked in your browser settings — FoodPet will show a gentle in-app banner instead.';
  } else if (st === 'unsupported'){
    btn.textContent = 'Reminders unavailable';
    note.textContent = 'This browser has no notifications — FoodPet will show an in-app banner when a meal is due.';
  } else {
    btn.textContent = 'Turn on reminders';
    note.textContent = 'Add FoodPet to your home screen, then turn reminders on for meal-time notifications with a jingle.';
  }
  document.getElementById('btn-sound').textContent = 'Sound: ' + (S.soundOn ? 'on' : 'off');
}

function renderAll(){
  ensureDay();
  renderPet(); renderMeals(); renderShop(); renderWeek(); updateNotifyUI();
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
document.getElementById('btn-sound').onclick = () => {
  S.soundOn = !S.soundOn; save(); updateNotifyUI();
  if (S.soundOn) jingle('eat');
};
document.getElementById('banner-close').onclick = () => { document.getElementById('banner').hidden = true; };
document.addEventListener('click', unlockAudio, { once:true });
document.addEventListener('visibilitychange', () => { if (!document.hidden){ renderAll(); tick(); } });

ensureDay();
renderAll();
catchUpOnOpen();
setInterval(tick, 20000);
setInterval(renderAll, 60000);
})();
