async function findTenantRecord(queryable, table, tenantId, recordId, activeColumn) {
  if (!isUuid(recordId) || !isUuid(tenantId)) return false;
  const allowedTables = {
    tiendas: 'tiendas',
    clientes: 'clientes',
    usuarios: 'usuarios',
    leads: 'leads',
    productos: 'productos'
  };
  const allowedActiveColumns = { activa: 'activa', activo: 'activo' };
  const safeTable = allowedTables[table];
  const safeActiveColumn = activeColumn ? allowedActiveColumns[activeColumn] : null;
  if (!safeTable || (activeColumn && !safeActiveColumn)) throw new Error('Entidad de tenant no permitida.');

  const activeFilter = safeActiveColumn ? ` AND ${safeActiveColumn} = TRUE` : '';
  const result = await queryable.query(
    `SELECT id FROM ${safeTable} WHERE id = $1 AND tenant_id = $2${activeFilter}`,
    [recordId, tenantId]
  );
  return result.rows.length > 0;
}

function isUuid(value) {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

module.exports = {
  isUuid,
  employeeClient: async (queryable, tenantId, clientId, storeId) => {
    if (!isUuid(tenantId) || !isUuid(clientId) || !isUuid(storeId)) return false;
    const result = await queryable.query(
      'SELECT id FROM clientes WHERE id = $1 AND tenant_id = $2 AND tienda_id = $3 AND activo = TRUE',
      [clientId, tenantId, storeId]
    );
    return result.rows.length > 0;
  },
  employeeLead: async (queryable, tenantId, leadId, userId) => {
    if (!isUuid(tenantId) || !isUuid(leadId) || !isUuid(userId)) return false;
    const result = await queryable.query(
      'SELECT id FROM leads WHERE id = $1 AND tenant_id = $2 AND vendedor_id = $3',
      [leadId, tenantId, userId]
    );
    return result.rows.length > 0;
  },
  activeStore: (queryable, tenantId, storeId) => findTenantRecord(queryable, 'tiendas', tenantId, storeId, 'activa'),
  activeClient: (queryable, tenantId, clientId) => findTenantRecord(queryable, 'clientes', tenantId, clientId, 'activo'),
  activeUser: (queryable, tenantId, userId) => findTenantRecord(queryable, 'usuarios', tenantId, userId, 'activo'),
  activeLead: (queryable, tenantId, leadId) => findTenantRecord(queryable, 'leads', tenantId, leadId),
  activeProduct: (queryable, tenantId, productId) => findTenantRecord(queryable, 'productos', tenantId, productId, 'activo')
};