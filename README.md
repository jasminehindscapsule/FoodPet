# FoodPet 🥚

A gentle Tamagotchi-style companion that reminds you to eat on schedule and rewards
you for logging meals. No account, no backend — everything lives in `localStorage`.

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

## Points

- **+10** per meal logged
- **+20** Perfect Day bonus when all six are logged
- **Level** = every 100 points
- **Streak** = consecutive days with at least one meal logged
- Points buy palette swaps and hats in the Closet. Wearing costs nothing once unlocked.

## No failure states

Meals that pass unlogged read *"Still waiting"* — never red, never "missed". The pet gets
sleepy-eyed and bobs more slowly on a low-fuel day, and that's the whole punishment. Days
before you installed the app aren't counted against you in the weekly view.

## Files

```
index.html               shell + views
styles.css               pastel theme, light and dark
app.js                   schedule, rotation, points, canvas pet, notifications
recipes.js               the recipe database
sw.js                    offline cache + notification clicks
manifest.webmanifest     PWA metadata
icons/                   generated pixel-pet PNGs
```

## Resetting

To wipe progress, open the console and run:

```js
localStorage.removeItem('foodpet.v1'); location.reload();
```
