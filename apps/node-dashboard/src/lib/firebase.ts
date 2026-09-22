import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

/**
 * Firebase web config is not secret (access control is enforced by
 * Firestore security rules - see services/middleware/firestore.rules -
 * not by hiding this object), so a real sandbox default is checked in
 * here, same precedent as VITE_NODE_API_KEY's fallback in apiClient.ts.
 * Only used for the real-time live feed (lib/useApi.ts's useLiveFeed) -
 * everything else on this dashboard still talks to Middleware's REST API.
 */
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY ?? "AIzaSyDgaDRpYKYngQXEplUTy19Pkmmtp4AHHJ4",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? "qbads-fd1bf.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID ?? "qbads-fd1bf",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET ?? "qbads-fd1bf.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? "985383685266",
  appId: import.meta.env.VITE_FIREBASE_APP_ID ?? "1:985383685266:web:a1e1967f773ac2d78f2a4b",
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
