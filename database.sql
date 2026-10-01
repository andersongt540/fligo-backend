-- Creación de la base de datos para Fligo
-- CREATE DATABASE fligo_db;

-- Habilitar extensión para UUIDs
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Tabla de Inquilinos / Empresas (Tenants de Fligo)
CREATE TABLE tenants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    nombre_empresa VARCHAR(150) NOT NULL,
    plan VARCHAR(50) DEFAULT 'basic',
    activo BOOLEAN DEFAULT TRUE,
    creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tabla de Tiendas / Sucursales por Empresa
CREATE TABLE tiendas (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    nombre VARCHAR(100) NOT NULL,
    direccion TEXT,
    telefono VARCHAR(30),
    activa BOOLEAN DEFAULT TRUE,
    creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tabla de Usuarios / Empleados de Fligo
-- Roles: 'SUPERADMIN', 'OWNER', 'MANAGER', 'EMPLOYEE'
CREATE TABLE usuarios (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    tienda_id UUID REFERENCES tiendas(id) ON DELETE SET NULL, -- NULL si es OWNER
    nombre VARCHAR(100) NOT NULL,
    email VARCHAR(120) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    rol VARCHAR(30) NOT NULL DEFAULT 'EMPLOYEE',
    activo BOOLEAN DEFAULT TRUE,
    creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
-- Tabla de Clientes de Fligo (Multi-Tenant y Multi-Tienda)
CREATE TABLE clientes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    tienda_id UUID REFERENCES tiendas(id) ON DELETE SET NULL, -- Tienda de origen/preferida
    nombre VARCHAR(120) NOT NULL,
    documento_identidad VARCHAR(50), -- RIF, Cédula, DNI, Pass
    email VARCHAR(120),
    telefono VARCHAR(30),
    direccion TEXT,
    categoria VARCHAR(50) DEFAULT 'General', -- 'VIP', 'Mayorista', 'Frecuente', 'General'
    notas TEXT,
    activo BOOLEAN DEFAULT TRUE,
    creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    actualizado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
-- Tabla de Productos Centralizados en Fligo
CREATE TABLE productos (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    codigo_sku VARCHAR(50) NOT NULL,
    codigo_barras VARCHAR(100),
    nombre VARCHAR(150) NOT NULL,
    descripcion TEXT,
    categoria VARCHAR(80) DEFAULT 'General',
    precio_base DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    costo DECIMAL(12, 2) DEFAULT 0.00,
    activo BOOLEAN DEFAULT TRUE,
    creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    actualizado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_sku_per_tenant UNIQUE (tenant_id, codigo_sku)
);

-- Tabla de Inventario por Sucursal/Tienda
CREATE TABLE inventario_tienda (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    tienda_id UUID NOT NULL REFERENCES tiendas(id) ON DELETE CASCADE,
    producto_id UUID NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
    stock_actual INT NOT NULL DEFAULT 0,
    stock_minimo INT NOT NULL DEFAULT 5,
    actualizado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_producto_tienda UNIQUE (tienda_id, producto_id)
);

-- Tabla para Historial y Trazabilidad de Movimientos
-- Tipos: 'ENTRADA', 'SALIDA', 'AJUSTE', 'VENTA', 'TRANSFERENCIA'
CREATE TABLE movimientos_inventario (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    tienda_id UUID NOT NULL REFERENCES tiendas(id) ON DELETE CASCADE,
    producto_id UUID NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
    usuario_id UUID REFERENCES usuarios(id) ON DELETE SET NULL,
    tipo_movimiento VARCHAR(30) NOT NULL,
    cantidad INT NOT NULL,
    stock_resultante INT NOT NULL,
    motivo TEXT,
    creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
-- Tabla de Cotizaciones / Presupuestos en Fligo
CREATE TABLE cotizaciones (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    tienda_id UUID NOT NULL REFERENCES tiendas(id) ON DELETE CASCADE,
    cliente_id UUID REFERENCES clientes(id) ON DELETE SET NULL,
    usuario_id UUID REFERENCES usuarios(id) ON DELETE SET NULL,
    subtotal DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    impuesto DECIMAL(12, 2) DEFAULT 0.00,
    descuento DECIMAL(12, 2) DEFAULT 0.00,
    total DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    estado VARCHAR(30) DEFAULT 'PENDIENTE', -- 'PENDIENTE', 'APROBADA', 'RECHAZADA', 'CONVERTIDA'
    notas TEXT,
    creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Detalle de Ítems en Cotización
CREATE TABLE detalle_cotizacion (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    cotizacion_id UUID NOT NULL REFERENCES cotizaciones(id) ON DELETE CASCADE,
    producto_id UUID REFERENCES productos(id) ON DELETE SET NULL,
    cantidad INT NOT NULL DEFAULT 1,
    precio_unitario DECIMAL(12, 2) NOT NULL,
    subtotal DECIMAL(12, 2) NOT NULL
);

-- Tabla de Ventas / Pedidos POS en Fligo
CREATE TABLE ventas (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    tienda_id UUID NOT NULL REFERENCES tiendas(id) ON DELETE CASCADE,
    cliente_id UUID REFERENCES clientes(id) ON DELETE SET NULL,
    usuario_id UUID REFERENCES usuarios(id) ON DELETE SET NULL,
    cotizacion_id UUID REFERENCES cotizaciones(id) ON DELETE SET NULL,
    metodo_pago VARCHAR(50) NOT NULL, -- 'EFECTIVO', 'PAGO_MOVIL', 'TRANSFERENCIA', 'TARJETA', 'DIVISA'
    subtotal DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    impuesto DECIMAL(12, 2) DEFAULT 0.00,
    descuento DECIMAL(12, 2) DEFAULT 0.00,
    total DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    estado VARCHAR(30) DEFAULT 'COMPLETADA', -- 'COMPLETADA', 'ANULADA'
    notas TEXT,
    creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Detalle de Ítems de la Venta
CREATE TABLE detalle_venta (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    venta_id UUID NOT NULL REFERENCES ventas(id) ON DELETE CASCADE,
    producto_id UUID REFERENCES productos(id) ON DELETE SET NULL,
    cantidad INT NOT NULL DEFAULT 1,
    precio_unitario DECIMAL(12, 2) NOT NULL,
    subtotal DECIMAL(12, 2) NOT NULL
);
-- =========================================================
-- MÓDULO 6: EMBUDO DE VENTAS Y PROSPECTOS (LEADS & PIPELINE)
-- =========================================================
CREATE TABLE leads (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    tienda_id UUID REFERENCES tiendas(id) ON DELETE SET NULL,
    vendedor_id UUID REFERENCES usuarios(id) ON DELETE SET NULL,
    cliente_id UUID REFERENCES clientes(id) ON DELETE SET NULL,
    nombre VARCHAR(120) NOT NULL,
    email VARCHAR(120),
    telefono VARCHAR(30),
    empresa_origen VARCHAR(120),
    valor_estimado DECIMAL(12, 2) DEFAULT 0.00,
    etapa VARCHAR(50) DEFAULT 'NUEVO', -- 'NUEVO', 'CONTACTADO', 'COTIZADO', 'NEGOCIACION', 'GANADO', 'PERDIDO'
    motivo_cierre TEXT,
    creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    actualizado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE tareas_lead (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    usuario_id UUID REFERENCES usuarios(id) ON DELETE SET NULL,
    titulo VARCHAR(150) NOT NULL,
    descripcion TEXT,
    tipo VARCHAR(50) DEFAULT 'LLAMADA', -- 'LLAMADA', 'REUNION', 'EMAIL', 'WHATSAPP', 'OTRO'
    fecha_vencimiento TIMESTAMP NOT NULL,
    completada BOOLEAN DEFAULT FALSE,
    creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =========================================================
-- MÓDULO 7: COMUNICACIONES E INTERACCIONES (OMNICANAL)
-- =========================================================
CREATE TABLE interacciones (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    cliente_id UUID REFERENCES clientes(id) ON DELETE CASCADE,
    lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
    usuario_id UUID REFERENCES usuarios(id) ON DELETE SET NULL,
    canal VARCHAR(50) NOT NULL, -- 'WHATSAPP', 'EMAIL', 'LLAMADA', 'NOTA_INTERNA'
    mensaje TEXT NOT NULL,
    metadata JSONB, -- Datos adicionales (ej: ID mensaje WhatsApp, estado de entrega)
    creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =========================================================
-- MÓDULO 8: CONFIGURACIÓN DE EMPRESA Y SUSCRIPCIÓN SAAS
-- =========================================================
CREATE TABLE configuracion_empresa (
    tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
    logo_url TEXT,
    moneda_principal VARCHAR(10) DEFAULT 'USD',
    simbolo_moneda VARCHAR(5) DEFAULT '$',
    impuesto_defecto DECIMAL(5, 2) DEFAULT 16.00,
    tasa_cambio DECIMAL(12, 4) DEFAULT 1.0000,
    direccion_fiscal TEXT,
    documento_fiscal VARCHAR(50), -- RIF / NIT / DNI Fiscal
    actualizado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ÍNDICES PARA RENDIMIENTO
CREATE INDEX idx_leads_tenant_etapa ON leads(tenant_id, etapa);
CREATE INDEX idx_tareas_lead ON tareas_lead(lead_id, fecha_vencimiento);
CREATE INDEX idx_interacciones_cliente ON interacciones(cliente_id);
CREATE INDEX idx_interacciones_lead ON interacciones(lead_id);

-- Índices para optimización de reportes y consultas
CREATE INDEX idx_ventas_tenant_tienda ON ventas(tenant_id, tienda_id);
CREATE INDEX idx_ventas_fecha ON ventas(creado_en);
CREATE INDEX idx_cotizaciones_tenant_tienda ON cotizaciones(tenant_id, tienda_id);

-- Índices de Rendimiento
CREATE INDEX idx_productos_tenant ON productos(tenant_id);
CREATE INDEX idx_productos_busqueda ON productos(tenant_id, codigo_sku, codigo_barras, nombre);
CREATE INDEX idx_inventario_tienda ON inventario_tienda(tienda_id, producto_id);
CREATE INDEX idx_movimientos_tenant_tienda ON movimientos_inventario(tenant_id, tienda_id);

-- Índices para búsquedas rápidas y aislamiento
CREATE INDEX idx_clientes_tenant ON clientes(tenant_id);
CREATE INDEX idx_clientes_tienda ON clientes(tienda_id);
CREATE INDEX idx_clientes_busqueda ON clientes(tenant_id, nombre, documento_identidad, email);

-- Índices de rendimiento
CREATE INDEX idx_tiendas_tenant ON tiendas(tenant_id);
CREATE INDEX idx_usuarios_tenant ON usuarios(tenant_id);
CREATE INDEX idx_usuarios_tienda ON usuarios(tienda_id);