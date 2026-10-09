const db = require('../config/db');
const { activeProduct, activeStore } = require('../utils/tenantValidation');

// 1. Crear producto e inicializar inventario en las tiendas
exports.crearProducto = async (req, res) => {
  const { codigo_sku, codigo_barras, nombre, descripcion, categoria, precio_base, costo, stock_inicial = 0, stock_minimo = 5, tienda_id } = req.body;
  const tenant_id = req.user.tenant_id;
  const tiendaAsignada = tienda_id || req.user.tienda_id;
  const precioValidado = Number(precio_base);
  const costoValidado = costo === undefined ? 0 : Number(costo);
  const stockInicialValidado = Number(stock_inicial);
  const stockMinimoValidado = Number(stock_minimo);

  if (typeof codigo_sku !== 'string' || !codigo_sku.trim() || typeof nombre !== 'string' || !nombre.trim() || precio_base === undefined) {
    return res.status(400).json({ success: false, error: 'SKU, nombre y precio base son obligatorios.' });
  }
  if (!Number.isFinite(precioValidado) || precioValidado < 0 || !Number.isFinite(costoValidado) || costoValidado < 0
    || !Number.isInteger(stockInicialValidado) || stockInicialValidado < 0
    || !Number.isInteger(stockMinimoValidado) || stockMinimoValidado < 0) {
    return res.status(400).json({ success: false, error: 'Precio, costo y cantidades de inventario deben ser valores válidos no negativos.' });
  }

  const client = await db.pool.connect();

  try {
    await client.query('BEGIN');

    if (tiendaAsignada && (!(await activeStore(client, tenant_id, tiendaAsignada))
      || (req.user.rol === 'EMPLOYEE' && tiendaAsignada !== req.user.tienda_id))) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, error: 'La tienda seleccionada no pertenece a la empresa o no está asignada a este usuario.' });
    }

    // Insertar Producto
    const productoRes = await client.query(
      `INSERT INTO productos (tenant_id, codigo_sku, codigo_barras, nombre, descripcion, categoria, precio_base, costo)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [tenant_id, codigo_sku.trim(), codigo_barras || null, nombre.trim(), descripcion || null, categoria || 'General', precioValidado, costoValidado]
    );

    const nuevoProducto = productoRes.rows[0];

    // Inicializar inventario en la tienda correspondiente si existe una tienda asignada
    if (tiendaAsignada) {
      await client.query(
        `INSERT INTO inventario_tienda (tenant_id, tienda_id, producto_id, stock_actual, stock_minimo)
         VALUES ($1, $2, $3, $4, $5)`,
        [tenant_id, tiendaAsignada, nuevoProducto.id, stockInicialValidado, stockMinimoValidado]
      );

      // Registrar movimiento de stock inicial si fue mayor a 0
      if (stockInicialValidado > 0) {
        await client.query(
          `INSERT INTO movimientos_inventario (tenant_id, tienda_id, producto_id, usuario_id, tipo_movimiento, cantidad, stock_resultante, motivo)
           VALUES ($1, $2, $3, $4, 'ENTRADA', $5, $5, 'Stock inicial de creación')`,
          [tenant_id, tiendaAsignada, nuevoProducto.id, req.user.user_id, stockInicialValidado]
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
  const { busqueda, categoria, tienda_id, bajo_stock } = req.query;
  const pageValue = Number.parseInt(req.query.page, 10);
  const limitValue = Number.parseInt(req.query.limit, 10);
  const page = Number.isInteger(pageValue) && pageValue > 0 ? pageValue : 1;
  const limit = Number.isInteger(limitValue) && limitValue > 0 ? Math.min(limitValue, 100) : 20;

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
      LEFT JOIN inventario_tienda i ON p.id = i.producto_id AND i.tienda_id = $${params.length + 1} AND i.tenant_id = p.tenant_id
      LEFT JOIN tiendas t ON i.tienda_id = t.id AND t.tenant_id = p.tenant_id
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
  const cantidadValidada = Number(cantidad);
  if (!Number.isInteger(cantidadValidada) || cantidadValidada < 0
    || (tipo_movimiento !== 'AJUSTE' && cantidadValidada === 0)) {
    return res.status(400).json({ success: false, error: 'La cantidad debe ser un entero válido y positivo, excepto en ajustes que admiten cero.' });
  }

  const client = await db.pool.connect();

  try {
    await client.query('BEGIN');

    if (!(await activeStore(client, tenant_id, targetTiendaId))
      || !(await activeProduct(client, tenant_id, producto_id))) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, error: 'La tienda o el producto no existe en la empresa.' });
    }

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
    if (tipo_movimiento === 'ENTRADA') nuevoStock += cantidadValidada;
    else if (tipo_movimiento === 'SALIDA') nuevoStock -= cantidadValidada;
    else if (tipo_movimiento === 'AJUSTE') nuevoStock = cantidadValidada;

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
      [tenant_id, targetTiendaId, producto_id, req.user.user_id, tipo_movimiento, cantidadValidada, nuevoStock, motivo || 'Ajuste manual']
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