# Ventas a crédito y seguimiento de deudas

Las ventas a crédito se registran desde el formulario de Ventas con el botón **Registrar venta a crédito**. Es obligatorio seleccionar un cliente; la venta descuenta inventario como las demás, queda con pago pendiente y aparece en **Deudas**, ordenada desde la más antigua. Al confirmar el pago, selecciona el método recibido y usa **Liquidar**. La venta se conserva en el historial con el método registrado, saldo cero y una nota de auditoría. Un pago en USD o EUR añade al total el IGTF estimado del 3%, calculado con la tasa BCV del momento.

## Despliegue de base de datos

Antes de desplegar esta versión del backend, ejecuta una vez `migrations/004_ventas_credito.sql` en la base PostgreSQL de Render. La migración conserva las ventas existentes como pagadas y agrega el estado y saldo necesarios para las nuevas ventas. El script es seguro para volver a ejecutar.

El usuario de base de datos necesita permiso para alterar `ventas` y crear el índice. No se requiere cambiar variables de entorno ni instalar dependencias.
