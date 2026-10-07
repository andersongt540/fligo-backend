# Suscripciones y pagos móviles

## Preparación de Render

Antes de usar el módulo:

1. Ejecuta `migrations/001_suscripciones.sql` una sola vez en la base PostgreSQL de Render.
2. En las variables de entorno del servicio backend configura los datos de recepción de Pago Móvil:
   - `PAGO_MOVIL_BANCO`
   - `PAGO_MOVIL_TELEFONO`
   - `PAGO_MOVIL_DOCUMENTO`
   - `PAGO_MOVIL_TITULAR` (opcional)
3. Configura `FLIGO_PLATFORM_TENANT_ID` con el UUID del tenant de la empresa operadora de Fligo. Su usuario `OWNER` puede revisar pagos. Las solicitudes administrativas también aceptan usuarios con rol `SUPERADMIN`.

Para consultar el tenant de la empresa operadora desde PostgreSQL:

```sql
SELECT id, nombre_empresa
FROM tenants
ORDER BY creado_en;
```

No guardes estos valores en Firebase ni en los archivos del frontend.

## Flujo

- Los planes son diaria (USD 3 por 1 día), semanal (USD 7 por 7 días) y mensual (USD 20 por 30 días).
- El backend consulta la tasa USD del BCV, calcula el monto en bolívares y compara el monto reportado con el importe esperado en el momento de enviar la solicitud.
- El titular informa teléfono, documento del pagador, monto, referencia y fecha. No se solicita ni almacena ninguna clave bancaria.
- La solicitud queda `PENDIENTE`. Un usuario administrativo verifica el abono en Mercantil y la aprueba o rechaza desde Fligo.
- Al aprobar, el plan y la fecha de vencimiento del tenant se actualizan. La duración aprobada se suma al vencimiento vigente si la suscripción aún no ha expirado.

La cuenta personal de Pago Móvil no expone una confirmación automática al backend. Por ello, este flujo no activa pagos por sí solo: la aprobación manual es necesaria hasta contratar una cuenta/API de cobros que permita verificar abonos de manera segura.

El módulo registra la fecha de vencimiento, pero no bloquea actualmente el acceso de una empresa vencida. La aplicación de restricciones requiere definir primero qué acceso conservar para las empresas existentes y sus datos.
