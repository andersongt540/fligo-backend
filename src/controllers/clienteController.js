const db = require('../config/db');
const { activeStore, employeeClient } = require('../utils/tenantValidation');

// 1. Crear un nuevo cliente en Fligo
exports.crearCliente = async (req, res) => {
  const { nombre, documento_identidad, email, telefono, direccion, categoria, notas, tienda_id } = req.body;
  const tenant_id = req.user.tenant_id; // Garantiza aislamiento Multi-Tenant
  const nombreLimpio = typeof nombre === 'string' ? nombre.trim() : '';
  const documentoLimpio = typeof documento_identidad === 'string' ? documento_identidad.trim().toUpperCase() : '';
  const telefonoLimpio = typeof telefono === 'string' ? telefono.trim() : '';
  const direccionLimpia = typeof direccion === 'string' ? direccion.trim() : '';
  
  // Si no se especifica tienda_id, asigna la tienda del usuario conectado
  const tiendaAsignada = tienda_id || req.user.tienda_id;

  if (!documentoLimpio || !nombreLimpio || !telefonoLimpio || !direccionLimpia) {
    return res.status(400).json({ success: false, error: 'La cédula, el nombre, el teléfono y la dirección corta del cliente son obligatorios.' });
  }
  if (!/^[VEJPG]?[-\s]?\d{5,12}$/i.test(documentoLimpio)) {
    return res.status(400).json({ success: false, error: 'Ingresa una cédula de identidad válida.' });
  }
  if (!/^[+\d\s().-]{7,30}$/.test(telefonoLimpio)) {
    return res.status(400).json({ success: false, error: 'Ingresa un teléfono válido para el cliente.' });
  }
  if (telefonoLimpio.length > 30 || direccionLimpia.length > 500 || nombreLimpio.length > 120) {
    return res.status(400).json({ success: false, error: 'Revisa la longitud del nombre, teléfono o dirección del cliente.' });
  }

  try {
    if ((tiendaAsignada && !(await activeStore(db, tenant_id, tiendaAsignada)))
      || (req.user.rol === 'EMPLOYEE' && tiendaAsignada !== req.user.tienda_id)) {
      return res.status(400).json({ success: false, error: 'La tienda seleccionada no pertenece a la empresa o no está asignada a este usuario.' });
    }
    const result = await db.query(
      `INSERT INTO clientes (tenant_id, tienda_id, nombre, documento_identidad, email, telefono, direccion, categoria, notas)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [tenant_id, tiendaAsignada, nombreLimpio, documentoLimpio, typeof email === 'string' && email.trim() ? email.trim() : null, telefonoLimpio, direccionLimpia, categoria || 'General', typeof notas === 'string' && notas.trim() ? notas.trim() : null]
    );

    res.status(201).json({
      success: true,
      message: 'Cliente registrado con éxito en Fligo.',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error en crearCliente [Fligo]:', error);
    res.status(500).json({ success: false, error: 'Error al registrar el cliente.' });
  }
};

// 2. Obtener lista de clientes con filtros y paginación
exports.obtenerClientes = async (req, res) => {
  const tenant_id = req.user.tenant_id;
  const { busqueda, categoria, tienda_id, page = 1, limit = 20 } = req.query;

  const offset = (page - 1) * limit;
  let params = [tenant_id];
  let conditions = ['c.tenant_id = $1', 'c.activo = TRUE'];

  // Filtro por tienda si el usuario es un empleado con tienda asignada
  if (req.user.rol === 'EMPLOYEE' && req.user.tienda_id) {
    params.push(req.user.tienda_id);
    conditions.push(`tienda_id = $${params.length}`);
  } else if (tienda_id) {
    params.push(tienda_id);
    conditions.push(`tienda_id = $${params.length}`);
  }

  // Filtro por categoría
  if (categoria) {
    params.push(categoria);
    conditions.push(`categoria = $${params.length}`);
  }

  // Búsqueda por Nombre, Email o Documento de Identidad
  if (busqueda) {
    params.push(`%${busqueda}%`);
    const searchParameter = params.length;
    const normalizedDocument = busqueda.toLocaleUpperCase().replace(/[^A-Z0-9]/g, '');
    if (normalizedDocument) {
      params.push(`%${normalizedDocument}%`);
      conditions.push(`(c.nombre ILIKE $${searchParameter} OR c.email ILIKE $${searchParameter} OR c.documento_identidad ILIKE $${searchParameter} OR regexp_replace(upper(c.documento_identidad), '[^A-Z0-9]', '', 'g') ILIKE $${params.length})`);
    } else {
      conditions.push(`(c.nombre ILIKE $${searchParameter} OR c.email ILIKE $${searchParameter} OR c.documento_identidad ILIKE $${searchParameter})`);
    }
  }

  const whereClause = conditions.join(' AND ');

  try {
    // Consulta de los clientes
    const clientesQuery = `
      SELECT c.*, t.nombre as nombre_tienda 
      FROM clientes c
      LEFT JOIN tiendas t ON c.tienda_id = t.id AND t.tenant_id = c.tenant_id
      WHERE ${whereClause}
      ORDER BY c.creado_en DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `;
    
    // Consulta de total para la paginación
    const totalQuery = `SELECT COUNT(*) FROM clientes c WHERE ${whereClause}`;

    const [clientesRes, totalRes] = await Promise.all([
      db.query(clientesQuery, [...params, limit, offset]),
      db.query(totalQuery, params)
    ]);

    const total = parseInt(totalRes.rows[0].count);

    res.json({
      success: true,
      data: clientesRes.rows,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Error en obtenerClientes [Fligo]:', error);
    res.status(500).json({ success: false, error: 'Error al obtener la lista de clientes.' });
  }
};

// 3. Obtener detalle de un cliente por ID
exports.obtenerClientePorId = async (req, res) => {
  const { id } = req.params;
  const tenant_id = req.user.tenant_id;

  try {
    const result = await db.query(
      `SELECT c.*, t.nombre as nombre_tienda 
       FROM clientes c
      LEFT JOIN tiendas t ON c.tienda_id = t.id AND t.tenant_id = c.tenant_id
       WHERE c.id = $1 AND c.tenant_id = $2 AND c.activo = TRUE
         AND ($3::boolean = FALSE OR c.tienda_id = $4)`,
      [id, tenant_id, req.user.rol === 'EMPLOYEE', req.user.tienda_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Cliente no encontrado en Fligo.' });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('Error en obtenerClientePorId [Fligo]:', error);
    res.status(500).json({ success: false, error: 'Error al obtener los detalles del cliente.' });
  }
};

// 4. Actualizar cliente
exports.actualizarCliente = async (req, res) => {
  const { id } = req.params;
  const tenant_id = req.user.tenant_id;
  const { nombre, documento_identidad, email, telefono, direccion, categoria, notas, tienda_id } = req.body;

  try {
    if (req.user.rol === 'EMPLOYEE' && !(await employeeClient(db, tenant_id, id, req.user.tienda_id))) {
      return res.status(404).json({ success: false, error: 'Cliente no encontrado o sin autorización.' });
    }
    if (tienda_id && (!(await activeStore(db, tenant_id, tienda_id))
      || (req.user.rol === 'EMPLOYEE' && tienda_id !== req.user.tienda_id))) {
      return res.status(400).json({ success: false, error: 'La tienda seleccionada no pertenece a la empresa o no está asignada a este usuario.' });
    }
    const checkCliente = await db.query(
      `SELECT id FROM clientes WHERE id = $1 AND tenant_id = $2 AND activo = TRUE
       AND ($3::boolean = FALSE OR tienda_id = $4)`,
      [id, tenant_id, req.user.rol === 'EMPLOYEE', req.user.tienda_id]
    );

    if (checkCliente.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Cliente no encontrado o sin autorización.' });
    }

    const result = await db.query(
      `UPDATE clientes 
       SET nombre = COALESCE($1, nombre),
           documento_identidad = COALESCE($2, documento_identidad),
           email = COALESCE($3, email),
           telefono = COALESCE($4, telefono),
           direccion = COALESCE($5, direccion),
           categoria = COALESCE($6, categoria),
           notas = COALESCE($7, notas),
           tienda_id = COALESCE($8, tienda_id),
           actualizado_en = CURRENT_TIMESTAMP
      WHERE id = $9 AND tenant_id = $10 AND ($11::boolean = FALSE OR tienda_id = $12)
       RETURNING *`,
          [nombre, documento_identidad, email, telefono, direccion, categoria, notas, tienda_id, id, tenant_id, req.user.rol === 'EMPLOYEE', req.user.tienda_id]
    );

    res.json({
      success: true,
      message: 'Cliente actualizado correctamente en Fligo.',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error en actualizarCliente [Fligo]:', error);
    res.status(500).json({ success: false, error: 'Error al actualizar el cliente.' });
  }
};

// 5. Eliminar cliente (Eliminación lógica)
exports.eliminarCliente = async (req, res) => {
  const { id } = req.params;
  const tenant_id = req.user.tenant_id;

  try {
    const result = await db.query(
      `UPDATE clientes 
       SET activo = FALSE, actualizado_en = CURRENT_TIMESTAMP 
       WHERE id = $1 AND tenant_id = $2 
       RETURNING id`,
      [id, tenant_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Cliente no encontrado o sin autorización.' });
    }

    res.json({ success: true, message: 'Cliente eliminado correctamente de Fligo.' });
  } catch (error) {
    console.error('Error en eliminarCliente [Fligo]:', error);
    res.status(500).json({ success: false, error: 'Error al eliminar el cliente.' });
  }
};