/**
 * Firebase Realtime Database Configuration & Initialization
 * 
 * Alertify SOS Emergency Application
 * 
 * Replace the placeholder values in `firebaseConfig` with your actual 
 * Firebase project keys from the Firebase Console (https://console.firebase.google.com).
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { 
  getDatabase, 
  ref, 
  set, 
  push, 
  onValue, 
  remove, 
  child, 
  get,
  off
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

// Firebase Configuration Object - PASTE YOUR CONFIG HERE
const firebaseConfig = {
  apiKey: "AIzaSyDxYdboHTYT674i0GdElIm2_IgoAF5JzZY",
  authDomain: "alertify-eee05.firebaseapp.com",
  databaseURL: "https://alertify-eee05-default-rtdb.firebaseio.com",
  projectId: "alertify-eee05",
  storageBucket: "alertify-eee05.firebasestorage.app",
  messagingSenderId: "75136802725",
  appId: "1:75136802725:web:42957a01a36bc1d024d24c"
};

// Check if Firebase setup is still configured with the default placeholders
const isFirebasePlaceholder = 
  firebaseConfig.apiKey === "YOUR_API_KEY" || 
  firebaseConfig.databaseURL.includes("YOUR_DATABASE_URL") ||
  firebaseConfig.projectId === "YOUR_PROJECT_ID";

let db = null;
let app = null;

if (!isFirebasePlaceholder) {
  try {
    app = initializeApp(firebaseConfig);
    db = getDatabase(app);
    console.log("🔥 Firebase initialized successfully. Sync mode: cloud database.");
  } catch (error) {
    console.error("❌ Firebase initialization failed:", error);
  }
} else {
  console.warn("⚠️ Alertify running in LOCAL mode. Fallback storage (LocalStorage) will be used for contacts and logs.");
}

// Export the database instance, utility methods, and placeholder status
export { 
  db, 
  isFirebasePlaceholder, 
  ref, 
  set, 
  push, 
  onValue, 
  remove, 
  child, 
  get,
  off 
};

// Twilio Cloud API Configuration - Replace with your credentials for automated calls
const twilioConfig = {
  accountSid: "AC30b84d8da5028310f97347b6babd4356",
  authToken: "e810fe411c650c1e41bf5eed1f6ce680",
  twilioNumber: "+17692474423"
};

const isTwilioConfigured = 
  twilioConfig.accountSid !== "YOUR_TWILIO_ACCOUNT_SID" && 
  twilioConfig.authToken !== "YOUR_TWILIO_AUTH_TOKEN" && 
  twilioConfig.twilioNumber !== "YOUR_TWILIO_PHONE_NUMBER";

export { twilioConfig, isTwilioConfigured };
