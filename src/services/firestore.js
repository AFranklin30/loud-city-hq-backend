const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    projectId: process.env.GCP_PROJECT_ID,
  });
}

const db = admin.firestore();

module.exports = { db, admin };