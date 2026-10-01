const express = require('express');
const router = express.Router();
const productoController = require('../controllers/productoController');
const { verificarToken, autorizarRoles } = require('../middlewares/authMiddleware');

router.use(verificarToken);

router.post('/', autorizarRoles('OWNER', 'MANAGER'), productoController.crearProducto);
router.get('/', productoController.obtenerProductos);
router.post('/inventario/ajustar', autorizarRoles('OWNER', 'MANAGER'), productoController.ajustarInventario);

module.exports = router;