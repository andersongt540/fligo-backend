const db = require('../config/db');
const { obtenerDatosTasasBcv } = require('./configuracionController');

// 1. Crear Venta Directa (POS Móvil / Web) con descuento automático de Stock
exports.registrarVenta = async (req, res) => {
  const { cliente_id, productos, metodo_pago, pagos, vuelto, descuento = 0, impuesto = 0, notas, tienda_id, cotizacion_id } = req.body;
  const tenant_id = req.user.tenant_id;
  const targetTiendaId = tienda_id || req.user.tienda_id;
  const metodosPermitidos = new Set(['EFECTIVO', 'PAGO_MOVIL', 'TRANSFERENCIA', 'TARJETA', 'DIVISA']);
  let pagosValidados = null;
  let tasaPago = null;
  let igtfUsd = 0;
  let vueltoValidado = null;

  if (vuelto !== undefined) {
    const legacyChange = vuelto && ['VES', 'USD'].includes(vuelto.moneda);
    const usd = Number(legacyChange ? (vuelto.moneda === 'USD' ? vuelto.monto : 0) : vuelto && vuelto.usd !== undefined ? vuelto.usd : 0);
    const ves = Number(legacyChange ? (vuelto.moneda === 'VES' ? vuelto.monto : 0) : vuelto && vuelto.ves !== undefined ? vuelto.ves : 0);
    if (!vuelto || !Number.isFinite(usd) || usd < 0 || !Number.isFinite(ves) || ves < 0) {
      return res.status(400).json({ success: false, error: 'El vuelto en dólares y bolívares debe tener montos válidos no negativos.' });
    }
    vueltoValidado = { usd, ves };
  }

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
      const montoUsdCentimos = Math.round(montoBsCentimos / tasaPago.usd_ves);
      return {
        metodo_pago: pago.metodo_pago,
        moneda,
        monto,
        monto_usd: montoUsdCentimos / 100,
        monto_usd_centimos: montoUsdCentimos,
        monto_bs_centimos: montoBsCentimos,
        igtf_bs_centimos: 0
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
    if (pagosValidados) {
      let baseDivisaRestante = Math.max(0, Math.round((subtotalCalculado + impuestoBase - descuentoVenta) * tasaPago.usd_ves * 100));
      let igtfUsdCentimos = 0;
      pagosValidados.forEach(pago => {
        if (pago.metodo_pago !== 'DIVISA') return;
        const baseIgtfCentimos = Math.min(pago.monto_bs_centimos, baseDivisaRestante);
        baseDivisaRestante -= baseIgtfCentimos;
        pago.igtf_bs_centimos = Math.round(baseIgtfCentimos * 0.03);
        igtfUsdCentimos += Math.round(pago.igtf_bs_centimos / tasaPago.usd_ves);
      });
      igtfUsd = igtfUsdCentimos / 100;
    }
    const totalCalculado = subtotalCalculado + impuestoBase + igtfUsd - descuentoVenta;
    if (pagosValidados) {
      const montoPagadoCentavos = pagosValidados.reduce((total, pago) => total + pago.monto_usd_centimos, 0);
      const vueltoBsCentimos = vueltoValidado
        ? Math.round(vueltoValidado.usd * tasaPago.usd_ves * 100) + Math.round(vueltoValidado.ves * 100)
        : 0;
      const vueltoUsdCentimos = Math.round(vueltoBsCentimos / tasaPago.usd_ves);
      if (vueltoUsdCentimos > montoPagadoCentavos || Math.abs(montoPagadoCentavos - vueltoUsdCentimos - Math.round(totalCalculado * 100)) > 1) {
        await client.query('ROLLBACK');
        return res.status(400).json({ success: false, error: 'Los montos recibidos menos el vuelto deben cubrir exactamente el total de la venta y el IGTF.' });
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
        igtfUsd > 0 ? `IGTF 3% sobre la porción de la factura aplicada en divisa: Bs. ${(pagosValidados.reduce((total, pago) => total + pago.igtf_bs_centimos, 0) / 100).toFixed(2)} (equivalente USD ${igtfUsd.toFixed(2)}).` : null,
        vueltoValidado && (vueltoValidado.usd > 0 || vueltoValidado.ves > 0)
          ? `Vuelto entregado: USD ${vueltoValidado.usd.toFixed(2)} + Bs. ${vueltoValidado.ves.toFixed(2)}.`
          : null
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
  const descuentoValidado = Number(descuento);
  const impuestoValidado = Number(impuesto);

  if (!productos || !Array.isArray(productos) || productos.length === 0) {
    return res.status(400).json({ success: false, error: 'La cotización debe incluir al menos un producto.' });
  }
  if (!targetTiendaId) {
    return res.status(400).json({ success: false, error: 'Debes especificar la tienda donde se crea el presupuesto.' });
  }
  if (!Number.isFinite(descuentoValidado) || descuentoValidado < 0 || !Number.isFinite(impuestoValidado) || impuestoValidado < 0) {
    return res.status(400).json({ success: false, error: 'El impuesto y el descuento deben ser montos válidos no negativos.' });
  }
  if (productos.some(item => !item || !item.producto_id || !Number.isInteger(Number(item.cantidad)) || Number(item.cantidad) <= 0)) {
    return res.status(400).json({ success: false, error: 'Cada producto debe tener un identificador y una cantidad entera mayor que cero.' });
  }

  const client = await db.pool.connect();

  try {
    await client.query('BEGIN');

    const tiendaRes = await client.query(
      'SELECT id FROM tiendas WHERE id = $1 AND tenant_id = $2 AND activa = TRUE',
      [targetTiendaId, tenant_id]
    );
    if (tiendaRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, error: 'La tienda seleccionada no pertenece a la empresa o está inactiva.' });
    }

    if (cliente_id) {
      const clienteRes = await client.query(
        'SELECT id FROM clientes WHERE id = $1 AND tenant_id = $2 AND activo = TRUE',
        [cliente_id, tenant_id]
      );
      if (clienteRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ success: false, error: 'El cliente seleccionado no existe o no pertenece a la empresa.' });
      }
    }

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
      const precioUnitario = item.precio_unitario !== undefined ? Number(item.precio_unitario) : Number(prod.precio_base);
      const cantidad = Number(item.cantidad);
      if (!Number.isFinite(precioUnitario) || precioUnitario < 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ success: false, error: 'El precio unitario de cada producto debe ser un monto válido no negativo.' });
      }
      const subtotalItem = precioUnitario * cantidad;
      subtotalCalculado += subtotalItem;

      itemsProcesados.push({
        producto_id: prod.id,
        cantidad,
        precio_unitario: precioUnitario,
        subtotal: subtotalItem
      });
    }

    const totalCalculado = subtotalCalculado + impuestoValidado - descuentoValidado;
    if (!Number.isFinite(totalCalculado) || totalCalculado <= 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, error: 'El total del presupuesto debe ser mayor que cero.' });
    }

    const cotRes = await client.query(
      `INSERT INTO cotizaciones (tenant_id, tienda_id, cliente_id, usuario_id, subtotal, impuesto, descuento, total, notas)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [tenant_id, targetTiendaId, cliente_id || null, req.user.user_id, subtotalCalculado, impuestoValidado, descuentoValidado, totalCalculado, typeof notas === 'string' && notas.trim() ? notas.trim() : null]
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

// 3. Consultar presupuestos creados en la empresa
exports.obtenerCotizaciones = async (req, res) => {
  const tenant_id = req.user.tenant_id;
  const pageValue = Number.parseInt(req.query.page, 10);
  const limitValue = Number.parseInt(req.query.limit, 10);
  const page = Number.isInteger(pageValue) && pageValue > 0 ? pageValue : 1;
  const limit = Number.isInteger(limitValue) && limitValue > 0 ? Math.min(limitValue, 100) : 100;
  const offset = (page - 1) * limit;
  const params = [tenant_id];
  const conditions = ['c.tenant_id = $1'];

  if (req.user.rol === 'EMPLOYEE') {
    params.push(req.user.user_id);
    conditions.push(`c.usuario_id = $${params.length}`);
  } else if (req.query.tienda_id) {
    params.push(req.query.tienda_id);
    conditions.push(`c.tienda_id = $${params.length}`);
  } else if (req.user.tienda_id) {
    params.push(req.user.tienda_id);
    conditions.push(`c.tienda_id = $${params.length}`);
  }

  try {
    const result = await db.query(
      `SELECT c.*, cl.nombre AS nombre_cliente, u.nombre AS nombre_vendedor, t.nombre AS nombre_tienda,
              COALESCE(d.productos, '[]'::json) AS productos
       FROM cotizaciones c
       LEFT JOIN clientes cl ON c.cliente_id = cl.id
       LEFT JOIN usuarios u ON c.usuario_id = u.id
       LEFT JOIN tiendas t ON c.tienda_id = t.id
       LEFT JOIN LATERAL (
         SELECT json_agg(json_build_object(
           'producto_id', dc.producto_id,
           'nombre_producto', p.nombre,
           'cantidad', dc.cantidad,
           'precio_unitario', dc.precio_unitario,
           'subtotal', dc.subtotal
         ) ORDER BY dc.id) AS productos
         FROM detalle_cotizacion dc
         LEFT JOIN productos p ON dc.producto_id = p.id
         WHERE dc.cotizacion_id = c.id
       ) d ON TRUE
       WHERE ${conditions.join(' AND ')}
       ORDER BY c.creado_en DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    );

    res.json({ success: true, data: result.rows, page, limit });
  } catch (error) {
    console.error('Error en obtenerCotizaciones [Fligo]:', error);
    res.status(500).json({ success: false, error: 'Error al consultar los presupuestos.' });
  }
};

// 4. Actualizar el seguimiento de un presupuesto
exports.actualizarEstadoCotizacion = async (req, res) => {
  const { id } = req.params;
  const { estado } = req.body;
  const estadosPermitidos = new Set(['PENDIENTE', 'APROBADA', 'RECHAZADA']);

  if (!estadosPermitidos.has(estado)) {
    return res.status(400).json({ success: false, error: 'El estado del presupuesto no es válido.' });
  }

  const params = [estado, id, req.user.tenant_id];
  let scope = '';
  if (req.user.rol === 'EMPLOYEE') {
    params.push(req.user.user_id);
    scope = ` AND usuario_id = $${params.length}`;
  } else if (req.user.tienda_id) {
    params.push(req.user.tienda_id);
    scope = ` AND tienda_id = $${params.length}`;
  }

  try {
    const result = await db.query(
      `UPDATE cotizaciones
       SET estado = $1
       WHERE id = $2 AND tenant_id = $3 AND estado <> 'CONVERTIDA'${scope}
       RETURNING *`,
      params
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Presupuesto no encontrado, convertido o sin permisos.' });
    }

    res.json({ success: true, message: 'Estado del presupuesto actualizado.', data: result.rows[0] });
  } catch (error) {
    console.error('Error en actualizarEstadoCotizacion [Fligo]:', error);
    res.status(500).json({ success: false, error: 'Error al actualizar el estado del presupuesto.' });
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