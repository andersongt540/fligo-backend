const db = require('../config/db');
const { obtenerDatosTasasBcv } = require('./configuracionController');
const { estadoSuscripcion } = require('../utils/suscripcion');

const PLANES = Object.freeze({
  diaria: { nombre: 'Diaria', precio_usd: 3, dias: 1 },
  semanal: { nombre: 'Semanal', precio_usd: 7, dias: 7 },
  mensual: { nombre: 'Mensual', precio_usd: 20, dias: 30 }
});

function pagoMovilDestino() {
  return {
    banco: process.env.PAGO_MOVIL_BANCO || '',
    telefono: process.env.PAGO_MOVIL_TELEFONO || '',
    documento: process.env.PAGO_MOVIL_DOCUMENTO || '',
    titular: process.env.PAGO_MOVIL_TITULAR || ''
  };
}

function destinoConfigurado(destino) {
  return Boolean(destino.banco && destino.telefono && destino.documento);
}

exports.obtenerSuscripcion = async (req, res) => {
  try {
    let tasaBcv = null;
    let errorTasa = null;
    try {
      tasaBcv = await obtenerDatosTasasBcv();
    } catch (error) {
      errorTasa = 'No se pudo consultar la tasa del BCV. Intenta actualizar más tarde.';
      console.error('Error en obtenerSuscripcion [BCV]:', error);
    }

    const [tenantResult, requestsResult] = await Promise.all([
      db.query(
        'SELECT plan, prueba_hasta, suscripcion_hasta FROM tenants WHERE id = $1',
        [req.user.tenant_id]
      ),
      db.query(
        `SELECT id, plan, precio_usd, tasa_bcv, monto_bs, referencia_pago, fecha_pago,
                estado, comentario_revision, creado_en, revisado_en
         FROM solicitudes_suscripcion
         WHERE tenant_id = $1
         ORDER BY creado_en DESC
         LIMIT 10`,
        [req.user.tenant_id]
      )
    ]);

    if (!tenantResult.rows.length) {
      return res.status(404).json({ success: false, error: 'Empresa no encontrada.' });
    }

    const destino = pagoMovilDestino();
    return res.json({
      success: true,
      data: {
        planes: Object.entries(PLANES).map(([id, plan]) => ({ id, ...plan })),
        tasa_bcv: tasaBcv,
        error_tasa: errorTasa,
        pago_movil: { destino, configurado: destinoConfigurado(destino) },
        es_admin_plataforma: req.user.rol === 'SUPERADMIN'
          || (req.user.rol === 'OWNER' && process.env.FLIGO_PLATFORM_TENANT_ID === req.user.tenant_id),
        suscripcion: {
          ...tenantResult.rows[0],
          ...estadoSuscripcion(tenantResult.rows[0])
        },
        solicitudes: requestsResult.rows
      }
    });
  } catch (error) {
    console.error('Error en obtenerSuscripcion [Fligo]:', error);
    return res.status(500).json({ success: false, error: 'No se pudo cargar el módulo de suscripciones.' });
  }
};

exports.crearSolicitud = async (req, res) => {
  const { plan, telefono, documento, monto_bs, referencia_pago, fecha_pago } = req.body;
  const oferta = PLANES[plan];

  if (!oferta) {
    return res.status(400).json({ success: false, error: 'Selecciona un plan válido.' });
  }
  if (typeof telefono !== 'string' || !/^[+\d\s().-]{7,24}$/.test(telefono.trim())) {
    return res.status(400).json({ success: false, error: 'Ingresa un teléfono válido.' });
  }
  if (typeof documento !== 'string' || !/^[VEJPG]?[-\s]?\d{5,12}$/i.test(documento.trim())) {
    return res.status(400).json({ success: false, error: 'Ingresa una cédula o documento válido.' });
  }
  if (typeof referencia_pago !== 'string' || !/^[a-z0-9-]{4,24}$/i.test(referencia_pago.trim())) {
    return res.status(400).json({ success: false, error: 'La referencia debe tener entre 4 y 24 caracteres alfanuméricos.' });
  }
  if (typeof fecha_pago !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(fecha_pago)
    || Number.isNaN(Date.parse(`${fecha_pago}T00:00:00Z`))
    || new Date(`${fecha_pago}T00:00:00Z`).toISOString().slice(0, 10) !== fecha_pago) {
    return res.status(400).json({ success: false, error: 'Ingresa la fecha del Pago Móvil.' });
  }
  if (!Number.isFinite(Number(monto_bs)) || Number(monto_bs) <= 0) {
    return res.status(400).json({ success: false, error: 'Ingresa un monto válido en bolívares.' });
  }

  const destino = pagoMovilDestino();
  if (!destinoConfigurado(destino)) {
    return res.status(503).json({ success: false, error: 'Fligo aún no ha configurado los datos para recibir pagos. Intenta más tarde.' });
  }

  let tasas;
  try {
    tasas = await obtenerDatosTasasBcv();
  } catch (error) {
    console.error('Error en crearSolicitudSuscripcion [BCV]:', error);
    return res.status(502).json({ success: false, error: 'No se pudo consultar la tasa del BCV para validar el monto. Intenta más tarde.' });
  }

  const montoEsperadoCentimos = Math.round(oferta.precio_usd * tasas.usd_ves * 100);
  const montoEnviadoCentimos = Math.round(Number(monto_bs) * 100);
  if (montoEsperadoCentimos !== montoEnviadoCentimos) {
    return res.status(400).json({
      success: false,
      error: `El monto no coincide con el precio del plan a la tasa BCV actual (${(montoEsperadoCentimos / 100).toFixed(2)} Bs.). Actualiza la tasa y confirma el pago.`
    });
  }

  try {
    const result = await db.query(
      `INSERT INTO solicitudes_suscripcion
         (tenant_id, plan, precio_usd, tasa_bcv, monto_bs, telefono_pagador, documento_pagador, referencia_pago, fecha_pago)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, plan, precio_usd, tasa_bcv, monto_bs, referencia_pago, fecha_pago, estado, creado_en`,
      [
        req.user.tenant_id,
        plan,
        oferta.precio_usd,
        tasas.usd_ves,
        montoEsperadoCentimos / 100,
        telefono.trim(),
        documento.trim().toUpperCase(),
        referencia_pago.trim(),
        fecha_pago
      ]
    );
    return res.status(201).json({
      success: true,
      message: 'Solicitud enviada. La suscripción se activará cuando se verifique el pago.',
      data: result.rows[0]
    });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ success: false, error: 'Ya existe una solicitud pendiente para tu empresa o esa referencia de pago ya fue enviada.' });
    }
    console.error('Error en crearSolicitudSuscripcion [Fligo]:', error);
    return res.status(500).json({ success: false, error: 'No se pudo enviar la solicitud de pago.' });
  }
};

exports.listarSolicitudesPendientes = async (req, res) => {
  try {
    const result = await db.query(
      `SELECT s.id, s.tenant_id, t.nombre_empresa, s.plan, s.precio_usd, s.tasa_bcv,
              s.monto_bs, s.telefono_pagador, s.documento_pagador, s.referencia_pago,
              s.fecha_pago, s.creado_en, u.nombre AS nombre_solicitante, u.email AS email_solicitante
       FROM solicitudes_suscripcion s
       JOIN tenants t ON t.id = s.tenant_id
       LEFT JOIN LATERAL (
         SELECT nombre, email
         FROM usuarios
         WHERE tenant_id = t.id AND rol = 'OWNER'
         ORDER BY creado_en ASC
         LIMIT 1
       ) u ON TRUE
       WHERE s.estado = 'PENDIENTE'
       ORDER BY s.creado_en ASC
       LIMIT 100`
    );
    return res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error('Error en listarSolicitudesPendientes [Fligo]:', error);
    return res.status(500).json({ success: false, error: 'No se pudieron cargar las solicitudes pendientes.' });
  }
};

exports.listarEmpresasPlataforma = async (req, res) => {
  try {
    const result = await db.query(
      `SELECT t.id, t.nombre_empresa, t.plan, t.activo, t.creado_en,
              t.prueba_hasta, t.suscripcion_hasta,
              CASE
                WHEN t.suscripcion_hasta > CURRENT_TIMESTAMP THEN 'ACTIVA'
                WHEN t.prueba_hasta > CURRENT_TIMESTAMP THEN 'PRUEBA'
                ELSE 'VENCIDA'
              END AS estado_suscripcion,
              GREATEST(
                0,
                CEIL(EXTRACT(EPOCH FROM (
                  CASE
                    WHEN t.suscripcion_hasta > CURRENT_TIMESTAMP THEN t.suscripcion_hasta
                    WHEN t.prueba_hasta > CURRENT_TIMESTAMP THEN t.prueba_hasta
                    ELSE CURRENT_TIMESTAMP
                  END - CURRENT_TIMESTAMP
                )) / 86400)::INTEGER
              ) AS dias_restantes,
              COALESCE((
                SELECT json_agg(json_build_object(
                  'id', u.id,
                  'nombre', u.nombre,
                  'email', u.email,
                  'rol', u.rol,
                  'activo', u.activo,
                  'sucursal', ti.nombre
                ) ORDER BY u.creado_en)
                FROM usuarios u
                LEFT JOIN tiendas ti ON ti.id = u.tienda_id AND ti.tenant_id = u.tenant_id
                WHERE u.tenant_id = t.id
              ), '[]'::json) AS cuentas,
              COALESCE((
                SELECT json_agg(json_build_object(
                  'id', ti.id,
                  'nombre', ti.nombre,
                  'activa', ti.activa,
                  'direccion', ti.direccion,
                  'telefono', ti.telefono
                ) ORDER BY ti.creado_en)
                FROM tiendas ti
                WHERE ti.tenant_id = t.id
              ), '[]'::json) AS sucursales
       FROM tenants t
       ORDER BY t.creado_en DESC`
    );
    return res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error('Error en listarEmpresasPlataforma [Fligo]:', error);
    return res.status(500).json({ success: false, error: 'No se pudieron cargar las empresas de la plataforma.' });
  }
};

exports.renovarSuscripcionEmpresa = async (req, res) => {
  const { plan } = req.body;
  const oferta = PLANES[plan];
  if (!oferta) {
    return res.status(400).json({ success: false, error: 'Selecciona un plan válido para renovar.' });
  }

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE tenants
       SET plan = $1,
           prueba_hasta = NULL,
           suscripcion_hasta = GREATEST(COALESCE(suscripcion_hasta, CURRENT_TIMESTAMP), CURRENT_TIMESTAMP)
             + ($2 * INTERVAL '1 day')
       WHERE id = $3
       RETURNING id, nombre_empresa, plan, prueba_hasta, suscripcion_hasta`,
      [plan, oferta.dias, req.params.tenantId]
    );
    if (!result.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, error: 'No se encontró la empresa que quieres renovar.' });
    }
    await client.query('COMMIT');
    return res.json({
      success: true,
      message: `Suscripción renovada por ${oferta.dias} ${oferta.dias === 1 ? 'día' : 'días'}.`,
      data: { ...result.rows[0], ...estadoSuscripcion(result.rows[0]) }
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error en renovarSuscripcionEmpresa [Fligo]:', error);
    return res.status(500).json({ success: false, error: 'No se pudo renovar la suscripción de la empresa.' });
  } finally {
    client.release();
  }
};

exports.revisarSolicitud = async (req, res) => {
  const { estado, comentario } = req.body;
  if (!['APROBADA', 'RECHAZADA'].includes(estado)) {
    return res.status(400).json({ success: false, error: 'La revisión debe aprobar o rechazar la solicitud.' });
  }
  if (comentario !== undefined && (typeof comentario !== 'string' || comentario.length > 500)) {
    return res.status(400).json({ success: false, error: 'El comentario no puede superar 500 caracteres.' });
  }

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const requestResult = await client.query(
      `SELECT id, tenant_id, plan
       FROM solicitudes_suscripcion
       WHERE id = $1 AND estado = 'PENDIENTE'
       FOR UPDATE`,
      [req.params.id]
    );
    if (!requestResult.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, error: 'La solicitud no existe o ya fue revisada.' });
    }
    const request = requestResult.rows[0];

    if (estado === 'APROBADA') {
      const duracionDias = PLANES[request.plan]?.dias;
      if (!duracionDias) {
        await client.query('ROLLBACK');
        return res.status(400).json({ success: false, error: 'El plan de esta solicitud ya no está disponible.' });
      }
      await client.query(
        `UPDATE tenants
         SET plan = $1,
             prueba_hasta = NULL,
             suscripcion_hasta = GREATEST(COALESCE(suscripcion_hasta, CURRENT_TIMESTAMP), CURRENT_TIMESTAMP) + ($2 * INTERVAL '1 day')
         WHERE id = $3`,
        [request.plan, duracionDias, request.tenant_id]
      );
    }

    const updated = await client.query(
      `UPDATE solicitudes_suscripcion
       SET estado = $1, comentario_revision = $2, revisada_por = $3, revisado_en = CURRENT_TIMESTAMP
       WHERE id = $4
       RETURNING id, tenant_id, plan, estado, revisado_en`,
      [estado, comentario?.trim() || null, req.user.user_id, request.id]
    );
    await client.query('COMMIT');
    return res.json({ success: true, data: updated.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error en revisarSolicitudSuscripcion [Fligo]:', error);
    return res.status(500).json({ success: false, error: 'No se pudo revisar la solicitud.' });
  } finally {
    client.release();
  }
};
