import * as admin from 'firebase-admin'

if (!admin.apps.length) {
  const serviceAccountStr = process.env.FIREBASE_SERVICE_ACCOUNT
  if (serviceAccountStr) {
    const serviceAccount = JSON.parse(serviceAccountStr)
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: process.env.FIREBASE_PROJECT_ID,
    })
  } else if (process.env.NODE_ENV !== 'production') {
    // Dev/build fallback — no-op app so imports don't crash at build time
    admin.initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID || 'ht-admin-dev' })
  }
}

export const adminDb = admin.apps.length ? admin.firestore() : null as any
export const adminAuth = admin.apps.length ? admin.auth() : null as any
export default admin
