const firebaseConfig = {
    apiKey: "AIzaSyCaMMlCOhpKU-vbNHadwVfWX0py_zqQCzQ",
    authDomain: "koala-mode.firebaseapp.com",
    projectId: "koala-mode",
    storageBucket: "koala-mode.firebasestorage.app",
    messagingSenderId: "923644139432",
    appId: "1:923644139432:web:1803595306b140f36d6f9d",
    measurementId: "G-ZYT0MSYDJ8",
};

firebase.initializeApp(firebaseConfig);

const auth = firebase.auth();
const db = firebase.firestore();

// Lets reads serve from local cache when offline and queues writes made
// offline (e.g. spotty gym wifi) to sync automatically once back online,
// instead of initialLoadAndSync()'s .get() calls hanging/failing and
// syncWrite()'s .set() calls silently dropping.
db.enablePersistence({ synchronizeTabs: true }).catch(err => {
    console.warn('Firestore offline persistence not enabled:', err.code);
});
