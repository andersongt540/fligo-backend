const express = require('express');
const router = express.Router();
const reporteController = require('../controllers/reporteController');
const { verificarToken, autorizarRoles } = require('../middlewares/authMiddleware');

router.use(verificarToken);

// Endpoint accesible para todos los usuarios autenticados (filtra según su rol/tienda)
router.get('/dashboard', reporteController.obtenerDashboardSummary);

// Endpoints gerenciales (Solo OWNER y MANAGER)
router.get('/tiendas', autorizarRoles('OWNER', 'MANAGER'), reporteController.obtenerVentasPorTienda);
router.get('/vendedores', autorizarRoles('OWNER', 'MANAGER'), reporteController.obtenerRankingVendedores);

module.exports = router;