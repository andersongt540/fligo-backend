const express = require('express');
const cors = require('cors');
require('dotenv').config();

// Importación de Rutas de Todos los Módulos de Fligo
const authRoutes = require('./routes/authRoutes');
const clienteRoutes = require('./routes/clienteRoutes');
const productoRoutes = require('./routes/productoRoutes');
const ventaRoutes = require('./routes/ventaRoutes');
const reporteRoutes = require('./routes/reporteRoutes');
const leadRoutes = require('./routes/leadRoutes');
const comunicacionRoutes = require('./routes/comunicacionRoutes');
const configuracionRoutes = require('./routes/configuracionRoutes');

const app = express();

// Middlewares Globales
app.use(cors());
app.use(express.json());

// Endpoint de Diagnóstico y Salud de la API
app.get('/api/health', (req, res) => {
  res.json({ 
    app: 'Fligo Engine API', 
    status: 'ONLINE', 
    environment: process.env.NODE_ENV || 'development',
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