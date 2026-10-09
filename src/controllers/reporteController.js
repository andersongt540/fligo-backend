const db = require('../config/db');

// 1. Dashboard de Métricas Generales (Móvil / Web)
exports.obtenerDashboardSummary = async (req, res) => {
  const tenant_id = req.user.tenant_id;
  const { tienda_id, fecha_inicio, fecha_fin } = req.query;

  // Filtrado por tienda si el usuario es un empleado con tienda fija
  const targetTiendaId = (req.user.rol === 'EMPLOYEE' && req.user.tienda_id)
    ? req.user.tienda_id
    : (tienda_id || req.user.tienda_id);

  let params = [tenant_id];
  let conditions = ["v.tenant_id = $1", "v.estado = 'COMPLETADA'"];

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
    // Consulta 1: Totales de Ventas, Ticket Promedio y Cantidad de Transacciones
    const ventasQuery = `
      SELECT 
        COALESCE(SUM(v.total), 0) as total_ventas,
        COALESCE(COUNT(v.id), 0) as cantidad_ventas,
        COALESCE(AVG(v.total), 0) as ticket_promedio
      FROM ventas v
      WHERE ${whereClause}
    `;

    // Consulta 2: Top 5 Productos más Vendidos
    const topProductosQuery = `
      SELECT 
        p.id,
        p.nombre,
        p.codigo_sku,
        SUM(dv.cantidad) as total_unidades_vendidas,
        SUM(dv.subtotal) as total_recaudado
      FROM detalle_venta dv
      JOIN ventas v ON dv.venta_id = v.id
      JOIN productos p ON dv.producto_id = p.id AND p.tenant_id = v.tenant_id
      WHERE ${whereClause}
      GROUP BY p.id, p.nombre, p.codigo_sku
      ORDER BY total_unidades_vendidas DESC
      LIMIT 5
    `;

    // Consulta 3: Total de Clientes Activos de la Empresa
    const totalClientesQuery = `
      SELECT COUNT(id) as total_clientes 
      FROM clientes 
      WHERE tenant_id = $1 AND activo = TRUE
    `;

    const [ventasRes, topProdRes, clientesRes] = await Promise.all([
      db.query(ventasQuery, params),
      db.query(topProductosQuery, params),
      db.query(totalClientesQuery, [tenant_id])
    ]);

    const kpis = ventasRes.rows[0];

    res.json({
      success: true,
      data: {
        kpis: {
          total_ventas: parseFloat(kpis.total_ventas),
          cantidad_ventas: parseInt(kpis.cantidad_ventas),
          ticket_promedio: parseFloat(kpis.ticket_promedio),
          total_clientes: parseInt(clientesRes.rows[0].total_clientes)
        },
        top_productos: topProdRes.rows
      }
    });

  } catch (error) {
    console.error('Error en obtenerDashboardSummary [Fligo]:', error);
    res.status(500).json({ success: false, error: 'Error al generar métricas del dashboard.' });
  }
};

// 2. Comparativo de Ventas por Tienda (Solo OWNER / MANAGER)
exports.obtenerVentasPorTienda = async (req, res) => {
  const tenant_id = req.user.tenant_id;
  const { fecha_inicio, fecha_fin } = req.query;

  let params = [tenant_id];
  let conditions = ["t.tenant_id = $1", "t.activa = TRUE"];

  let fechaWhere = "v.estado = 'COMPLETADA'";
  if (fecha_inicio) {
    params.push(fecha_inicio);
    fechaWhere += ` AND v.creado_en >= $${params.length}`;
  }
  if (fecha_fin) {
    params.push(fecha_fin);
    fechaWhere += ` AND v.creado_en <= $${params.length}`;
  }

  try {
    const query = `
      SELECT 
        t.id as tienda_id,
        t.nombre as nombre_tienda,
        COALESCE(SUM(v.total), 0) as total_ventas,
        COALESCE(COUNT(v.id), 0) as cantidad_ventas
      FROM tiendas t
      LEFT JOIN ventas v ON t.id = v.tienda_id AND v.tenant_id = t.tenant_id AND ${fechaWhere}
      WHERE ${conditions.join(' AND ')}
      GROUP BY t.id, t.nombre
      ORDER BY total_ventas DESC
    `;

    const result = await db.query(query, params);

    res.json({
      success: true,
      data: result.rows
    });

  } catch (error) {
    console.error('Error en obtenerVentasPorTienda [Fligo]:', error);
    res.status(500).json({ success: false, error: 'Error al generar reporte por tiendas.' });
  }
};

// 3. Ranking y Desempeño de Vendedores
exports.obtenerRankingVendedores = async (req, res) => {
  const tenant_id = req.user.tenant_id;
  const { tienda_id, fecha_inicio, fecha_fin } = req.query;

  let params = [tenant_id];
  let conditions = ["v.tenant_id = $1", "v.estado = 'COMPLETADA'"];

  if (tienda_id) {
    params.push(tienda_id);
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

  try {
    const query = `
      SELECT 
        u.id as usuario_id,
        u.nombre as nombre_vendedor,
        t.nombre as nombre_tienda,
        COALESCE(SUM(v.total), 0) as total_vendido,
        COALESCE(COUNT(v.id), 0) as cantidad_ventas
      FROM usuarios u
      JOIN ventas v ON u.id = v.usuario_id AND u.tenant_id = v.tenant_id
      LEFT JOIN tiendas t ON v.tienda_id = t.id AND t.tenant_id = v.tenant_id
      WHERE ${conditions.join(' AND ')}
      GROUP BY u.id, u.nombre, t.nombre
      ORDER BY total_vendido DESC
    `;

    const result = await db.query(query, params);

    res.json({
      success: true,
      data: result.rows
    });

  } catch (error) {
    console.error('Error en obtenerRankingVendedores [Fligo]:', error);
    res.status(500).json({ success: false, error: 'Error al generar ranking de vendedores.' });
  }
};