/* Background reminders.

   Fill PUSH_ENDPOINT in after deploying the worker in server/ and background
   reminders appear in Settings. Leave it empty and FoodPet works exactly as
   before — everything else is unaffected.

   The public key is meant to be public; its private half lives only as a
   Worker secret. */
window.FOODPET_CONFIG = {
  PUSH_ENDPOINT: '',   // e.g. 'https://foodpet-reminders.<your-subdomain>.workers.dev'
  VAPID_PUBLIC_KEY: 'BM-UkBimft3egAkaEreTTS8CfVSxtNg5wmc64WO0nZcqijyaA9DS05fMujOdP8PKR_xrQ2tjkxD_HMRMdZpCIC4',
};
