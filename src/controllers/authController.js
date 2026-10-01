const db = require('../config/db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// 1. Registro de Empresa e Inicio en Fligo (Onboarding)
exports.registerTenant = async (req, res) => {
  const { nombre_empresa, nombre_usuario, email, password } = req.body;

  if (!nombre_empresa || !nombre_usuario || !email || !password) {
    return res.status(400).json({ 
      success: false, 
      error: 'Todos los campos son obligatorios para crear tu cuenta en Fligo.' 
    });
  }

  const client = await db.pool.connect();

  try {
    await client.query('BEGIN');

    // Verificar si el usuario ya está registrado en Fligo
    const existingUser = await client.query('SELECT id FROM usuarios WHERE email = $1', [email]);
    if (existingUser.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ 
        success: false, 
        error: 'El correo electrónico ya está registrado en Fligo.' 
      });
    }

    // Crear Empresa / Inquilino en Fligo
    const tenantRes = await client.query(
      'INSERT INTO tenants (nombre_empresa) VALUES ($1) RETURNING id, nombre_empresa, plan',
      [nombre_empresa]
    );
    const newTenant = tenantRes.rows[0];

    // Crear la Sucursal / Tienda Principal inicial
    const tiendaRes = await client.query(
      'INSERT INTO tiendas (tenant_id, nombre) VALUES ($1, $2) RETURNING id, nombre',
      [newTenant.id, 'Sucursal Principal']
    );
    const newTienda = tiendaRes.rows[0];

    // Cifrar contraseña y crear el usuario OWNER
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    const userRes = await client.query(
      `INSERT INTO usuarios (tenant_id, tienda_id, nombre, email, password_hash, rol) 
       VALUES ($1, $2, $3, $4, $5, 'OWNER') RETURNING id, nombre, email, rol`,
      [newTenant.id, newTienda.id, nombre_usuario, email, passwordHash]
    );

    await client.query('COMMIT');

    // Generar Token JWT de Fligo
    const token = jwt.sign(
      {
        user_id: userRes.rows[0].id,
        tenant_id: newTenant.id,
        tienda_id: newTienda.id,
        rol: 'OWNER'
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
    );

    res.status(201).json({
      success: true,
      message: '¡Bienvenido a Fligo! Empresa y cuenta creadas con éxito.',
      data: {
        token,
        usuario: userRes.rows[0],
        empresa: newTenant,
        tienda: newTienda
      }
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error en registerTenant [Fligo]:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Error interno del servidor al registrar la cuenta en Fligo.' 
    });
  } finally {
    client.release();
  }
};

// 2. Inicio de Sesión
exports.login = async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ 
      success: false, 
      error: 'Por favor ingresa tu correo y contraseña.' 
    });
  }

  try {
    const result = await db.query(
      `SELECT u.id, u.tenant_id, u.tienda_id, u.nombre, u.email, u.password_hash, u.rol, u.activo,
              t.nombre_empresa 
       FROM usuarios u
       JOIN tenants t ON u.tenant_id = t.id
       WHERE u.email = $1`,
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ success: false, error: 'Credenciales inválidas en Fligo.' });
    }

    const usuario = result.rows[0];

    if (!usuario.activo) {
      return res.status(403).json({ 
        success: false, 
        error: 'Tu usuario en Fligo se encuentra inactivo. Contacta a tu administrador.' 
      });
    }

    const passwordValido = await bcrypt.compare(password, usuario.password_hash);
    if (!passwordValido) {
      return res.status(401).json({ success: false, error: 'Credenciales inválidas en Fligo.' });
    }

    // Generar Token JWT firmado
    const token = jwt.sign(
      {
        user_id: usuario.id,
        tenant_id: usuario.tenant_id,
        tienda_id: usuario.tienda_id,
        rol: usuario.rol
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
    );

    res.json({
      success: true,
      message: 'Inicio de sesión exitoso en Fligo.',
      data: {
        token,
        usuario: {
          id: usuario.id,
          nombre: usuario.nombre,
          email: usuario.email,
          rol: usuario.rol,
          tenant_id: usuario.tenant_id,
          tienda_id: usuario.tienda_id,
          empresa: usuario.nombre_empresa
        }
      }
    });

  } catch (error) {
    console.error('Error en login [Fligo]:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor al iniciar sesión.' });
  }
};

// 3. Crear Empleado (Solo OWNER o MANAGER del Tenant)
exports.createEmpleado = async (req, res) => {
  const { nombre, email, password, rol, tienda_id } = req.body;
  const tenant_id = req.user.tenant_id; // Garantiza que no se crucen datos entre empresas

  if (!nombre || !email || !password || !rol) {
    return res.status(400).json({ 
      success: false, 
      error: 'Todos los campos obligatorios deben ser proporcionados.' 
    });
  }

  try {
    const checkUser = await db.query('SELECT id FROM usuarios WHERE email = $1', [email]);
    if (checkUser.rows.length > 0) {
      return res.status(400).json({ 
        success: false, 
        error: 'El correo electrónico ya está registrado en Fligo.' 
      });
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    const result = await db.query(
      `INSERT INTO usuarios (tenant_id, tienda_id, nombre, email, password_hash, rol)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, nombre, email, rol, tienda_id, creado_en`,
      [tenant_id, tienda_id || null, nombre, email, passwordHash, rol]
    );

    res.status(201).json({
      success: true,
      message: 'Empleado registrado exitosamente en tu equipo de Fligo.',
      data: result.rows[0]
    });

  } catch (error) {
    console.error('Error en createEmpleado [Fligo]:', error);
    res.status(500).json({ success: false, error: 'Error al registrar el empleado.' });
  }
};

// 4. Obtener Perfil del Usuario Autenticado
exports.getProfile = async (req, res) => {
  try {
    const result = await db.query(
      `SELECT u.id, u.nombre, u.email, u.rol, u.tenant_id, u.tienda_id, t.nombre_empresa, s.nombre as nombre_tienda
       FROM usuarios u
       JOIN tenants t ON u.tenant_id = t.id
       LEFT JOIN tiendas s ON u.tienda_id = s.id
       WHERE u.id = $1`,
      [req.user.user_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Usuario de Fligo no encontrado.' });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('Error en getProfile [Fligo]:', error);
    res.status(500).json({ success: false, error: 'Error al obtener datos del perfil.' });
  }
};