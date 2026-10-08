# Autenticación de Fliigo con Firebase

Firebase Authentication administra las credenciales. PostgreSQL en Render sigue siendo la fuente de verdad para empresas, sucursales, usuarios, roles y suscripciones. El backend verifica el ID token de Firebase y emite el JWT interno de Fligo.

## Configuración en Render

En el servicio backend agrega estas variables de entorno:

- `FIREBASE_PROJECT_ID`: `fliigo`
- `FIREBASE_CLIENT_EMAIL`: correo de la cuenta de servicio usada por Firebase Admin SDK
- `FIREBASE_PRIVATE_KEY`: clave privada de esa cuenta de servicio; guarda el valor como secreto de Render y conserva los saltos de línea (`\n`) si Render lo requiere

Obtén una cuenta de servicio desde Google Cloud Console para el proyecto `fliigo`, con permisos de Firebase Authentication suficientes para verificar tokens y administrar identidades. Nunca pongas esta clave privada en el frontend, Git, Firebase Hosting ni en mensajes.

## Migración y despliegue

1. Haz una copia de seguridad de PostgreSQL.
2. Ejecuta `migrations/003_firebase_auth.sql` una vez en la base PostgreSQL usada por Render.
3. Configura las tres variables anteriores en Render y despliega el backend.
4. Despliega el frontend. La configuración web pública de Firebase está en `js/firebase-client.js`; no contiene credenciales de Admin SDK.
5. En Firebase Authentication, autoriza los dominios reales de Hosting y cualquier dominio local utilizado para desarrollo (por ejemplo, `localhost` o `127.0.0.1`).
6. Prueba registro con correo, el enlace de verificación, Google, restablecimiento de contraseña, una cuenta anterior y una cuenta de empleado.

Los endpoints `/api/auth/login` y `/api/auth/register-tenant` ya no se utilizan ni están publicados: el acceso se realiza mediante `/api/auth/firebase-session`, que rechaza tokens sin correo verificado.

## Cuentas existentes

- Una cuenta existente de correo y contraseña puede iniciar sesión una vez con sus credenciales antiguas. El backend verifica el hash anterior, crea su identidad Firebase sin marcar el correo como verificado y el frontend envía el mensaje de verificación. Tras verificarlo, el backend asocia el UID de Firebase al usuario PostgreSQL existente.
- Los usuarios creados por un administrador también deben verificar su correo en su primer acceso. El administrador entrega la contraseña temporal usando un canal seguro.
- Una cuenta anterior que ya tenga una identidad Firebase con ese correo debe usar el restablecimiento de contraseña de Firebase; no se sobrescribe una identidad existente.
- Los nuevos usuarios con correo se guardan en PostgreSQL al autenticarse después de verificar el correo. Las cuentas nuevas con Google, que ya tiene el correo verificado, se crean al completar el formulario de empresa.

El restablecimiento de contraseña afecta a Firebase Authentication. Ya no modifica ni utiliza `password_hash` de PostgreSQL para iniciar sesión.
