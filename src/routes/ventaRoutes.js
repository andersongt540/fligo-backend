const express = require('express');
const router = express.Router();
const ventaController = require('../controllers/ventaController');
const { verificarToken } = require('../middlewares/authMiddleware');

router.use(verificarToken);

// Ventas y POS
router.post('/ventas', ventaController.registrarVenta);
router.get('/ventas', ventaController.obtenerVentas);
router.put('/ventas/:id/pago', ventaController.liquidarDeuda);

// Cotizaciones / Presupuestos
router.get('/cotizaciones', ventaController.obtenerCotizaciones);
router.post('/cotizaciones', ventaController.crearCotizacion);
router.put('/cotizaciones/:id/estado', ventaController.actualizarEstadoCotizacion);

module.exports = router;