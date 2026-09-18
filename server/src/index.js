/* FoodPet reminder worker.

   Holds a push subscription and the six meal times, and sends a push when one
   of those times comes round in the subscriber's own timezone.

   Deliberately knows nothing about food. The pushes carry no payload: the
   service worker on the device works out which meal it is and what today's
   recipe was, from data that never leaves the phone. So this worker stores a
   subscription, a list of times and a timezone — no meals, no calories, no
   profile.                                                                     */

const CRON_SLACK_MIN = 6;   // a */5 cron can drift; accept a small window
const TTL_SECONDS = 1800;   // a meal reminder is worthless hours later

/* ---------------- small helpers ---------------- */
const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
  status, headers: { 'content-type': 'application/json', ...cors() },
});
const cors = () => ({
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
});
const b64urlToBytes = s => {
  const pad = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(pad + '='.repeat((4 - pad.length % 4) % 4));
  return Uint8Array.from(bin, c => c.charCodeAt(0));
};
const bytesToB64url = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes)))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/* ---------------- VAPID ---------------- */
// Signed JWT proving to the push service that this server owns the key the
// browser subscribed with.
async function vapidHeader(audience, env){
  const header = bytesToB64url(new TextEncoder().encode(JSON.stringify({ typ:'JWT', alg:'ES256' })));
  const claims = bytesToB64url(new TextEncoder().encode(JSON.stringify({
    aud: audience,
    exp: Math.floor(Date.now()/1000) + 12*60*60,
    sub: env.VAPID_SUBJECT || 'mailto:foodpet@example.com',
  })));
  const unsigned = `${header}.${claims}`;

  const key = await crypto.subtle.importKey('jwk', {
    kty:'EC', crv:'P-256', d: env.VAPID_PRIVATE_KEY,
    x: bytesToB64url(b64urlToBytes(env.VAPID_PUBLIC_KEY).slice(1, 33)),
    y: bytesToB64url(b64urlToBytes(env.VAPID_PUBLIC_KEY).slice(33, 65)),
    ext: true,
  }, { name:'ECDSA', namedCurve:'P-256' }, false, ['sign']);

  const sig = await crypto.subtle.sign(
    { name:'ECDSA', hash:'SHA-256' }, key, new TextEncoder().encode(unsigned));

  return `vapid t=${unsigned}.${bytesToB64url(sig)}, k=${env.VAPID_PUBLIC_KEY}`;
}

// A push with no body. The device decides what to say.
async function sendPush(subscription, env){
  const endpoint = new URL(subscription.endpoint);
  const res = await fetch(subscription.endpoint, {
    method: 'POST',
    headers: {
      TTL: String(TTL_SECONDS),
      Authorization: await vapidHeader(endpoint.origin, env),
      'content-length': '0',
    },
  });
  return res.status;
}

/* ---------------- schedule ---------------- */
// Minutes past midnight, in the subscriber's timezone.
function localNow(tz){
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(new Date()).reduce((o, p) => (o[p.type] = p.value, o), {});
    return {
      minutes: Number(parts.hour)*60 + Number(parts.minute),
      date: `${parts.year}-${parts.month}-${parts.day}`,
    };
  } catch { return null; }
}

function dueNow(times, tz){
  const now = localNow(tz);
  if (!now) return null;
  for (const [id, hhmm] of Object.entries(times || {})){
    const [h, m] = String(hhmm).split(':').map(Number);
    if (!Number.isFinite(h) || !Number.isFinite(m)) continue;
    const delta = now.minutes - (h*60 + m);
    if (delta >= 0 && delta < CRON_SLACK_MIN) return { id, date: now.date };
  }
  return null;
}

/* ---------------- HTTP ---------------- */
export default {
  async fetch(request, env){
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors() });
    const url = new URL(request.url);

    if (url.pathname === '/health') return json({ ok: true });

    if (url.pathname === '/subscribe' && request.method === 'POST'){
      let body;
      try { body = await request.json(); } catch { return json({ error:'bad json' }, 400); }
      const { subscription, times, tz } = body || {};
      if (!subscription || !subscription.endpoint) return json({ error:'no subscription' }, 400);
      await env.SUBS.put(subscription.endpoint, JSON.stringify({
        subscription, times: times || {}, tz: tz || 'UTC', saved: new Date().toISOString(),
      }));
      return json({ ok: true });
    }

    if (url.pathname === '/unsubscribe' && request.method === 'POST'){
      let body;
      try { body = await request.json(); } catch { return json({ error:'bad json' }, 400); }
      if (body && body.endpoint) await env.SUBS.delete(body.endpoint);
      return json({ ok: true });
    }

    return json({ error: 'not found' }, 404);
  },

  async scheduled(event, env, ctx){
    ctx.waitUntil((async () => {
      const list = await env.SUBS.list();
      for (const entry of list.keys){
        const raw = await env.SUBS.get(entry.name);
        if (!raw) continue;
        let rec;
        try { rec = JSON.parse(raw); } catch { continue; }

        const due = dueNow(rec.times, rec.tz);
        if (!due) continue;

        // One push per slot per local day, even if the cron overlaps the window.
        const stamp = `${due.date}:${due.id}`;
        if (rec.lastSent === stamp) continue;

        const status = await sendPush(rec.subscription, env);
        if (status === 404 || status === 410){
          await env.SUBS.delete(entry.name);     // subscription is dead
          continue;
        }
        rec.lastSent = stamp;
        await env.SUBS.put(entry.name, JSON.stringify(rec));
      }
    })());
  },
};
