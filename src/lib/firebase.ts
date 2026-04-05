import { initializeApp, getApps, getApp } from 'firebase/app'
import { getFirestore } from 'firebase/firestore'
import { getAuth } from 'firebase/auth'
import { getStorage } from 'firebase/storage'

const firebaseConfig = {
  apiKey: 'AIzaSyAtInQ4MUF0ijCfjxsJFxAEmRlGi99HR6g',
  authDomain: 'ht-admin-cdcbe.firebaseapp.com',
  projectId: 'ht-admin-cdcbe',
  storageBucket: 'ht-admin-cdcbe.firebasestorage.app',
  messagingSenderId: '915764771626',
  appId: '1:915764771626:web:7e24c2519173c95e17bc53',
}

const firebaseApp = !getApps().length ? initializeApp(firebaseConfig) : getApp()

export const db = getFirestore(firebaseApp)
export const auth = getAuth(firebaseApp)
export const storage = getStorage(firebaseApp)
export default firebaseApp
