const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/config/db');
const { registrarVenta } = require('../src/controllers/ventaController');

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