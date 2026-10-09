const test = require('node:test');
const assert = require('node:assert/strict');
const { activeStore, employeeClient, employeeLead, isUuid } = require('../src/utils/tenantValidation');

const tenantId = '11111111-1111-4111-8111-111111111111';
const storeId = '22222222-2222-4222-8222-222222222222';

test('loads HTTP security middleware and authentication routes', () => {
  assert.equal(typeof require('helmet'), 'function');
  assert.equal(typeof require('express-rate-limit').rateLimit, 'function');
  assert.ok(require('../src/routes/authRoutes'));
});

test('rejects invalid UUIDs without querying the database', async () => {
  let queryCount = 0;
  const queryable = { query: async () => { queryCount += 1; return { rows: [] }; } };

  assert.equal(isUuid('not-a-uuid'), false);
  assert.equal(await activeStore(queryable, tenantId, 'not-a-uuid'), false);
  assert.equal(queryCount, 0);
});

test('scopes active store lookup by both store and tenant', async () => {
  let queryText;
  let queryParams;
  const queryable = {
    query: async (text, params) => {
      queryText = text;
      queryParams = params;
      return { rows: [{ id: storeId }] };
    }
  };

  assert.equal(await activeStore(queryable, tenantId, storeId), true);
  assert.match(queryText, /id = \$1 AND tenant_id = \$2 AND activa = TRUE/);
  assert.deepEqual(queryParams, [storeId, tenantId]);
});

test('scopes employee clients to their assigned store', async () => {
  let queryText;
  const queryable = {
    query: async text => {
      queryText = text;
      return { rows: [] };
    }
  };

  assert.equal(await employeeClient(queryable, tenantId, storeId, '33333333-3333-4333-8333-333333333333'), false);
  assert.match(queryText, /tenant_id = \$2 AND tienda_id = \$3 AND activo = TRUE/);
});

test('scopes employee leads to their assigned user', async () => {
  let queryText;
  let queryParams;
  const userId = '55555555-5555-4555-8555-555555555555';
  const queryable = {
    query: async (text, params) => {
      queryText = text;
      queryParams = params;
      return { rows: [{ id: storeId }] };
    }
  };

  assert.equal(await employeeLead(queryable, tenantId, storeId, userId), true);
  assert.match(queryText, /tenant_id = \$2 AND vendedor_id = \$3/);
  assert.deepEqual(queryParams, [storeId, tenantId, userId]);
});