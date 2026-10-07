module.exports = (req, res, next) => {
  const platformTenantId = process.env.FLIGO_PLATFORM_TENANT_ID;
  const isSuperAdmin = req.user?.rol === 'SUPERADMIN';
  const isPlatformOwner = req.user?.rol === 'OWNER'
    && platformTenantId
    && req.user.tenant_id === platformTenantId;

  if (!isSuperAdmin && !isPlatformOwner) {
    return res.status(403).json({
      success: false,
      error: 'No tienes permisos para revisar pagos de suscripción.'
    });
  }
  next();
};
