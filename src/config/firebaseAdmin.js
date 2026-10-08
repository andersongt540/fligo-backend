const { cert, initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');

let initializedApp;

function getApp() {
  if (initializedApp) return initializedApp;
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');

  if (!projectId || !clientEmail || !privateKey) {
    const error = new Error('FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL y FIREBASE_PRIVATE_KEY deben configurarse en Render.');
    error.code = 'firebase/configuration-error';
    throw error;
  }

  initializedApp = initializeApp({
    credential: cert({ projectId, clientEmail, privateKey }),
    projectId
  });
  return initializedApp;
}

module.exports = {
  auth: () => getAuth(getApp())
};
