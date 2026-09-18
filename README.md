# FoodPet 🥚

A gentle Tamagotchi-style companion that reminds you to eat on schedule and rewards
you for logging meals. No account, no backend — everything lives in `localStorage`.

The pet is drawn pixel by pixel on a canvas from a 16x16 character grid in `app.js` —
edit `SPRITE` to reshape it.

## Run it

Open `index.html` in a browser. That's it.

For notifications and "install to home screen" to work, it needs to be served over
`http://localhost` or `https://` (browsers disable service workers on `file://`):

```bash
cd /Users/jasminehinds/FoodPet && python3 -m http.server 8777
```

Then visit `http://localhost:8777`.

## Install on your phone

Put the folder on any static host (GitHub Pages, Netlify drop, Vercel — anything HTTPS), then:

- **iOS Safari** — Share → *Add to Home Screen*. iOS only allows web notifications for
  home-screen apps, so add it first, open it from the icon, then tap *Turn on reminders*.
- **Android Chrome** — the install prompt appears automatically, or menu → *Install app*.

## The schedule

| Time | Meal |
|---|---|
| 7:00 AM | Breakfast |
| 10:00 AM | Mid-Morning Fuel |
| 12:30 PM | Lunch |
| 3:00 PM | Pre-Workout Spark |
| 4:15 PM | Post-Workout Recovery |
| 6:30 PM | Dinner |

To change a time or add a meal, edit the `MEALS` array at the top of `app.js`.

## How reminders work

At each meal time FoodPet fires a system notification with the meal name and that day's
recipe idea, plus a short four-note jingle. This is a **local** schedule — the app checks
the clock every 20 seconds while it is open or alive in the background. There is no push
server, so if the phone has fully evicted the app from memory the notification won't fire.
The fallback covers that: the next time you open FoodPet near a meal time, a soft in-app
banner tells you what's waiting. The same banner is used if you decline notification
permission, so nothing breaks.

Sound can be toggled with the *Sound* button. Browsers require one tap on the page before
audio can play, which the first interaction handles.

## Recipes

`recipes.js` holds the database — plain JSON, wrapped in a `window.FOODPET_RECIPES =`
assignment so the app also works straight from `file://` (where `fetch()` of a local JSON
file is blocked). Six slots, 6–7 ideas each, every entry with a name, a sub-10-minute prep
line, and why it fits metabolically.

Each day the app picks one idea per slot, skipping anything used in that slot's last 6
picks, so nothing repeats inside a week. The pick is deterministic per day, so reloading
doesn't reshuffle it — but *Not feeling it — swap idea* on the Meals tab will.

## Calorie adequacy

Optional, and asked for once on first launch: age, weight, height, sex, activity level
(default *lightly active*, 1.4). From that:

- **BMR** — Mifflin-St Jeor: `10 x weight + 6.25 x height - 5 x age`, then `-161` female,
  `+5` male, `-78` if you'd rather not say (midway between, rather than a guess).
- **TDEE** — BMR x activity factor.
- **Per-slot targets** — TDEE split 20 / 10 / 25 / 10 / 15 / 20 across the six slots,
  each shown as a **range of +/-15%** rather than a number, so there is nothing to hit exactly.

A 60kg, 173cm, 24-year-old woman, lightly active, comes out at 1960 kcal: breakfast
335-450, mid-morning 165-225, lunch 415-565, pre-workout 165-225, post-workout 250-340,
dinner 335-450.

Targets are derived from the profile alone, so they change **only** when you edit it
(Week tab -> Edit profile). Nothing recalculates day to day.

### Logging an estimate

Tapping *I ate this* asks how much it was: **Small / Just right / Big** (0.7x, 1x and
1.35x of that recipe's `kcal` estimate, with the resulting number shown on the button),
a box to type a figure if you know it, or *Just log it* for no estimate at all.

Then, in a line under the pet:

| | |
|---|---|
| In range | "Right in range. Nicely fuelled." Pet eats happily. |
| Below | "That might not be much fuel — a little more protein or fat would round it out." Pet looks briefly low-energy — still hungry, never sad. |
| Above | "A bit more than usual for this slot — no problem at all, just noting it." Pet looks pleasantly full. |

**Points are identical in all three cases.** Portion size is information, never a score,
and there is no red state, no deficit counter and no bar to fill.

The Week tab shows your daily target against your average logged intake. That average
counts only days where you estimated at least one meal — a day you didn't log isn't a
day you didn't eat, so it shouldn't drag the number down. Partly logged days still read
low, and the card says so.

Estimates are deliberately rough: no barcodes, no food database. The point is noticing
patterns, not precision.

## Points

- **+10** per meal logged
- **+20** Perfect Day bonus when all six are logged
- **Level** = every 100 points
- **Streak** = consecutive days with at least one meal logged
- Points buy palette swaps and hats in the Closet. Wearing costs nothing once unlocked.
- Calorie estimates never change points, in either direction.

## No failure states

Meals that pass unlogged read *"Still waiting"* — never red, never "missed". The pet gets
sleepy-eyed and bobs more slowly on a low-fuel day, and that's the whole punishment. Days
before you installed the app aren't counted against you in the weekly view.

## Files

```
index.html               shell + views
styles.css               pastel theme, light and dark
app.js                   schedule, rotation, points, canvas pet, notifications
recipes.js               the recipe database, each with a rough `kcal` per serving
sw.js                    offline cache + notification clicks
manifest.webmanifest     PWA metadata
icons/                   generated pixel-pet PNGs
```

## Updating a deployed copy

The service worker fetches the app shell **network-first**, so pushing to `main` is
enough — the next load picks up the new build, and if a new worker takes over a page
that was already running, the app reloads itself once so you never sit on stale files.
Cached copies remain the offline fallback.

Only bump `VERSION` in [sw.js](sw.js) if you change what's in `ASSETS` or want to force
every cache to be dropped. The running build is printed at the foot of the Week tab, so
you can always see which version a device actually has.

If a device is somehow still stuck on an old build: close every tab (or fully close the
home-screen app) and reopen. Failing that, clear that site's data in browser settings.

## Resetting

To wipe progress, open the console and run:

```js
localStorage.removeItem('foodpet.v1'); location.reload();
```
