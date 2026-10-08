ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS prueba_hasta TIMESTAMPTZ;

UPDATE tenants
SET prueba_hasta = CURRENT_TIMESTAMP + INTERVAL '7 days'
WHERE prueba_hasta IS NULL
  AND (suscripcion_hasta IS NULL OR suscripcion_hasta <= CURRENT_TIMESTAMP);
