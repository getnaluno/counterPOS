# Firebase Setup — Step by Step

This connects Counter POS to Firestore so every shop's data (products,
orders, inventory, clients) syncs live across every device, instead of
staying trapped in one browser's local storage.

No code changes are required — `app.js` already checks for
`window.CounterStorageProvider` and uses it automatically when present.

---

## 1. Create a Firebase project

1. Go to [console.firebase.google.com](https://console.firebase.google.com) and sign in.
2. Click **Add project**, give it a name (e.g. `counter-pos`).
3. Google Analytics is optional for this project — you can disable it.
4. Click **Create project** and wait for it to finish provisioning.

## 2. Create a Firestore database

1. In the left sidebar, go to **Build → Firestore Database**.
2. Click **Create database**.
3. Choose **Start in production mode** (we'll set real rules in step 5 — don't leave it in test mode long-term).
4. Pick a location close to where your pop-ups operate. This can't be changed later.
5. Click **Enable**.

## 3. Register a web app and get your config

1. In the left sidebar, click the gear icon → **Project settings**.
2. Scroll to **Your apps** → click the **</>** (web) icon.
3. Give the app a nickname (e.g. `counter-pos-web`). You don't need Firebase Hosting checked yet.
4. Click **Register app**. Firebase shows you a `firebaseConfig` object — copy it.
5. In the repo, copy `js/firebase-config.example.js` to `js/firebase-config.js`:
   ```
   cp js/firebase-config.example.js js/firebase-config.js
   ```
6. Paste your real values into `js/firebase-config.js`, replacing the placeholders.

## 4. Turn on the Firebase backend in index.html

Open `index.html` and uncomment the four `<script>` lines just above
`<script src="js/app.js"></script>`:

```html
<script src="https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js"></script>
<script src="https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore-compat.js"></script>
<script src="js/firebase-config.js"></script>
<script src="js/firebase-storage.js"></script>
```

Order matters — the SDK scripts must load before `firebase-config.js`, which
must load before `firebase-storage.js`, which must load before `app.js`.

Reload the page and check the browser console: you should see
`Counter POS: connected to Firebase — shop data now syncs live across devices.`
If instead you see a warning that Firebase isn't initialized, double-check
`js/firebase-config.js` has your real values and is saved.

## 5. Set Firestore security rules

Go to **Firestore Database → Rules** in the console. For quick testing only,
you can start permissive:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /counterPosData/{document=**} {
      allow read, write: if true;
    }
  }
}
```

**This allows anyone with your web config to read and write all shop data.**
That's acceptable for a private demo, but before handing this to real
pop-up businesses, lock it down. Since this app doesn't have real user
accounts, the practical options are:

- **Simplest hardening:** enable [Firebase App Check](https://firebase.google.com/docs/app-check) to block requests that don't come from your deployed app, and keep the site itself behind a login (e.g. Firebase Hosting + a simple auth wall, or restrict it to a private URL).
- **Stronger:** add [Firebase Authentication](https://firebase.google.com/docs/auth) (e.g. email/password for the developer, or anonymous auth per device) and write rules that check `request.auth != null`, then move the admin/dev password checks server-side via [Cloud Functions](https://firebase.google.com/docs/functions) instead of comparing plaintext passwords in the browser.

For most pop-up-shop use cases, App Check plus not publishing your shop
codes publicly is a reasonable middle ground.

## 6. Deploy (optional but recommended)

Firebase Hosting works well since it's already part of your project:

```
npm install -g firebase-tools
firebase login
firebase init hosting
# When asked for your public directory, enter: counter-pos
# Configure as a single-page app: No
firebase deploy
```

This gives you a public URL (`https://your-project.web.app`) that any
pop-up can open on their phone or tablet.

## 7. Verify it's really synced

1. Open the deployed (or locally served) site in two different browsers or devices.
2. In one, log into the Developer panel and create a new client.
3. In the other, open the Developer panel — the new client should already be there.
4. Ring up a sale on the Counter screen in one tab; check that Admin → Dashboard in the other tab shows it after a refresh.

If both windows show the same data, the Firebase backend is working.

## Rolling back

If you ever want to go back to local-only storage, just re-comment (or
delete) the four Firebase `<script>` lines in `index.html`. `app.js` will
fall back to `localStorage` automatically — nothing else changes.
