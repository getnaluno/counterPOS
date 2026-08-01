// Firebase Firestore-backed storage provider for Counter POS.
//
// Load this AFTER the Firebase SDK scripts and js/firebase-config.js.
// It defines window.CounterStorageProvider, which app.js automatically
// detects and uses instead of the built-in localStorage fallback — no
// other changes to app.js are needed.
//
// Every shop's data lives in one Firestore collection ("counterPosData"),
// one document per storage key (e.g. "pos-clients", "pos-shop-abc123").
// This mirrors the simple key/value model the app already uses, so the
// swap is a drop-in.

(function(){
  "use strict";

  if(typeof firebase === "undefined" || !firebase.apps || !firebase.apps.length){
    console.warn("Counter POS: firebase-storage.js loaded, but Firebase isn't initialized — check firebase-config.js.");
    return;
  }

  const db = firebase.firestore();
  const collection = db.collection("counterPosData");

  window.CounterStorageProvider = {
    async get(key, shared){
      try{
        const doc = await collection.doc(key).get();
        if(!doc.exists) return null;
        const data = doc.data();
        return { key, value: data.value, shared };
      }catch(e){
        console.error("Firestore get failed for", key, e);
        return null;
      }
    },

    async set(key, value, shared){
      try{
        await collection.doc(key).set({ value, updatedAt: Date.now() });
        return { key, value, shared };
      }catch(e){
        console.error("Firestore set failed for", key, e);
        return null;
      }
    },

    async delete(key, shared){
      try{
        await collection.doc(key).delete();
        return { key, deleted: true, shared };
      }catch(e){
        console.error("Firestore delete failed for", key, e);
        return null;
      }
    },

    async list(prefix, shared){
      try{
        // Firestore has no native "starts with" query on document IDs, so for
        // this app's small collection sizes we fetch and filter client-side.
        const snap = await collection.get();
        const keys = [];
        snap.forEach(doc => {
          if(!prefix || doc.id.indexOf(prefix) === 0) keys.push(doc.id);
        });
        return { keys };
      }catch(e){
        console.error("Firestore list failed for prefix", prefix, e);
        return { keys: [] };
      }
    }
  };

  console.info("Counter POS: connected to Firebase — shop data now syncs live across devices.");
})();
