const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { verificarToken, autorizarRoles } = require('../middlewares/authMiddleware');

// Firebase verifies the identity; Fligo provisions and authorizes the local account.
router.post('/firebase-session', authController.firebaseSession);
router.post('/migrate-legacy', authController.migrateLegacyAccount);

// Rutas Protegidas en Fligo
router.get('/profile', verificarToken, authController.getProfile);
router.post('/empleados', verificarToken, autorizarRoles('OWNER', 'MANAGER'), authController.createEmpleado);

module.exports = router;