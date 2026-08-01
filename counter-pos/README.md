# Counter — Multi-Shop POS & Inventory

A lightweight pop-up counter POS system: customer ordering screen, shop admin
dashboard (products, inventory, sales, staff), and a developer panel for
onboarding pop-up businesses ("clients"), each with their own shop code,
subscription plan, and auto-locking access when their plan expires.

## File structure

```
counter-pos/
├── index.html                    entry point — open this in a browser
├── css/
│   └── styles.css                all styling
├── js/
│   ├── app.js                    all application logic
│   ├── firebase-config.example.js   copy → firebase-config.js, add your project keys
│   └── firebase-storage.js       optional Firebase backend (see below)
├── README.md
└── FIREBASE_SETUP.md             step-by-step Firebase backend guide
```

## Quick start (no backend needed)

Data is stored in the browser via `localStorage` by default — nothing to
configure. This is enough to develop, demo, or run a single till on one
device.

1. Clone the repo.
2. Open `index.html` directly in a browser, or serve it locally:
   ```
   npx serve counter-pos
   ```
3. On the "Enter Shop Code" screen, use demo shop code **DEMO01**
   (admin password `admin123`).
4. Open the Developer panel via the small dot in the footer
   (password `dev2026`) to create new pop-up clients, approve/renew
   subscriptions, or suspend a shop.

**Change both default passwords** (Admin → Security, Developer → Security)
before giving this to anyone else.

## Multi-device / shared data

`localStorage` is per-browser — a laptop running Admin and a tablet running
Counter won't see the same data. To make every device for a shop see the
same live data (and to let multiple real pop-ups use one deployment), wire
up the optional Firebase backend — see **FIREBASE_SETUP.md**. No changes to
`app.js` are required; it auto-detects `window.CounterStorageProvider` and
switches over.

## Deploying

Since this is a static site (no build step, no server-side code), it can be
hosted anywhere that serves static files:

- **Firebase Hosting** (pairs naturally with the Firestore backend)
- **GitHub Pages** (Settings → Pages → deploy from the `main` branch)
- **Netlify / Vercel** (drag-and-drop the folder or connect the repo)

## Security note

The Admin and Developer "passwords" in this app are a UI-level gate, not
real authentication — there's no server validating them. That's fine for
running your own pop-ups, but if you deploy this publicly with an open
Firestore backend, anyone with your Firebase web config could read/write
data directly, bypassing the password screens. See the "Hardening" section
of FIREBASE_SETUP.md before treating this as production-grade for
unrelated businesses' real payment/inventory data.
