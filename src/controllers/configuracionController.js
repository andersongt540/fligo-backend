const db = require('../config/db');

// 1. Obtener o crear configuración global de la empresa
exports.obtenerConfiguracion = async (req, res) => {
  const tenant_id = req.user.tenant_id;

  try {
    let result = await db.query(
      `SELECT c.*, t.nombre_empresa, t.plan 
       FROM configuracion_empresa c
       RIGHT JOIN tenants t ON c.tenant_id = t.id
       WHERE t.id = $1`,
      [tenant_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Empresa no encontrada.' });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('Error en obtenerConfiguracion [Fligo]:', error);
    res.status(500).json({ success: false, error: 'Error al obtener la configuración de la empresa.' });
  }
};

// 2. Actualizar configuración de la empresa (Moneda, Tasa, Impuestos)
exports.actualizarConfiguracion = async (req, res) => {
  const tenant_id = req.user.tenant_id;
  const { logo_url, moneda_principal, simbolo_moneda, impuesto_defecto, tasa_cambio, direccion_fiscal, documento_fiscal } = req.body;

  try {
    const result = await db.query(
      `INSERT INTO configuracion_empresa (tenant_id, logo_url, moneda_principal, simbolo_moneda, impuesto_defecto, tasa_cambio, direccion_fiscal, documento_fiscal)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (tenant_id) DO UPDATE SET
         logo_url = COALESCE(EXCLUDED.logo_url, configuracion_empresa.logo_url),
         moneda_principal = COALESCE(EXCLUDED.moneda_principal, configuracion_empresa.moneda_principal),
         simbolo_moneda = COALESCE(EXCLUDED.simbolo_moneda, configuracion_empresa.simbolo_moneda),
         impuesto_defecto = COALESCE(EXCLUDED.impuesto_defecto, configuracion_empresa.impuesto_defecto),
         tasa_cambio = COALESCE(EXCLUDED.tasa_cambio, configuracion_empresa.tasa_cambio),
         direccion_fiscal = COALESCE(EXCLUDED.direccion_fiscal, configuracion_empresa.direccion_fiscal),
         documento_fiscal = COALESCE(EXCLUDED.documento_fiscal, configuracion_empresa.documento_fiscal),
         actualizado_en = CURRENT_TIMESTAMP
       RETURNING *`,
      [tenant_id, logo_url || null, moneda_principal || 'USD', simbolo_moneda || '$', impuesto_defecto || 16.00, tasa_cambio || 1.0000, direccion_fiscal || null, documento_fiscal || null]
    );

    res.json({
      success: true,
      message: 'Configuración de la empresa actualizada con éxito en Fligo.',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error en actualizarConfiguracion [Fligo]:', error);
    res.status(500).json({ success: false, error: 'Error al guardar la configuración.' });
  }
};

// 3. Crear nueva Sucursal / Tienda en la Empresa
exports.crearTienda = async (req, res) => {
  const { nombre, direccion, telefono } = req.body;
  const tenant_id = req.user.tenant_id;

  if (!nombre) {
    return res.status(400).json({ success: false, error: 'El nombre de la tienda es obligatorio.' });
  }

  try {
    const result = await db.query(
      `INSERT INTO tiendas (tenant_id, nombre, direccion, telefono)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [tenant_id, nombre, direccion || null, telefono || null]
    );

    res.status(201).json({
      success: true,
      message: 'Nueva tienda registrada en Fligo.',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error en crearTienda [Fligo]:', error);
    res.status(500).json({ success: false, error: 'Error al crear la tienda.' });
  }
};

// 4. Listar todas las tiendas de la empresa
exports.obtenerTiendas = async (req, res) => {
  const tenant_id = req.user.tenant_id;

  try {
    const result = await db.query(
      `SELECT * FROM tiendas WHERE tenant_id = $1 AND activa = TRUE ORDER BY creado_en ASC`,
      [tenant_id]
    );

    res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error('Error en obtenerTiendas [Fligo]:', error);
    res.status(500).json({ success: false, error: 'Error al obtener la lista de tiendas.' });
  }
};