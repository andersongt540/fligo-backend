const express = require('express');
const router = express.Router();
const comunicacionController = require('../controllers/comunicacionController');
const { verificarToken } = require('../middlewares/authMiddleware');

router.use(verificarToken);

router.post('/', comunicacionController.registrarInteraccion);
router.get('/', comunicacionController.obtenerInteracciones);

module.exports = router;