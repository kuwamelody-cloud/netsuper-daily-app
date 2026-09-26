# Notification backend

This is the single-user reference backend for NS Business Assist. It stores only Push subscriptions, assist sessions, reminder state, and action results. It does not receive store passwords, memos, mileage, fuel, case totals, or item totals.

Before deployment, choose a host with an always-on Node process, HTTPS, and persistent disk. Configure `NS_ALLOWED_ORIGIN` with the exact GitHub Pages origin (`https://kuwamelody-cloud.github.io`), `NS_REGISTRATION_CODE` with a private onboarding code, and `NS_VAPID_SUBJECT` with an HTTPS URL or monitored email. Run `npm install`, then `npm test` and `npm start`. Keep `private/` on persistent storage and out of source control.

The JSON store uses atomic replacement and is intentionally limited to one server process and a small number of installations. Multi-user distribution requires a transactional database and a job-claim constraint before release.
