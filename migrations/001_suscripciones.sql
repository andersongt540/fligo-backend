ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS suscripcion_hasta TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS solicitudes_suscripcion (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  plan VARCHAR(20) NOT NULL CHECK (plan IN ('diaria', 'semanal', 'mensual')),
  precio_usd NUMERIC(10, 2) NOT NULL CHECK (precio_usd > 0),
  tasa_bcv NUMERIC(14, 6) NOT NULL CHECK (tasa_bcv > 0),
  monto_bs NUMERIC(14, 2) NOT NULL CHECK (monto_bs > 0),
  telefono_pagador VARCHAR(24) NOT NULL,
  documento_pagador VARCHAR(20) NOT NULL,
  referencia_pago VARCHAR(24) NOT NULL,
  fecha_pago DATE NOT NULL,
  estado VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE'
    CHECK (estado IN ('PENDIENTE', 'APROBADA', 'RECHAZADA')),
  comentario_revision VARCHAR(500),
  revisada_por UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revisado_en TIMESTAMPTZ,
  UNIQUE (fecha_pago, referencia_pago)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_suscripciones_una_pendiente_por_empresa
  ON solicitudes_suscripcion (tenant_id)
  WHERE estado = 'PENDIENTE';

CREATE INDEX IF NOT EXISTS idx_suscripciones_estado_fecha
  ON solicitudes_suscripcion (estado, creado_en);

CREATE INDEX IF NOT EXISTS idx_suscripciones_tenant_fecha
  ON solicitudes_suscripcion (tenant_id, creado_en DESC);
