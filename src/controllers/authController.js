const crypto = require('crypto');
const db = require('../config/db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const firebaseTokenVerifier = require('../config/firebaseTokenVerifier');
const { estadoSuscripcion } = require('../utils/suscripcion');
const { activeStore } = require('../utils/tenantValidation');

function createSession(user, res) {
  const token = jwt.sign(
    {
      user_id: user.id,
      tenant_id: user.tenant_id,
      tienda_id: user.tienda_id,
      rol: user.rol
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
        id: user.id,
        nombre: user.nombre,
        email: user.email,
        rol: user.rol,
        tenant_id: user.tenant_id,
        tienda_id: user.tienda_id,
        empresa: user.nombre_empresa
      },
      suscripcion: estadoSuscripcion(user)
    }
  });
}

exports.firebaseSession = async (req, res) => {
  const { idToken, registro } = req.body || {};
  if (!idToken) {
    return res.status(400).json({ success: false, error: 'Falta la credencial de Firebase.' });
  }

  let firebaseUser;
  try {
    const decodedToken = await firebaseTokenVerifier.verifyIdToken(idToken);
    if (!decodedToken.email || !decodedToken.email_verified) {
      return res.status(403).json({
        success: false,
        error: 'Verifica tu correo electrónico antes de acceder a Fligo.'
      });
    }
    firebaseUser = {
      uid: decodedToken.uid,
      email: decodedToken.email.trim().toLowerCase(),
      name: decodedToken.name || decodedToken.email.split('@')[0]
    };
  } catch (error) {
    console.error('Error al verificar identidad de Firebase [Fligo]:', error);
    return res.status(401).json({ success: false, error: 'La sesión de Firebase no es válida. Inicia sesión nuevamente.' });
  }

  let client;
  try {
    client = await db.pool.connect();
    await client.query('BEGIN');
    let userResult = await client.query(
      `SELECT u.id, u.firebase_uid, u.tenant_id, u.tienda_id, u.nombre, u.email, u.rol, u.activo,
              t.nombre_empresa, t.prueba_hasta, t.suscripcion_hasta
       FROM usuarios u
       JOIN tenants t ON u.tenant_id = t.id
       WHERE u.firebase_uid = $1 OR LOWER(u.email) = $2
       FOR UPDATE OF u`,
      [firebaseUser.uid, firebaseUser.email]
    );

    if (userResult.rows.length > 1) {
      await client.query('ROLLBACK');
      return res.status(409).json({ success: false, error: 'No se pudo asociar esta identidad a una única cuenta de Fligo.' });
    }

    let user = userResult.rows[0];
    if (user && user.firebase_uid && user.firebase_uid !== firebaseUser.uid) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        success: false,
        error: 'Este correo ya está asociado a otra cuenta de acceso. Contacta al administrador.'
      });
    }

    if (!user) {
      const companyName = typeof registro?.nombre_empresa === 'string' ? registro.nombre_empresa.trim() : '';
      if (!companyName || companyName.length > 150) {
        await client.query('ROLLBACK');
        return res.status(404).json({
          success: false,
          error: 'No existe una cuenta de Fligo para este correo. Regístrate para crear tu empresa.'
        });
      }

      const tenantResult = await client.query(
        `INSERT INTO tenants (nombre_empresa, prueba_hasta)
         VALUES ($1, CURRENT_TIMESTAMP + INTERVAL '7 days')
         RETURNING id, nombre_empresa, prueba_hasta, suscripcion_hasta`,
        [companyName]
      );
      const tenant = tenantResult.rows[0];
      const storeResult = await client.query(
        'INSERT INTO tiendas (tenant_id, nombre) VALUES ($1, $2) RETURNING id, nombre',
        [tenant.id, 'Sucursal Principal']
      );
      const store = storeResult.rows[0];
      const passwordHash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10);
      const newUser = await client.query(
        `INSERT INTO usuarios (tenant_id, tienda_id, nombre, email, password_hash, firebase_uid, rol)
         VALUES ($1, $2, $3, $4, $5, $6, 'OWNER')
         RETURNING id, firebase_uid, tenant_id, tienda_id, nombre, email, rol, activo`,
        [tenant.id, store.id, firebaseUser.name, firebaseUser.email, passwordHash, firebaseUser.uid]
      );
      user = {
        ...newUser.rows[0],
        nombre_empresa: tenant.nombre_empresa,
        prueba_hasta: tenant.prueba_hasta,
        suscripcion_hasta: tenant.suscripcion_hasta
      };
    } else if (!user.firebase_uid) {
      const linked = await client.query(
        `UPDATE usuarios SET firebase_uid = $1
         WHERE id = $2 AND firebase_uid IS NULL
         RETURNING id`,
        [firebaseUser.uid, user.id]
      );
      if (!linked.rowCount) {
        await client.query('ROLLBACK');
        return res.status(409).json({ success: false, error: 'La cuenta ya fue asociada a otra identidad.' });
      }
    }

    if (!user.activo) {
      await client.query('ROLLBACK');
      return res.status(403).json({ success: false, error: 'Tu usuario en Fligo se encuentra inactivo. Contacta a tu administrador.' });
    }

    await client.query('COMMIT');
    createSession(user, res);
  } catch (error) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('Error al revertir la sesión de Firebase [Fligo]:', rollbackError);
      }
    }
    console.error('Error al iniciar sesión con Firebase [Fligo]:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor al iniciar sesión.' });
  } finally {
    if (client) client.release();
  }
};

exports.migrateLegacyAccount = async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = req.body?.password;
  if (!email || typeof password !== 'string' || !password) {
    return res.status(400).json({ success: false, error: 'Ingresa el correo y contraseña actuales de tu cuenta.' });
  }

  try {
    const result = await db.query(
      `SELECT id, email, nombre, password_hash, firebase_uid
       FROM usuarios WHERE LOWER(email) = $1`,
      [email]
    );
    const user = result.rows[0];
    if (!user || user.firebase_uid || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ success: false, error: 'No se pudo verificar la cuenta con esas credenciales.' });
    }

    res.json({
      success: true,
      message: 'Credenciales anteriores verificadas. Continúa para crear tu acceso de Firebase.'
    });
  } catch (error) {
    console.error('Error al migrar cuenta anterior a Firebase [Fligo]:', error);
    res.status(500).json({ success: false, error: 'No se pudo preparar la migración de esta cuenta.' });
  }
};

exports.createEmpleado = async (req, res) => {
  const { nombre, email: rawEmail, password, rol, tienda_id } = req.body || {};
  const email = typeof rawEmail === 'string' ? rawEmail.trim().toLowerCase() : '';
  const tenant_id = req.user.tenant_id;

  if (!nombre || !email || !password || !rol) {
    return res.status(400).json({ success: false, error: 'Todos los campos obligatorios deben ser proporcionados.' });
  }
  if (!['MANAGER', 'EMPLOYEE'].includes(rol) || typeof password !== 'string' || password.length < 6) {
    return res.status(400).json({ success: false, error: 'El rol o la contraseña proporcionados no son válidos.' });
  }
  if (typeof nombre !== 'string' || nombre.trim().length > 100 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    || password.length > 128) {
    return res.status(400).json({ success: false, error: 'El nombre, correo o contraseña no cumplen el formato permitido.' });
  }

  try {
    if (tienda_id && !(await activeStore(db, tenant_id, tienda_id))) {
      return res.status(400).json({ success: false, error: 'La tienda seleccionada no pertenece a la empresa o está inactiva.' });
    }
    const existingUser = await db.query('SELECT id FROM usuarios WHERE LOWER(email) = $1', [email]);
    if (existingUser.rows.length > 0) {
      return res.status(400).json({ success: false, error: 'El correo electrónico ya está registrado en Fligo.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const result = await db.query(
      `INSERT INTO usuarios (tenant_id, tienda_id, nombre, email, password_hash, rol)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, nombre, email, rol, tienda_id, creado_en`,
      [tenant_id, tienda_id || null, nombre.trim(), email, passwordHash, rol]
    );

    res.status(201).json({
      success: true,
      message: 'Empleado registrado. Deberá verificar su correo la primera vez que inicie sesión.',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error en createEmpleado [Fligo]:', error);
    res.status(500).json({ success: false, error: 'Error al registrar el empleado.' });
  }
};

exports.getProfile = async (req, res) => {
  try {
    const result = await db.query(
      `SELECT u.id, u.nombre, u.email, u.rol, u.tenant_id, u.tienda_id,
              t.nombre_empresa, t.plan, t.prueba_hasta, t.suscripcion_hasta,
              s.nombre as nombre_tienda
       FROM usuarios u
       JOIN tenants t ON u.tenant_id = t.id
      LEFT JOIN tiendas s ON u.tienda_id = s.id AND s.tenant_id = u.tenant_id
       WHERE u.id = $1`,
      [req.user.user_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Usuario de Fligo no encontrado.' });
    }

    const profile = result.rows[0];
    const suscripcion = estadoSuscripcion(profile);
    const esAdminPlataforma = profile.rol === 'SUPERADMIN'
      || (profile.rol === 'OWNER'
        && process.env.FLIGO_PLATFORM_TENANT_ID
        && process.env.FLIGO_PLATFORM_TENANT_ID === profile.tenant_id);
    res.json({
      success: true,
      data: {
        ...profile,
        es_admin_plataforma: Boolean(esAdminPlataforma),
        estado_suscripcion: suscripcion.estado,
        dias_suscripcion: suscripcion.dias_restantes
      }
    });
  } catch (error) {
    console.error('Error en getProfile [Fligo]:', error);
    res.status(500).json({ success: false, error: 'Error al obtener datos del perfil.' });
  }
};
