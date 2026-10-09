const db = require('../config/db');
const { activeClient, activeLead, employeeClient, employeeLead } = require('../utils/tenantValidation');

// 1. Registrar una interacción/comunicación en la bitácora
exports.registrarInteraccion = async (req, res) => {
  const { cliente_id, lead_id, canal, mensaje, metadata } = req.body;
  const tenant_id = req.user.tenant_id;

  const canalesPermitidos = new Set(['WHATSAPP', 'EMAIL', 'LLAMADA', 'NOTA_INTERNA']);
  if (!canalesPermitidos.has(canal) || typeof mensaje !== 'string' || !mensaje.trim() || mensaje.length > 10000) {
    return res.status(400).json({ success: false, error: 'El canal y el mensaje son obligatorios.' });
  }

  if (!cliente_id && !lead_id) {
    return res.status(400).json({ success: false, error: 'Debes asociar la interacción a un cliente o prospecto.' });
  }

  try {
    if ((cliente_id && !(await activeClient(db, tenant_id, cliente_id)))
      || (lead_id && !(await activeLead(db, tenant_id, lead_id)))
      || (req.user.rol === 'EMPLOYEE' && cliente_id && !(await employeeClient(db, tenant_id, cliente_id, req.user.tienda_id)))
      || (req.user.rol === 'EMPLOYEE' && lead_id && !(await employeeLead(db, tenant_id, lead_id, req.user.user_id)))
      || (cliente_id && lead_id)) {
      return res.status(400).json({ success: false, error: 'Asocia la interacción a un único cliente o prospecto de la empresa.' });
    }
    const result = await db.query(
      `INSERT INTO interacciones (tenant_id, cliente_id, lead_id, usuario_id, canal, mensaje, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [tenant_id, cliente_id || null, lead_id || null, req.user.user_id, canal, mensaje.trim(), metadata ? JSON.stringify(metadata) : null]
    );

    res.status(201).json({
      success: true,
      message: 'Interacción registrada en la bitácora de Fligo.',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error en registrarInteraccion [Fligo]:', error);
    res.status(500).json({ success: false, error: 'Error al guardar la comunicación.' });
  }
};

// 2. Obtener la bitácora de interacciones de un cliente o lead
exports.obtenerInteracciones = async (req, res) => {
  const tenant_id = req.user.tenant_id;
  const { cliente_id, lead_id } = req.query;

  if (!cliente_id && !lead_id) {
    return res.status(400).json({ success: false, error: 'Indica cliente_id o lead_id para consultar la bitácora.' });
  }

  try {
    if ((req.user.rol === 'EMPLOYEE' && cliente_id && !(await employeeClient(db, tenant_id, cliente_id, req.user.tienda_id)))
      || (req.user.rol === 'EMPLOYEE' && lead_id && !(await employeeLead(db, tenant_id, lead_id, req.user.user_id)))) {
      return res.status(404).json({ success: false, error: 'No se encontró el registro solicitado.' });
    }
    let query = `
      SELECT i.*, u.nombre as nombre_usuario
      FROM interacciones i
      LEFT JOIN usuarios u ON i.usuario_id = u.id AND u.tenant_id = i.tenant_id
      WHERE i.tenant_id = $1
    `;
    let params = [tenant_id];

    if (cliente_id) {
      params.push(cliente_id);
      query += ` AND i.cliente_id = $${params.length}`;
    } else if (lead_id) {
      params.push(lead_id);
      query += ` AND i.lead_id = $${params.length}`;
    }

    query += ' ORDER BY i.creado_en DESC';

    const result = await db.query(query, params);

    res.json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    console.error('Error en obtenerInteracciones [Fligo]:', error);
    res.status(500).json({ success: false, error: 'Error al consultar el historial de comunicación.' });
  }
};