const express = require('express');
const router = express.Router();
const ventaController = require('../controllers/ventaController');
const { verificarToken } = require('../middlewares/authMiddleware');

router.use(verificarToken);

// Ventas y POS
router.post('/ventas', ventaController.registrarVenta);
router.get('/ventas', ventaController.obtenerVentas);

// Cotizaciones / Presupuestos
router.post('/cotizaciones', ventaController.crearCotizacion);

module.exports = router;