const { Pool } = require('pg');
require('dotenv').config();

const isProduction = process.env.NODE_ENV === 'production';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isProduction ? { rejectUnauthorized: false } : false
});

pool.on('connect', () => {
  console.log('⚡ [Fligo DB] Conexión establecida con PostgreSQL.');
});

pool.on('error', (err) => {
  console.error('❌ [Fligo DB Error] Error inesperado en el pool de conexión:', err);
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool
};