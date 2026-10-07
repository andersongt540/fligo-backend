const db = require('../config/db');
const { obtenerDatosTasasBcv } = require('./configuracionController');

// 1. Crear Venta Directa (POS Móvil / Web) con descuento automático de Stock
exports.registrarVenta = async (req, res) => {
  const { cliente_id, productos, metodo_pago, pagos, descuento = 0, impuesto = 0, notas, tienda_id, cotizacion_id } = req.body;
  const tenant_id = req.user.tenant_id;
  const targetTiendaId = tienda_id || req.user.tienda_id;
  const metodosPermitidos = new Set(['EFECTIVO', 'PAGO_MOVIL', 'TRANSFERENCIA', 'TARJETA', 'DIVISA']);
  let pagosValidados = null;
  let tasaPago = null;
  let igtfUsd = 0;

  if (pagos !== undefined) {
    if (!Array.isArray(pagos) || pagos.length === 0 || pagos.some(pago =>
      !pago || !metodosPermitidos.has(pago.metodo_pago) || !Number.isFinite(Number(pago.monto)) || Number(pago.monto) <= 0
      || (pago.moneda !== undefined && !['VES', 'USD', 'EUR'].includes(pago.moneda))
      || (pago.metodo_pago === 'DIVISA' && pago.moneda === 'VES')
      || (pago.metodo_pago !== 'DIVISA' && pago.moneda !== undefined && pago.moneda !== 'VES')
    )) {
      return res.status(400).json({ success: false, error: 'Debes indicar al menos un método de pago válido y su monto.' });
    }
    try {
      tasaPago = await obtenerDatosTasasBcv();
    } catch (error) {
      console.error('Error en registrarVenta [BCV]:', error);
      return res.status(502).json({ success: false, error: 'No se pudo consultar la tasa BCV para convertir el pago y calcular el IGTF.' });
    }
    pagosValidados = pagos.map(pago => {
      const legacyUsdAmount = pago.moneda === undefined;
      const moneda = legacyUsdAmount ? 'USD' : pago.moneda;
      const monto = Number(pago.monto);
      const tasaMoneda = moneda === 'EUR' ? tasaPago.eur_ves : tasaPago.usd_ves;
      const montoBsCentimos = legacyUsdAmount
        ? Math.round(monto * tasaPago.usd_ves * 100)
        : moneda === 'VES'
          ? Math.round(monto * 100)
          : Math.round(monto * tasaMoneda * 100);
      const igtfBsCentimos = pago.metodo_pago === 'DIVISA' ? Math.round(montoBsCentimos * 0.03) : 0;
      const montoUsdCentimos = Math.round((montoBsCentimos + igtfBsCentimos) / tasaPago.usd_ves);
      igtfUsd += igtfBsCentimos / 100 / tasaPago.usd_ves;
      return {
        metodo_pago: pago.metodo_pago,
        moneda,
        monto,
        monto_usd: montoUsdCentimos / 100,
        monto_bs_centimos: montoBsCentimos,
        igtf_bs_centimos: igtfBsCentimos
      };
    });
  }

  if (!productos || !Array.isArray(productos) || productos.length === 0) {
    return res.status(400).json({ success: false, error: 'La venta debe contener al menos un producto.' });
  }

  if (!metodo_pago && !pagosValidados) {
    return res.status(400).json({ success: false, error: 'Debes especificar el método de pago.' });
  }

  if (!targetTiendaId) {
    return res.status(400).json({ success: false, error: 'Debes especificar la tienda donde se realiza la venta.' });
  }

  const client = await db.pool.connect();

  try {
    await client.query('BEGIN');

    let subtotalCalculado = 0;
    const itemsProcesados = [];

    // Validar productos y verificar stock disponible en la tienda
    for (const item of productos) {
      const prodRes = await client.query(
        `SELECT p.id, p.precio_base, COALESCE(i.stock_actual, 0) as stock_actual
         FROM productos p
         LEFT JOIN inventario_tienda i ON p.id = i.producto_id AND i.tienda_id = $1
         WHERE p.id = $2 AND p.tenant_id = $3 AND p.activo = TRUE
         FOR UPDATE OF p`,
        [targetTiendaId, item.producto_id, tenant_id]
      );

      if (prodRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ success: false, error: `Producto ID ${item.producto_id} no encontrado en la empresa.` });
      }

      const prod = prodRes.rows[0];

      if (prod.stock_actual < item.cantidad) {
        await client.query('ROLLBACK');
        return res.status(400).json({ 
          success: false, 
          error: `Stock insuficiente para el producto ID ${item.producto_id}. Disponible: ${prod.stock_actual}, Solicitado: ${item.cantidad}` 
        });
      }

      const precioUnitario = item.precio_unitario !== undefined ? item.precio_unitario : parseFloat(prod.precio_base);
      const subtotalItem = precioUnitario * item.cantidad;
      subtotalCalculado += subtotalItem;

      itemsProcesados.push({
        producto_id: prod.id,
        cantidad: item.cantidad,
        precio_unitario: precioUnitario,
        subtotal: subtotalItem,
        stock_actual: prod.stock_actual
      });
    }

    const impuestoBase = Number(impuesto);
    const descuentoVenta = Number(descuento);
    if (!Number.isFinite(impuestoBase) || impuestoBase < 0 || !Number.isFinite(descuentoVenta) || descuentoVenta < 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, error: 'El impuesto y el descuento deben ser montos válidos no negativos.' });
    }
    const totalCalculado = subtotalCalculado + impuestoBase + igtfUsd - descuentoVenta;
    if (pagosValidados) {
      const montoPagadoCentavos = pagosValidados.reduce((total, pago) => total + Math.round(pago.monto_usd * 100), 0);
      if (Math.abs(montoPagadoCentavos - Math.round(totalCalculado * 100)) > 1) {
        await client.query('ROLLBACK');
        return res.status(400).json({ success: false, error: 'La suma de los pagos, incluido el IGTF de la divisa, debe coincidir con el total de la venta.' });
      }
    }
    const metodoPagoVenta = pagosValidados
      ? pagosValidados.length === 1
        ? pagosValidados[0].metodo_pago === 'DIVISA' ? `DIVISA ${pagosValidados[0].moneda}` : pagosValidados[0].metodo_pago
        : 'MIXTO'
      : metodo_pago;
    const notasVenta = pagosValidados
      ? [
        notas,
        `Pagos: ${pagosValidados.map(pago => `${pago.metodo_pago}${pago.metodo_pago === 'DIVISA' ? ` ${pago.moneda}` : ''} ${pago.monto.toFixed(2)} ${pago.moneda}`).join('; ')}.`,
        igtfUsd > 0 ? `IGTF 3% sobre pagos en divisa: Bs. ${(pagosValidados.reduce((total, pago) => total + pago.igtf_bs_centimos, 0) / 100).toFixed(2)} (equivalente USD ${igtfUsd.toFixed(2)}).` : null
      ].filter(Boolean).join('\n')
      : notas || null;

    // Insertar Cabecera de Venta
    const ventaRes = await client.query(
      `INSERT INTO ventas (tenant_id, tienda_id, cliente_id, usuario_id, cotizacion_id, metodo_pago, subtotal, impuesto, descuento, total, notas)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [tenant_id, targetTiendaId, cliente_id || null, req.user.user_id, cotizacion_id || null, metodoPagoVenta, subtotalCalculado, impuestoBase + igtfUsd, descuentoVenta, totalCalculado, notasVenta]
    );

    const nuevaVenta = ventaRes.rows[0];

    // Insertar Detalle y Descontar Inventario
    for (const item of itemsProcesados) {
      await client.query(
        `INSERT INTO detalle_venta (venta_id, producto_id, cantidad, precio_unitario, subtotal)
         VALUES ($1, $2, $3, $4, $5)`,
        [nuevaVenta.id, item.producto_id, item.cantidad, item.precio_unitario, item.subtotal]
      );

      const nuevoStock = item.stock_actual - item.cantidad;

      // Actualizar Stock de la Tienda
      await client.query(
        `UPDATE inventario_tienda
         SET stock_actual = $1, actualizado_en = CURRENT_TIMESTAMP
         WHERE tenant_id = $2 AND tienda_id = $3 AND producto_id = $4`,
        [nuevoStock, tenant_id, targetTiendaId, item.producto_id]
      );

      // Registrar movimiento de auditoría
      await client.query(
        `INSERT INTO movimientos_inventario (tenant_id, tienda_id, producto_id, usuario_id, tipo_movimiento, cantidad, stock_resultante, motivo)
         VALUES ($1, $2, $3, $4, 'VENTA', $5, $6, $7)`,
        [tenant_id, targetTiendaId, item.producto_id, req.user.user_id, item.cantidad, nuevoStock, `Venta registrada ID: ${nuevaVenta.id}`]
      );
    }

    // Si provenía de una cotización, marcarla como CONVERTIDA
    if (cotizacion_id) {
      await client.query(
        `UPDATE cotizaciones SET estado = 'CONVERTIDA' WHERE id = $1 AND tenant_id = $2`,
        [cotizacion_id, tenant_id]
      );
    }

    await client.query('COMMIT');

    res.status(201).json({
      success: true,
      message: 'Venta registrada con éxito en Fligo.',
      data: nuevaVenta
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error en registrarVenta [Fligo]:', error);
    res.status(500).json({ success: false, error: 'Error al procesar la venta.' });
  } finally {
    client.release();
  }
};

// 2. Crear Cotización / Presupuesto
exports.crearCotizacion = async (req, res) => {
  const { cliente_id, productos, descuento = 0, impuesto = 0, notas, tienda_id } = req.body;
  const tenant_id = req.user.tenant_id;
  const targetTiendaId = tienda_id || req.user.tienda_id;

  if (!productos || !Array.isArray(productos) || productos.length === 0) {
    return res.status(400).json({ success: false, error: 'La cotización debe incluir al menos un producto.' });
  }

  const client = await db.pool.connect();

  try {
    await client.query('BEGIN');

    let subtotalCalculado = 0;
    const itemsProcesados = [];

    for (const item of productos) {
      const prodRes = await client.query(
        `SELECT id, precio_base FROM productos WHERE id = $1 AND tenant_id = $2 AND activo = TRUE`,
        [item.producto_id, tenant_id]
      );

      if (prodRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ success: false, error: `Producto ID ${item.producto_id} no encontrado.` });
      }

      const prod = prodRes.rows[0];
      const precioUnitario = item.precio_unitario !== undefined ? item.precio_unitario : parseFloat(prod.precio_base);
      const subtotalItem = precioUnitario * item.cantidad;
      subtotalCalculado += subtotalItem;

      itemsProcesados.push({
        producto_id: prod.id,
        cantidad: item.cantidad,
        precio_unitario: precioUnitario,
        subtotal: subtotalItem
      });
    }

    const totalCalculado = subtotalCalculado + parseFloat(impuesto) - parseFloat(descuento);

    const cotRes = await client.query(
      `INSERT INTO cotizaciones (tenant_id, tienda_id, cliente_id, usuario_id, subtotal, impuesto, descuento, total, notas)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [tenant_id, targetTiendaId, cliente_id || null, req.user.user_id, subtotalCalculado, impuesto, descuento, totalCalculado, notas || null]
    );

    const nuevaCotizacion = cotRes.rows[0];

    for (const item of itemsProcesados) {
      await client.query(
        `INSERT INTO detalle_cotizacion (cotizacion_id, producto_id, cantidad, precio_unitario, subtotal)
         VALUES ($1, $2, $3, $4, $5)`,
        [nuevaCotizacion.id, item.producto_id, item.cantidad, item.precio_unitario, item.subtotal]
      );
    }

    await client.query('COMMIT');

    res.status(201).json({
      success: true,
      message: 'Cotización creada exitosamente en Fligo.',
      data: nuevaCotizacion
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error en crearCotizacion [Fligo]:', error);
    res.status(500).json({ success: false, error: 'Error al generar la cotización.' });
  } finally {
    client.release();
  }
};

// 3. Listar Ventas por Tienda con Filtros
exports.obtenerVentas = async (req, res) => {
  const tenant_id = req.user.tenant_id;
  const { tienda_id, fecha_inicio, fecha_fin, page = 1, limit = 20 } = req.query;

  const targetTiendaId = (req.user.rol === 'EMPLOYEE' && req.user.tienda_id)
    ? req.user.tienda_id
    : (tienda_id || req.user.tienda_id);

  const offset = (page - 1) * limit;
  let params = [tenant_id];
  let conditions = ['v.tenant_id = $1'];

  if (targetTiendaId) {
    params.push(targetTiendaId);
    conditions.push(`v.tienda_id = $${params.length}`);
  }

  if (fecha_inicio) {
    params.push(fecha_inicio);
    conditions.push(`v.creado_en >= $${params.length}`);
  }

  if (fecha_fin) {
    params.push(fecha_fin);
    conditions.push(`v.creado_en <= $${params.length}`);
  }

  const whereClause = conditions.join(' AND ');

  try {
    const query = `
      SELECT v.*, 
             c.nombre as nombre_cliente, 
             u.nombre as nombre_vendedor,
             t.nombre as nombre_tienda
      FROM ventas v
      LEFT JOIN clientes c ON v.cliente_id = c.id
      LEFT JOIN usuarios u ON v.usuario_id = u.id
      LEFT JOIN tiendas t ON v.tienda_id = t.id
      WHERE ${whereClause}
      ORDER BY v.creado_en DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `;

    const result = await db.query(query, [...params, limit, offset]);

    res.json({
      success: true,
      data: result.rows,
      page: parseInt(page),
      limit: parseInt(limit)
    });

  } catch (error) {
    console.error('Error en obtenerVentas [Fligo]:', error);
    res.status(500).json({ success: false, error: 'Error al consultar el historial de ventas.' });
  }
};