const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
require('dotenv').config();

if (process.env.NODE_ENV === 'production') {
  const missingConfig = ['DATABASE_URL', 'JWT_SECRET'].filter(key => !process.env[key]);
  if (missingConfig.length) {
    throw new Error(`Falta configuración obligatoria de producción: ${missingConfig.join(', ')}`);
  }
}

// Importación de Rutas de Todos los Módulos de Fligo
const authRoutes = require('./routes/authRoutes');
const clienteRoutes = require('./routes/clienteRoutes');
const productoRoutes = require('./routes/productoRoutes');
const ventaRoutes = require('./routes/ventaRoutes');
const reporteRoutes = require('./routes/reporteRoutes');
const leadRoutes = require('./routes/leadRoutes');
const comunicacionRoutes = require('./routes/comunicacionRoutes');
const configuracionRoutes = require('./routes/configuracionRoutes');
const suscripcionRoutes = require('./routes/suscripcionRoutes');

const app = express();
const defaultOrigins = process.env.NODE_ENV === 'production'
  ? ['https://fliigo.web.app', 'https://fliigo.app']
  : ['https://fliigo.web.app', 'https://fliigo.app', 'http://localhost:5500', 'http://127.0.0.1:5500', 'http://localhost:3000', 'http://127.0.0.1:3000'];
const allowedOrigins = new Set((process.env.CORS_ORIGINS || defaultOrigins.join(','))
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean));

// Middlewares Globales
if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);
app.use(helmet());
app.use(cors({
  origin: (origin, callback) => callback(null, !origin || allowedOrigins.has(origin)),
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Authorization', 'Content-Type']
}));
app.use(express.json({ limit: '256kb' }));

// Endpoint de Diagnóstico y Salud de la API
app.get('/api/health', (req, res) => {
  res.json({ 
    app: 'Fligo Engine API', 
    status: 'ONLINE', 
    timestamp: new Date() 
  });
});

// Registro de Rutas Mapeadas por Módulo en Fligo
app.use('/api/auth', authRoutes);
app.use('/api/clientes', clienteRoutes);
app.use('/api/productos', productoRoutes);
app.use('/api/reportes', reporteRoutes);
app.use('/api/leads', leadRoutes);
app.use('/api/comunicaciones', comunicacionRoutes);
app.use('/api/configuracion', configuracionRoutes);
app.use('/api/suscripciones', suscripcionRoutes);
app.use('/api', ventaRoutes);

// Manejo de Rutas Inexistentes (404)
app.use((req, res) => {
  res.status(404).json({ 
    success: false, 
    error: 'Ruta no encontrada en Fligo API.' 
  });
});

// Manejo Global de Errores (500)
app.use((err, req, res, next) => {
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ success: false, error: 'El cuerpo de la solicitud supera el tamaño permitido.' });
  }
  console.error('❌ [Fligo Internal Error]:', err.stack);
  res.status(500).json({
    success: false,
    error: 'Error interno del servidor en Fligo API.'
  });
});

const PORT = process.env.PORT || 10000;

app.listen(PORT, () => {
  console.log(`🚀 [Fligo Engine] Servidor iniciado correctamente en el puerto ${PORT}`);
});

module.exports = app;