const db = require('../config/db');
const https = require('https');

let tasaBcvCache = null;
let tasaBcvFetchedAt = 0;
const BCV_CACHE_DURATION_MS = 60 * 60 * 1000;

function parseTasaBcv(html, id) {
  const block = html.match(new RegExp(`<div\\b[^>]*\\bid=["']${id}["'][^>]*>([\\s\\S]*?)<\\/div>\\s*<\\/div>\\s*<\\/div>`, 'i'));
  const value = block?.[1].match(/<strong\b[^>]*>([\s\S]*?)<\/strong>/i)?.[1]
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .trim();
  if (!value) throw new Error(`El BCV no publicó la tasa ${id === 'dolar' ? 'USD' : 'EUR'}.`);
  const rate = Number(value.replace(/\./g, '').replace(',', '.'));
  if (!Number.isFinite(rate) || rate <= 0) throw new Error(`La tasa ${id} publicada por el BCV no es válida.`);
  return rate;
}

function downloadPaginaBcv() {
  return new Promise((resolve, reject) => {
    const request = https.get('https://www.bcv.org.ve/', {
      headers: { 'User-Agent': 'Fligo CRM/1.0 (consulta de tipo de cambio)', Accept: 'text/html' }
    }, response => {
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`El BCV respondió HTTP ${response.statusCode}.`));
        return;
      }
      let html = '';
      response.setEncoding('utf8');
      response.on('data', chunk => {
        html += chunk;
        if (html.length > 5_000_000) request.destroy(new Error('La página del BCV superó el tamaño permitido.'));
      });
      response.on('end', () => resolve(html));
      response.on('error', reject);
    });
    request.setTimeout(8000, () => request.destroy(new Error('La consulta al BCV excedió el tiempo límite.')));
    request.on('error', reject);
  });
}

exports.obtenerTasasBcv = async (req, res) => {
  if (tasaBcvCache && Date.now() - tasaBcvFetchedAt < BCV_CACHE_DURATION_MS) {
    return res.json({ success: true, data: tasaBcvCache });
  }
  try {
    const html = await downloadPaginaBcv();
    const fechaValor = html.match(/Fecha\s+Valor:\s*(?:<[^>]*>\s*)*([^<]+)/i)?.[1]
      ?.replace(/<[^>]*>/g, '')
      .replace(/&nbsp;|&#160;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/\s+/g, ' ')
      .trim();
    const tasas = {
      usd_ves: parseTasaBcv(html, 'dolar'),
      eur_ves: parseTasaBcv(html, 'euro'),
      fecha_valor: fechaValor || null,
      actualizado_en: new Date().toISOString(),
      fuente: 'Banco Central de Venezuela'
    };
    tasaBcvCache = tasas;
    tasaBcvFetchedAt = Date.now();
    return res.json({ success: true, data: tasas });
  } catch (error) {
    console.error('Error en obtenerTasasBcv [BCV]:', error);
    return res.status(502).json({
      success: false,
      error: 'No fue posible consultar la tasa de referencia del BCV.',
      detail: error.message
    });
  }
};

exports.parseTasasBcv = html => ({
  usd_ves: parseTasaBcv(html, 'dolar'),
  eur_ves: parseTasaBcv(html, 'euro'),
  fecha_valor: html.match(/Fecha\s+Valor:\s*(?:<[^>]*>\s*)*([^<]+)/i)?.[1]?.replace(/\s+/g, ' ').trim() || null
});

// 1. Obtener o crear configuración global de la empresa
exports.obtenerConfiguracion = async (req, res) => {
  const tenant_id = req.user.tenant_id;

  try {
    let result = await db.query(
      `SELECT c.*, t.nombre_empresa, t.plan 
       FROM configuracion_empresa c
       RIGHT JOIN tenants t ON c.tenant_id = t.id
       WHERE t.id = $1`,
      [tenant_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Empresa no encontrada.' });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('Error en obtenerConfiguracion [Fligo]:', error);
    res.status(500).json({ success: false, error: 'Error al obtener la configuración de la empresa.' });
  }
};

// 2. Actualizar configuración de la empresa (Moneda, Tasa, Impuestos)
exports.actualizarConfiguracion = async (req, res) => {
  const tenant_id = req.user.tenant_id;
  const { logo_url, moneda_principal, simbolo_moneda, impuesto_defecto, tasa_cambio, direccion_fiscal, documento_fiscal } = req.body;

  try {
    const result = await db.query(
      `INSERT INTO configuracion_empresa (tenant_id, logo_url, moneda_principal, simbolo_moneda, impuesto_defecto, tasa_cambio, direccion_fiscal, documento_fiscal)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (tenant_id) DO UPDATE SET
         logo_url = COALESCE(EXCLUDED.logo_url, configuracion_empresa.logo_url),
         moneda_principal = COALESCE(EXCLUDED.moneda_principal, configuracion_empresa.moneda_principal),
         simbolo_moneda = COALESCE(EXCLUDED.simbolo_moneda, configuracion_empresa.simbolo_moneda),
         impuesto_defecto = COALESCE(EXCLUDED.impuesto_defecto, configuracion_empresa.impuesto_defecto),
         tasa_cambio = COALESCE(EXCLUDED.tasa_cambio, configuracion_empresa.tasa_cambio),
         direccion_fiscal = COALESCE(EXCLUDED.direccion_fiscal, configuracion_empresa.direccion_fiscal),
         documento_fiscal = COALESCE(EXCLUDED.documento_fiscal, configuracion_empresa.documento_fiscal),
         actualizado_en = CURRENT_TIMESTAMP
       RETURNING *`,
      [tenant_id, logo_url || null, moneda_principal || 'USD', simbolo_moneda || '$', impuesto_defecto || 16.00, tasa_cambio || 1.0000, direccion_fiscal || null, documento_fiscal || null]
    );

    res.json({
      success: true,
      message: 'Configuración de la empresa actualizada con éxito en Fligo.',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error en actualizarConfiguracion [Fligo]:', error);
    res.status(500).json({ success: false, error: 'Error al guardar la configuración.' });
  }
};

// 3. Crear nueva Sucursal / Tienda en la Empresa
exports.crearTienda = async (req, res) => {
  const { nombre, direccion, telefono } = req.body;
  const tenant_id = req.user.tenant_id;

  if (!nombre) {
    return res.status(400).json({ success: false, error: 'El nombre de la tienda es obligatorio.' });
  }

  try {
    const result = await db.query(
      `INSERT INTO tiendas (tenant_id, nombre, direccion, telefono)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [tenant_id, nombre, direccion || null, telefono || null]
    );

    res.status(201).json({
      success: true,
      message: 'Nueva tienda registrada en Fligo.',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error en crearTienda [Fligo]:', error);
    res.status(500).json({ success: false, error: 'Error al crear la tienda.' });
  }
};

// 4. Listar todas las tiendas de la empresa
exports.obtenerTiendas = async (req, res) => {
  const tenant_id = req.user.tenant_id;

  try {
    const result = await db.query(
      `SELECT * FROM tiendas WHERE tenant_id = $1 AND activa = TRUE ORDER BY creado_en ASC`,
      [tenant_id]
    );

    res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error('Error en obtenerTiendas [Fligo]:', error);
    res.status(500).json({ success: false, error: 'Error al obtener la lista de tiendas.' });
  }
};