const express = require('express');
const { rateLimit } = require('express-rate-limit');
const router = express.Router();
const authController = require('../controllers/authController');
const { verificarToken, autorizarRoles } = require('../middlewares/authMiddleware');
const sessionRateLimit = rateLimit({
	windowMs: 15 * 60 * 1000,
	limit: 30,
	standardHeaders: 'draft-8',
	legacyHeaders: false,
	message: { success: false, error: 'Demasiados intentos de autenticación. Inténtalo de nuevo más tarde.' }
});
const migrationRateLimit = rateLimit({
	windowMs: 15 * 60 * 1000,
	limit: 5,
	standardHeaders: 'draft-8',
	legacyHeaders: false,
	message: { success: false, error: 'Demasiados intentos de migración. Inténtalo de nuevo más tarde.' }
});

// Firebase verifies the identity; Fligo provisions and authorizes the local account.
router.post('/firebase-session', sessionRateLimit, authController.firebaseSession);
router.post('/migrate-legacy', migrationRateLimit, authController.migrateLegacyAccount);

// Rutas Protegidas en Fligo
router.get('/profile', verificarToken, authController.getProfile);
router.post('/empleados', verificarToken, autorizarRoles('OWNER', 'MANAGER'), authController.createEmpleado);

module.exports = router;