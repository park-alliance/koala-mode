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
