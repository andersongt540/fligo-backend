const db = require('../config/db');

// 1. Registrar una interacción/comunicación en la bitácora
exports.registrarInteraccion = async (req, res) => {
  const { cliente_id, lead_id, canal, mensaje, metadata } = req.body;
  const tenant_id = req.user.tenant_id;

  if (!canal || !mensaje) {
    return res.status(400).json({ success: false, error: 'El canal y el mensaje son obligatorios.' });
  }

  if (!cliente_id && !lead_id) {
    return res.status(400).json({ success: false, error: 'Debes asociar la interacción a un cliente o prospecto.' });
  }

  try {
    const result = await db.query(
      `INSERT INTO interacciones (tenant_id, cliente_id, lead_id, usuario_id, canal, mensaje, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [tenant_id, cliente_id || null, lead_id || null, req.user.user_id, canal, mensaje, metadata ? JSON.stringify(metadata) : null]
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
    let query = `
      SELECT i.*, u.nombre as nombre_usuario
      FROM interacciones i
      LEFT JOIN usuarios u ON i.usuario_id = u.id
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