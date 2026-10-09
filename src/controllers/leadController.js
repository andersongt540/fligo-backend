const db = require('../config/db');
const { activeClient, activeLead, activeStore, activeUser, employeeLead } = require('../utils/tenantValidation');

// 1. Crear un nuevo Prospecto (Lead)
exports.crearLead = async (req, res) => {
  const { nombre, email, telefono, empresa_origen, valor_estimado, tienda_id, vendedor_id, cliente_id } = req.body;
  const tenant_id = req.user.tenant_id;
  const targetTiendaId = tienda_id || req.user.tienda_id;
  const targetVendedorId = req.user.rol === 'EMPLOYEE' ? req.user.user_id : (vendedor_id || req.user.user_id);

  if (typeof nombre !== 'string' || !nombre.trim() || nombre.trim().length > 120) {
    return res.status(400).json({ success: false, error: 'El nombre del prospecto es obligatorio.' });
  }
  const valorValidado = Number(valor_estimado || 0);
  if (!Number.isFinite(valorValidado) || valorValidado < 0) {
    return res.status(400).json({ success: false, error: 'El valor estimado debe ser un monto válido no negativo.' });
  }

  try {
    if ((targetTiendaId && (!(await activeStore(db, tenant_id, targetTiendaId))
      || (req.user.rol === 'EMPLOYEE' && targetTiendaId !== req.user.tienda_id)))
      || !(await activeUser(db, tenant_id, targetVendedorId))
      || (cliente_id && !(await activeClient(db, tenant_id, cliente_id)))) {
      return res.status(400).json({ success: false, error: 'La sucursal, el vendedor o el cliente no pertenecen a la empresa.' });
    }

    const result = await db.query(
      `INSERT INTO leads (tenant_id, tienda_id, vendedor_id, cliente_id, nombre, email, telefono, empresa_origen, valor_estimado)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [tenant_id, targetTiendaId || null, targetVendedorId || null, cliente_id || null, nombre.trim(), email || null, telefono || null, empresa_origen || null, valorValidado]
    );

    res.status(201).json({
      success: true,
      message: 'Prospecto creado exitosamente en Fligo.',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error en crearLead [Fligo]:', error);
    res.status(500).json({ success: false, error: 'Error al registrar el prospecto.' });
  }
};

// 2. Obtener Pipeline / Embudo de Ventas (Agrupado por etapas o lista)
exports.obtenerPipeline = async (req, res) => {
  const tenant_id = req.user.tenant_id;
  const { tienda_id, vendedor_id, etapa } = req.query;

  let params = [tenant_id];
  let conditions = ['l.tenant_id = $1'];

  if (req.user.rol === 'EMPLOYEE') {
    params.push(req.user.user_id);
    conditions.push(`l.vendedor_id = $${params.length}`);
  } else {
    if (tienda_id) {
      params.push(tienda_id);
      conditions.push(`l.tienda_id = $${params.length}`);
    }
    if (vendedor_id) {
      params.push(vendedor_id);
      conditions.push(`l.vendedor_id = $${params.length}`);
    }
  }

  if (etapa) {
    params.push(etapa);
    conditions.push(`l.etapa = $${params.length}`);
  }

  try {
    const query = `
      SELECT l.*, 
                  u.nombre as nombre_vendedor,
                  t.nombre as nombre_tienda
      FROM leads l
                LEFT JOIN usuarios u ON l.vendedor_id = u.id AND u.tenant_id = l.tenant_id
                LEFT JOIN tiendas t ON l.tienda_id = t.id AND t.tenant_id = l.tenant_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY l.actualizado_en DESC
    `;

    const result = await db.query(query, params);

    res.json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    console.error('Error en obtenerPipeline [Fligo]:', error);
    res.status(500).json({ success: false, error: 'Error al consultar el embudo de ventas.' });
  }
};

// 3. Cambiar etapa del Lead (Mover en tablero Kanban)
exports.actualizarEtapaLead = async (req, res) => {
  const { id } = req.params;
  const { etapa, motivo_cierre } = req.body;
  const tenant_id = req.user.tenant_id;

  const etapasValidas = ['NUEVO', 'CONTACTADO', 'COTIZADO', 'NEGOCIACION', 'GANADO', 'PERDIDO'];
  if (!etapa || !etapasValidas.includes(etapa)) {
    return res.status(400).json({ success: false, error: 'Etapa del embudo no válida.' });
  }

  try {
    if (req.user.rol === 'EMPLOYEE' && !(await employeeLead(db, tenant_id, id, req.user.user_id))) {
      return res.status(404).json({ success: false, error: 'Prospecto no encontrado o sin permisos.' });
    }
    const result = await db.query(
      `UPDATE leads 
       SET etapa = $1, motivo_cierre = COALESCE($2, motivo_cierre), actualizado_en = CURRENT_TIMESTAMP
       WHERE id = $3 AND tenant_id = $4
       RETURNING *`,
      [etapa, motivo_cierre || null, id, tenant_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Prospecto no encontrado o sin permisos.' });
    }

    res.json({
      success: true,
      message: 'Etapa del prospecto actualizada en Fligo.',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error en actualizarEtapaLead [Fligo]:', error);
    res.status(500).json({ success: false, error: 'Error al actualizar el prospecto.' });
  }
};

// 4. Crear tarea de seguimiento para un Lead
exports.crearTareaLead = async (req, res) => {
  const { lead_id, titulo, descripcion, tipo, fecha_vencimiento } = req.body;
  const tenant_id = req.user.tenant_id;

  if (!lead_id || !titulo || !fecha_vencimiento) {
    return res.status(400).json({ success: false, error: 'Lead ID, título y fecha de vencimiento son requeridos.' });
  }

  try {
    if (!(await activeLead(db, tenant_id, lead_id))
      || (req.user.rol === 'EMPLOYEE' && !(await employeeLead(db, tenant_id, lead_id, req.user.user_id)))) {
      return res.status(404).json({ success: false, error: 'El prospecto no existe en la empresa o no está asignado a este usuario.' });
    }
    const result = await db.query(
      `INSERT INTO tareas_lead (tenant_id, lead_id, usuario_id, titulo, descripcion, tipo, fecha_vencimiento)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [tenant_id, lead_id, req.user.user_id, titulo, descripcion || null, tipo || 'LLAMADA', fecha_vencimiento]
    );

    res.status(201).json({
      success: true,
      message: 'Tarea asignada correctamente.',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error en crearTareaLead [Fligo]:', error);
    res.status(500).json({ success: false, error: 'Error al registrar la tarea.' });
  }
};