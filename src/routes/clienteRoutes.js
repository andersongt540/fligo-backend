const express = require('express');
const router = express.Router();
const clienteController = require('../controllers/clienteController');
const { verificarToken, autorizarRoles } = require('../middlewares/authMiddleware');

// Todas las rutas de clientes requieren estar autenticado en Fligo
router.use(verificarToken);

router.post('/', clienteController.crearCliente);
router.get('/', clienteController.obtenerClientes);
router.get('/:id', clienteController.obtenerClientePorId);
router.put('/:id', clienteController.actualizarCliente);
router.delete('/:id', autorizarRoles('OWNER', 'MANAGER'), clienteController.eliminarCliente);

module.exports = router;