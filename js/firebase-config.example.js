// Copy this file to js/firebase-config.js and fill in the values from your
// Firebase project (Project settings → General → Your apps → SDK setup and
// configuration → Config). Never commit your real firebase-config.js if the
// repo is public and you'd rather keep these values private — see
// FIREBASE_SETUP.md for notes on that.

const firebaseConfig = {
  apiKey: "PASTE_YOUR_API_KEY",
  authDomain: "PASTE_YOUR_PROJECT.firebaseapp.com",
  projectId: "PASTE_YOUR_PROJECT_ID",
  storageBucket: "PASTE_YOUR_PROJECT.appspot.com",
  messagingSenderId: "PASTE_YOUR_SENDER_ID",
  appId: "PASTE_YOUR_APP_ID"
};

firebase.initializeApp(firebaseConfig);
