ALTER TABLE ventas
  ADD COLUMN IF NOT EXISTS estado_pago VARCHAR(20) NOT NULL DEFAULT 'PAGADA',
  ADD COLUMN IF NOT EXISTS saldo_pendiente DECIMAL(12, 2) NOT NULL DEFAULT 0.00;

CREATE INDEX IF NOT EXISTS idx_ventas_deudas_pendientes
  ON ventas (tenant_id, tienda_id, creado_en DESC)
  WHERE estado_pago = 'PENDIENTE';
