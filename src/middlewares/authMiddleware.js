const jwt = require('jsonwebtoken');

const verificarToken = (req, res, next) => {
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
    next();
  } catch (err) {
    return res.status(403).json({ 
      success: false, 
      error: 'Sesión en Fligo inválida o expirada. Inicie sesión nuevamente.' 
    });
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