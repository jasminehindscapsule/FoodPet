# FoodPet reminder worker

Sends a push when a meal time comes round, so reminders arrive with the app closed.

## What it stores

A push subscription, six times, and a timezone. Nothing else — **the pushes carry no
payload**. The service worker on your phone works out which meal it is and what today's
recipe was, from data that never leaves the device. So this server never sees a meal, a
calorie estimate, or your profile.

## Deploy

From this directory. The first command opens a browser to authorise Wrangler against
your own Cloudflare account — that part is yours to do, not something to hand over.

```bash
npx wrangler login
```

Create the KV namespace that holds subscriptions, then put the printed id into
`wrangler.toml` where it says `REPLACE_WITH_YOUR_KV_ID`:

```bash
npx wrangler kv namespace create SUBS
```

Store the private half of the VAPID key pair as a secret (paste the key when prompted —
it must never be committed):

```bash
npx wrangler secret put VAPID_PRIVATE_KEY
```

Deploy:

```bash
npx wrangler deploy
```

Wrangler prints the worker URL. Put it in `../config.js` as `PUSH_ENDPOINT`, commit and
push — *Background reminders* then appears in the app's Settings.

## How it decides

The cron runs every five minutes and, for each subscription, works out the local time in
that subscriber's timezone. If a meal time fell within the last six minutes and nothing
has been sent for that slot today, it sends one push. Dead subscriptions (404/410) are
deleted.

## Costs

Free tier: 100k worker requests/day and 1k KV writes/day. Six pushes a day uses a
rounding error of that.

## Rotating keys

`node ../scripts/generate-vapid.mjs` prints a fresh pair. Update `VAPID_PUBLIC_KEY` in
both `wrangler.toml` and `../config.js`, re-run `wrangler secret put`, redeploy — then
every device must toggle Background reminders off and on, since existing subscriptions
are bound to the old key.
