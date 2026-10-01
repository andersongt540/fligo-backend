const express = require('express');
const router = express.Router();
const configuracionController = require('../controllers/configuracionController');
const { verificarToken, autorizarRoles } = require('../middlewares/authMiddleware');

router.use(verificarToken);

// Configuración general de la empresa
router.get('/', configuracionController.obtenerConfiguracion);
router.put('/', autorizarRoles('OWNER'), configuracionController.actualizarConfiguracion);

// Gestión de Tiendas / Sucursales
router.get('/tiendas', configuracionController.obtenerTiendas);
router.post('/tiendas', autorizarRoles('OWNER'), configuracionController.crearTienda);

module.exports = router;