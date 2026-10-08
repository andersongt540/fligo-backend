const jwt = require('jsonwebtoken');
const db = require('../config/db');

const verificarToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Formato: Bearer <TOKEN>

  if (!token) {
    return res.status(401).json({ 
      success: false, 
      error: 'Acceso denegado a Fligo. Token de autenticación no proporcionado.' 
    });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // Inyecta { user_id, tenant_id, tienda_id, rol }

    const isPlatformAdmin = decoded.rol === 'SUPERADMIN'
      || (decoded.rol === 'OWNER'
        && process.env.FLIGO_PLATFORM_TENANT_ID
        && process.env.FLIGO_PLATFORM_TENANT_ID === decoded.tenant_id);
    const canManageExpiredSubscription = req.baseUrl === '/api/suscripciones'
      || (req.baseUrl === '/api/auth' && req.path === '/profile');
    if (isPlatformAdmin || canManageExpiredSubscription) return next();

    const subscription = await db.query(
      `SELECT prueba_hasta, suscripcion_hasta,
              (prueba_hasta > CURRENT_TIMESTAMP OR suscripcion_hasta > CURRENT_TIMESTAMP) AS acceso_activo
       FROM tenants
       WHERE id = $1`,
      [decoded.tenant_id]
    );
    if (!subscription.rows.length) {
      return res.status(403).json({ success: false, error: 'La empresa asociada a esta cuenta ya no está disponible.' });
    }
    if (!subscription.rows[0].acceso_activo) {
      return res.status(402).json({
        success: false,
        error: 'La prueba o suscripción venció. Activa un plan desde Suscripciones para recuperar el acceso.'
      });
    }
    next();
  } catch (err) {
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError' || err.name === 'NotBeforeError') {
      return res.status(403).json({
        success: false,
        error: 'Sesión en Fligo inválida o expirada. Inicie sesión nuevamente.'
      });
    }
    console.error('Error al validar acceso de suscripción [Fligo]:', err);
    return next(err);
  }
};

const autorizarRoles = (...rolesPermitidos) => {
  return (req, res, next) => {
    if (!req.user || !rolesPermitidos.includes(req.user.rol)) {
      return res.status(403).json({ 
        success: false, 
        error: 'No tienes permisos suficientes en Fligo para realizar esta acción.' 
      });
    }
    next();
  };
};

module.exports = {
  verificarToken,
  autorizarRoles
};