const db = require('../config/db');

// 1. Crear producto e inicializar inventario en las tiendas
exports.crearProducto = async (req, res) => {
  const { codigo_sku, codigo_barras, nombre, descripcion, categoria, precio_base, costo, stock_inicial = 0, stock_minimo = 5, tienda_id } = req.body;
  const tenant_id = req.user.tenant_id;
  const tiendaAsignada = tienda_id || req.user.tienda_id;

  if (!codigo_sku || !nombre || precio_base === undefined) {
    return res.status(400).json({ success: false, error: 'SKU, nombre y precio base son obligatorios.' });
  }

  const client = await db.pool.connect();

  try {
    await client.query('BEGIN');

    // Insertar Producto
    const productoRes = await client.query(
      `INSERT INTO productos (tenant_id, codigo_sku, codigo_barras, nombre, descripcion, categoria, precio_base, costo)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [tenant_id, codigo_sku, codigo_barras || null, nombre, descripcion || null, categoria || 'General', precio_base, costo || 0.00]
    );

    const nuevoProducto = productoRes.rows[0];

    // Inicializar inventario en la tienda correspondiente si existe una tienda asignada
    if (tiendaAsignada) {
      await client.query(
        `INSERT INTO inventario_tienda (tenant_id, tienda_id, producto_id, stock_actual, stock_minimo)
         VALUES ($1, $2, $3, $4, $5)`,
        [tenant_id, tiendaAsignada, nuevoProducto.id, stock_inicial, stock_minimo]
      );

      // Registrar movimiento de stock inicial si fue mayor a 0
      if (stock_inicial > 0) {
        await client.query(
          `INSERT INTO movimientos_inventario (tenant_id, tienda_id, producto_id, usuario_id, tipo_movimiento, cantidad, stock_resultante, motivo)
           VALUES ($1, $2, $3, $4, 'ENTRADA', $5, $5, 'Stock inicial de creación')`,
          [tenant_id, tiendaAsignada, nuevoProducto.id, req.user.user_id, stock_inicial]
        );
      }
    }

    await client.query('COMMIT');

    res.status(201).json({
      success: true,
      message: 'Producto creado exitosamente en Fligo.',
      data: nuevoProducto
    });

  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23505') { // Violación de restricción UNIQUE (SKU duplicado)
      return res.status(400).json({ success: false, error: 'El código SKU ya existe en la empresa.' });
    }
    console.error('Error en crearProducto [Fligo]:', error);
    res.status(500).json({ success: false, error: 'Error al registrar el producto.' });
  } finally {
    client.release();
  }
};

// 2. Obtener productos con stock por tienda y búsqueda rápida (Móvil/POS)
exports.obtenerProductos = async (req, res) => {
  const tenant_id = req.user.tenant_id;
  const { busqueda, categoria, tienda_id, bajo_stock, page = 1, limit = 20 } = req.query;

  // Empleados consultan stock de su tienda asignada por defecto
  const targetTiendaId = (req.user.rol === 'EMPLOYEE' && req.user.tienda_id) 
    ? req.user.tienda_id 
    : (tienda_id || req.user.tienda_id);

  const offset = (page - 1) * limit;
  let params = [tenant_id];
  let conditions = ['p.tenant_id = $1', 'p.activo = TRUE'];

  if (categoria) {
    params.push(categoria);
    conditions.push(`p.categoria = $${params.length}`);
  }

  if (busqueda) {
    params.push(`%${busqueda}%`);
    conditions.push(`(p.nombre ILIKE $${params.length} OR p.codigo_sku ILIKE $${params.length} OR p.codigo_barras ILIKE $${params.length})`);
  }

  if (bajo_stock === 'true' && targetTiendaId) {
    conditions.push(`COALESCE(i.stock_actual, 0) <= COALESCE(i.stock_minimo, 5)`);
  }

  const whereClause = conditions.join(' AND ');

  try {
    let query = `
      SELECT p.*, 
             COALESCE(i.stock_actual, 0) as stock_actual,
             COALESCE(i.stock_minimo, 5) as stock_minimo,
             t.nombre as nombre_tienda
      FROM productos p
      LEFT JOIN inventario_tienda i ON p.id = i.producto_id AND i.tienda_id = $${params.length + 1}
      LEFT JOIN tiendas t ON i.tienda_id = t.id
      WHERE ${whereClause}
      ORDER BY p.nombre ASC
      LIMIT $${params.length + 2} OFFSET $${params.length + 3}
    `;

    const queryParams = [...params, targetTiendaId || null, limit, offset];
    const result = await db.query(query, queryParams);

    res.json({
      success: true,
      data: result.rows,
      page: parseInt(page),
      limit: parseInt(limit)
    });

  } catch (error) {
    console.error('Error en obtenerProductos [Fligo]:', error);
    res.status(500).json({ success: false, error: 'Error al consultar productos.' });
  }
};

// 3. Ajustar stock manualmente (Entrada / Salida / Corrección)
exports.ajustarInventario = async (req, res) => {
  const { producto_id, cantidad, tipo_movimiento, motivo, tienda_id } = req.body;
  const tenant_id = req.user.tenant_id;
  const targetTiendaId = tienda_id || req.user.tienda_id;

  if (!producto_id || cantidad === undefined || !tipo_movimiento || !targetTiendaId) {
    return res.status(400).json({ success: false, error: 'Faltan parámetros obligatorios para el ajuste.' });
  }

  if (!['ENTRADA', 'SALIDA', 'AJUSTE'].includes(tipo_movimiento)) {
    return res.status(400).json({ success: false, error: 'Tipo de movimiento inválido.' });
  }

  const client = await db.pool.connect();

  try {
    await client.query('BEGIN');

    // Obtener inventario actual o crearlo si no existe el registro en esa tienda
    let invRes = await client.query(
      `SELECT * FROM inventario_tienda WHERE tenant_id = $1 AND tienda_id = $2 AND producto_id = $3 FOR UPDATE`,
      [tenant_id, targetTiendaId, producto_id]
    );

    let stockActual = 0;
    if (invRes.rows.length === 0) {
      const newInv = await client.query(
        `INSERT INTO inventario_tienda (tenant_id, tienda_id, producto_id, stock_actual)
         VALUES ($1, $2, $3, 0) RETURNING *`,
        [tenant_id, targetTiendaId, producto_id]
      );
      stockActual = 0;
    } else {
      stockActual = invRes.rows[0].stock_actual;
    }

    // Calcular nuevo stock
    let nuevoStock = stockActual;
    if (tipo_movimiento === 'ENTRADA') nuevoStock += parseInt(cantidad);
    else if (tipo_movimiento === 'SALIDA') nuevoStock -= parseInt(cantidad);
    else if (tipo_movimiento === 'AJUSTE') nuevoStock = parseInt(cantidad);

    if (nuevoStock < 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, error: 'El ajuste genera un stock negativo no permitido.' });
    }

    // Actualizar registro de inventario
    await client.query(
      `UPDATE inventario_tienda 
       SET stock_actual = $1, actualizado_en = CURRENT_TIMESTAMP
       WHERE tenant_id = $2 AND tienda_id = $3 AND producto_id = $4`,
      [nuevoStock, tenant_id, targetTiendaId, producto_id]
    );

    // Auditoría de movimiento
    await client.query(
      `INSERT INTO movimientos_inventario (tenant_id, tienda_id, producto_id, usuario_id, tipo_movimiento, cantidad, stock_resultante, motivo)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [tenant_id, targetTiendaId, producto_id, req.user.user_id, tipo_movimiento, cantidad, nuevoStock, motivo || 'Ajuste manual']
    );

    await client.query('COMMIT');

    res.json({
      success: true,
      message: 'Inventario actualizado correctamente en Fligo.',
      data: { producto_id, tienda_id: targetTiendaId, stock_anterior: stockActual, stock_nuevo: nuevoStock }
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error en ajustarInventario [Fligo]:', error);
    res.status(500).json({ success: false, error: 'Error interno al actualizar el inventario.' });
  } finally {
    client.release();
  }
};