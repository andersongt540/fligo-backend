const express = require('express');
const suscripcionController = require('../controllers/suscripcionController');
const { verificarToken, autorizarRoles } = require('../middlewares/authMiddleware');
const verificarAdminSuscripciones = require('../middlewares/verificarAdminSuscripciones');

const router = express.Router();

router.use(verificarToken);
router.get('/', suscripcionController.obtenerSuscripcion);
router.post('/solicitudes', autorizarRoles('OWNER'), suscripcionController.crearSolicitud);
router.get('/admin/solicitudes', verificarAdminSuscripciones, suscripcionController.listarSolicitudesPendientes);
router.post('/admin/solicitudes/:id/revisar', verificarAdminSuscripciones, suscripcionController.revisarSolicitud);

module.exports = router;
