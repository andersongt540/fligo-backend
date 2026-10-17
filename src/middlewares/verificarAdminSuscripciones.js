module.exports = (req, res, next) => {
  const platformTenantId = process.env.FLIGO_PLATFORM_TENANT_ID;
  const isSuperAdmin = req.user?.rol === 'SUPERADMIN';
  const isOwner = req.user?.rol === 'OWNER';
  const isPlatformOwner = platformTenantId ? (req.user?.tenant_id === platformTenantId) : true;

  if (!isSuperAdmin && !isOwner && !isPlatformOwner) {
    return res.status(403).json({
      success: false,
      error: 'No tienes permisos para administrar la plataforma.'
    });
  }
  next();
};
