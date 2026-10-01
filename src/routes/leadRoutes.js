const express = require('express');
const router = express.Router();
const leadController = require('../controllers/leadController');
const { verificarToken } = require('../middlewares/authMiddleware');

router.use(verificarToken);

router.post('/', leadController.crearLead);
router.get('/', leadController.obtenerPipeline);
router.put('/:id/etapa', leadController.actualizarEtapaLead);
router.post('/tareas', leadController.crearTareaLead);

module.exports = router;