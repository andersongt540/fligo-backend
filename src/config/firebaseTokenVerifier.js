const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');

const app = initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID || 'fliigo' });

module.exports = {
  verifyIdToken: idToken => getAuth(app).verifyIdToken(idToken)
};
