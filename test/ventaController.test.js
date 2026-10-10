const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/config/db');
const configuracionController = require('../src/controllers/configuracionController');
const { registrarVenta, liquidarDeuda } = require('../src/controllers/ventaController');

const tenantId = '11111111-1111-4111-8111-111111111111';
const storeId = '22222222-2222-4222-8222-222222222222';
const customerId = '33333333-3333-4333-8333-333333333333';
const productId = '44444444-4444-4444-8444-444444444444';
const originalConnect = db.pool.connect;

function makeResponse() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

test('rejects negative sale quantities before opening a database connection', async () => {
  let connectCount = 0;
  db.pool.connect = async () => { connectCount += 1; throw new Error('Unexpected DB connection'); };

  const response = makeResponse();
  await registrarVenta({
    user: { tenant_id: tenantId, tienda_id: storeId, user_id: customerId, rol: 'OWNER' },
    body: { tienda_id: storeId, metodo_pago: 'EFECTIVO', productos: [{ producto_id: productId, cantidad: -1 }] }
  }, response);

  assert.equal(response.statusCode, 400);
  assert.equal(connectCount, 0);
});

test('requires a client when registering a credit sale', async () => {
  let connectCount = 0;
  db.pool.connect = async () => { connectCount += 1; throw new Error('Unexpected DB connection'); };

  try {
    const response = makeResponse();
    await registrarVenta({
      user: { tenant_id: tenantId, tienda_id: storeId, user_id: customerId, rol: 'OWNER' },
      body: { tienda_id: storeId, metodo_pago: 'CREDITO', productos: [{ producto_id: productId, cantidad: 1 }] }
    }, response);

    assert.equal(response.statusCode, 400);
    assert.equal(connectCount, 0);
  } finally {
    db.pool.connect = originalConnect;
  }
});

test('records a credit sale with the full total as pending balance', async () => {
  const queries = [];
  let saleParams;
  db.pool.connect = async () => ({
    query: async (text, params) => {
      queries.push(text);
      if (text.includes('SELECT id FROM tiendas')) return { rows: [{ id: storeId }] };
      if (text.includes('SELECT id FROM clientes')) return { rows: [{ id: customerId }] };
      if (text.includes('SELECT p.id, p.precio_base')) return { rows: [{ id: productId, precio_base: '25.00', stock_actual: 5 }] };
      if (text.includes('INSERT INTO ventas')) {
        saleParams = params;
        return { rows: [{ id: '55555555-5555-4555-8555-555555555555' }] };
      }
      return { rows: [] };
    },
    release() {}
  });

  try {
    const response = makeResponse();
    await registrarVenta({
      user: { tenant_id: tenantId, tienda_id: storeId, user_id: customerId, rol: 'OWNER' },
      body: {
        tienda_id: storeId,
        cliente_id: customerId,
        metodo_pago: 'CREDITO',
        productos: [{ producto_id: productId, cantidad: 1 }]
      }
    }, response);

    assert.equal(response.statusCode, 201);
    assert.equal(saleParams[5], 'CREDITO');
    assert.equal(saleParams[11], 'PENDIENTE');
    assert.equal(saleParams[12], 25);
    assert.equal(queries.includes('COMMIT'), true);
  } finally {
    db.pool.connect = originalConnect;
  }
});

test('settles a pending sale and records the selected payment method', async () => {
  const queries = [];
  db.pool.connect = async () => ({
    query: async (text, params) => {
      queries.push({ text, params });
      if (text.includes('SELECT id, tienda_id, estado, estado_pago')) {
        return { rows: [{ id: '55555555-5555-4555-8555-555555555555', tienda_id: storeId, estado: 'COMPLETADA', estado_pago: 'PENDIENTE', total: '25.00' }] };
      }
      if (text.includes('UPDATE ventas')) return { rows: [{ id: params[3], metodo_pago: params[0], estado_pago: 'PAGADA', saldo_pendiente: '0.00' }] };
      return { rows: [] };
    },
    release() {}
  });

  try {
    const response = makeResponse();
    await liquidarDeuda({
      params: { id: '55555555-5555-4555-8555-555555555555' },
      body: { metodo_pago: 'PAGO_MOVIL' },
      user: { tenant_id: tenantId, tienda_id: storeId, rol: 'OWNER' }
    }, response);

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.data.estado_pago, 'PAGADA');
    assert.equal(response.body.data.saldo_pendiente, '0.00');
    assert.equal(queries.find(query => query.text.includes('UPDATE ventas')).params[0], 'PAGO_MOVIL');
    assert.equal(queries.some(query => query.text === 'COMMIT'), true);
  } finally {
    db.pool.connect = originalConnect;
  }
});

test('settles a pending sale using multiple payment methods and records the breakdown', async () => {
  const queries = [];
  const originalGetRates = configuracionController.obtenerDatosTasasBcv;
  configuracionController.obtenerDatosTasasBcv = async () => ({ usd_ves: 50, eur_ves: 55 });
  db.pool.connect = async () => ({
    query: async (text, params) => {
      queries.push({ text, params });
      if (text.includes('SELECT id, tienda_id, estado, estado_pago')) {
        return { rows: [{
          id: '55555555-5555-4555-8555-555555555555',
          tienda_id: storeId,
          estado: 'COMPLETADA',
          estado_pago: 'PENDIENTE',
          total: '25.00',
          saldo_pendiente: '25.00'
        }] };
      }
      if (text.includes('UPDATE ventas')) {
        return { rows: [{ id: params[3], metodo_pago: params[0], estado_pago: 'PAGADA', saldo_pendiente: '0.00' }] };
      }
      return { rows: [] };
    },
    release() {}
  });

  try {
    const response = makeResponse();
    await liquidarDeuda({
      params: { id: '55555555-5555-4555-8555-555555555555' },
      body: {
        pagos: [
          { metodo_pago: 'EFECTIVO', moneda: 'VES', monto: 1007.5 },
          { metodo_pago: 'DIVISA', moneda: 'USD', monto: 5 }
        ]
      },
      user: { tenant_id: tenantId, tienda_id: storeId, rol: 'OWNER' }
    }, response);

    const update = queries.find(query => query.text.includes('UPDATE ventas'));
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.data.estado_pago, 'PAGADA');
    assert.equal(response.body.igtf_bs, 7.5);
    assert.equal(update.params[0], 'MIXTO');
    assert.equal(update.params[1], 0.15);
    assert.match(update.params[2], /EFECTIVO 1007\.50 VES; DIVISA USD 5\.00 USD/);
    assert.match(update.text, /NULLIF\(\$3::text, ''\)/);
    assert.equal(queries.some(query => query.text === 'COMMIT'), true);
  } finally {
    configuracionController.obtenerDatosTasasBcv = originalGetRates;
    db.pool.connect = originalConnect;
  }
});

test('rejects a customer from another tenant before inserting a sale', async () => {
  const queries = [];
  db.pool.connect = async () => ({
    query: async (text, params) => {
      queries.push({ text, params });
      if (text.includes('SELECT id FROM tiendas')) return { rows: [{ id: storeId }] };
      if (text.includes('SELECT id FROM clientes')) return { rows: [] };
      return { rows: [] };
    },
    release() {}
  });

  try {
    const response = makeResponse();
    await registrarVenta({
      user: { tenant_id: tenantId, tienda_id: storeId, user_id: customerId, rol: 'OWNER' },
      body: {
        tienda_id: storeId,
        cliente_id: customerId,
        metodo_pago: 'EFECTIVO',
        productos: [{ producto_id: productId, cantidad: 1 }]
      }
    }, response);

    assert.equal(response.statusCode, 404);
    assert.equal(queries.some(query => query.text.includes('INSERT INTO ventas')), false);
    assert.equal(queries.some(query => query.text === 'ROLLBACK'), true);
  } finally {
    db.pool.connect = originalConnect;
  }
});