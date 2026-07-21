// ─────────────────────────────────────────────────────────────
// FIREBASE CONFIG — completează cu valorile din Firebase Console
// Firebase Console → Project Settings → Your apps → Web app → Config
// ─────────────────────────────────────────────────────────────
import { initializeApp } from "firebase/app";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyB6EpQT3XbLFCMCUtsGFBMN2AiKT199D7Q",
  authDomain: "blutracker.firebaseapp.com",
  projectId: "blutracker",
  storageBucket: "blutracker.firebasestorage.app",
  messagingSenderId: "492494979357",
  appId: "1:492494979357:web:e735f4d30580e27ef861f4"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// TMDB API key (opțional, pentru postere de fallback mai bune)
// Obții gratuit la https://www.themoviedb.org/settings/api
const TMDB_API_KEY = "8853001c1ed652ff848422f2f11cfa41"; // lasă gol dacă nu vrei
