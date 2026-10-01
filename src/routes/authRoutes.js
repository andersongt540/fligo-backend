const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { verificarToken, autorizarRoles } = require('../middlewares/authMiddleware');

// Rutas Públicas de Autenticación
router.post('/register-tenant', authController.registerTenant);
router.post('/login', authController.login);

// Rutas Protegidas en Fligo
router.get('/profile', verificarToken, authController.getProfile);
router.post('/empleados', verificarToken, autorizarRoles('OWNER', 'MANAGER'), authController.createEmpleado);

module.exports = router;