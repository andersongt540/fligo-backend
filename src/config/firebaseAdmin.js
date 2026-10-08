const admin = require('firebase-admin');

let initializedApp;

function getApp() {
  if (initializedApp) return initializedApp;
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error('FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL y FIREBASE_PRIVATE_KEY deben configurarse en Render.');
  }

  initializedApp = admin.initializeApp({
    credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
    projectId
  });
  return initializedApp;
}

module.exports = {
  auth: () => getApp().auth()
};
