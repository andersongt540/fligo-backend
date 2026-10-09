# Autenticación de Fliigo con Firebase

Firebase Authentication administra las credenciales. PostgreSQL en Render sigue siendo la fuente de verdad para empresas, sucursales, usuarios, roles y suscripciones. El backend verifica el ID token de Firebase y emite el JWT interno de Fligo.

## Verificación sin claves privadas

El backend inicializa Firebase Admin únicamente con el ID público del proyecto (`fliigo`) y usa `verifyIdToken()`. Para verificar la firma, el SDK descarga y almacena en caché los certificados públicos de firma que publica Google para Firebase Authentication. La comprobación de firma y de los claims del ID token no requiere una clave privada ni una cuenta de servicio con permisos para administrar usuarios.

No configures `FIREBASE_CLIENT_EMAIL` ni `FIREBASE_PRIVATE_KEY` en Render. `FIREBASE_PROJECT_ID` es opcional; si no se define, el backend usa `fliigo`.

Por esta decisión el backend no crea identidades en Firebase Admin. El usuario se registra desde el SDK web, y Firebase verifica el correo; Render únicamente crea/vincula la cuenta de negocio después de verificar el ID token.

## Migración y despliegue

1. Haz una copia de seguridad de PostgreSQL.
2. Ejecuta `migrations/003_firebase_auth.sql` una vez en la base PostgreSQL usada por Render.
3. Despliega el backend; no necesita credenciales privadas de Firebase.
4. Despliega el frontend. La configuración web pública de Firebase está en `js/firebase-client.js`.
5. En Firebase Authentication, autoriza los dominios reales de Hosting y cualquier dominio local utilizado para desarrollo (por ejemplo, `localhost` o `127.0.0.1`).
6. Prueba registro con correo, el enlace de verificación, Google, restablecimiento de contraseña, una cuenta anterior y una cuenta de empleado.

## Configuración de seguridad del backend

- Configura `CORS_ORIGINS` en Render como una lista separada por comas de los orígenes exactos que sirven el frontend, por ejemplo `https://fliigo.web.app,https://fliigo.app`. No incluyas comodines ni localhost en producción.
- En producción son obligatorios `DATABASE_URL` y `JWT_SECRET`. Conserva `PGSSL_REJECT_UNAUTHORIZED` sin definir o en `true` para validar certificados PostgreSQL; no lo desactives en producción.
- Los intentos de crear sesión y migrar cuentas están limitados por IP. El almacenamiento del límite es local al proceso; si Render ejecuta varias instancias, configura un almacén compartido para que el límite sea común a todas.
- `.env` y `node_modules` están excluidos de Git. `.env` estuvo versionado anteriormente: si el repositorio se publicó o compartió, rota las credenciales que pudo contener. Quitar el archivo del siguiente commit no borra valores del historial anterior.

Los endpoints `/api/auth/login` y `/api/auth/register-tenant` ya no se utilizan ni están publicados: el acceso se realiza mediante `/api/auth/firebase-session`, que rechaza tokens sin correo verificado.

## Cuentas existentes

- Una cuenta existente de correo y contraseña puede iniciar sesión una vez con sus credenciales antiguas. El backend valida la contraseña anterior contra el hash de PostgreSQL y el SDK web crea la identidad Firebase sin marcar el correo como verificado. Firebase envía el mensaje de verificación; después, Render asocia el UID al usuario PostgreSQL existente.
- Si una cuenta nueva verifica el correo desde otro dispositivo y no conserva los datos del formulario, inicia sesión, vuelve a Registro, completa empresa y aceptación legal y usa «Continuar con Google / sesión activa»; el backend reutiliza la sesión Firebase verificada.
- Los usuarios creados por un administrador también deben verificar su correo en su primer acceso. El backend guarda su contraseña temporal en el hash existente de PostgreSQL; en el primer acceso la misma contraseña crea la identidad de Firebase desde el SDK web. El administrador entrega la contraseña temporal usando un canal seguro.
- Una cuenta anterior que ya tenga una identidad Firebase con ese correo debe usar el restablecimiento de contraseña de Firebase; no se sobrescribe una identidad existente.
- Los nuevos usuarios con correo se guardan en PostgreSQL al autenticarse después de verificar el correo. Las cuentas nuevas con Google, que ya tiene el correo verificado, se crean al completar el formulario de empresa.

El restablecimiento de contraseña afecta a Firebase Authentication. Ya no modifica ni utiliza `password_hash` de PostgreSQL para iniciar sesión.
