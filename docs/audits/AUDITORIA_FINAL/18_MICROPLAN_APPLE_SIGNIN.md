# RidePro — Documento 18: Microplan Apple Sign-In
## Fase 1 de la Parte B — `ridepro-development` — Solo documentación, sin ejecutar

- **Fecha:** 2026-07-25
- **Estado:** Planificación exclusivamente. **Apple Sign-In permanece deshabilitado en `ridepro-development`.** Este documento no se ejecuta hasta autorización explícita separada.
- **Precondición ya cumplida:** Email/Password y Google — proceso en curso, ver `PROJECT_STATUS.md` §8 para el estado exacto al momento de leer esto.
- **Regla de seguridad de este documento:** ningún valor real (Team ID, Service ID, Key ID, clave privada) se solicita ni se muestra en el chat en ningún momento de esta tarea ni de su eventual ejecución — solo se describe **dónde** vive cada dato y **cómo** se maneja.

---

## 1. Por qué Apple es distinto de Google/Email-Password

A diferencia de Google (donde Firebase genera automáticamente el cliente OAuth necesario) y Email/Password (que no depende de ningún proveedor externo), Apple Sign-In requiere una cadena de configuración **fuera de Firebase**, en el Apple Developer Portal, antes de que el proveedor funcione de punta a punta en las 3 plataformas donde RidePro lo necesita (iOS nativo, Android vía flujo web, Web vía redirect/popup).

## 2. Datos requeridos — qué son, dónde se obtienen, cómo se manejan (sin exponer valores)

| Dato | Qué es | Dónde se obtiene | Manejo |
|---|---|---|---|
| **Apple Developer Team ID** | Identificador de 10 caracteres de la cuenta/organización en Apple Developer | Apple Developer Portal → Membership | No es secreto (es público en certificados), pero se documenta solo por referencia, nunca pegado literal en un documento versionado sin necesidad |
| **Service ID** | Identificador tipo `com.ridepro.app.dev.signin` registrado en Apple Developer → Identifiers → Services IDs; actúa como "client ID" OAuth para el flujo web (necesario para Android y Web, no solo iOS) | Se crea en Apple Developer Portal, asociado al App ID de Development (`com.ridepro.app.dev`, aún no registrado — ver dependencia en sección 9) | No es secreto por sí mismo, pero se documenta en `firebase_options_development.dart` solo cuando exista ese archivo (Fase 2-3 de `16_...md`), nunca antes |
| **Key ID** | Identifica una clave privada de "Sign in with Apple" creada en Apple Developer → Keys | Apple Developer Portal | Se registra en Firebase Console (campo de configuración del proveedor Apple), nunca en el repositorio |
| **Clave privada (.p8)** | Archivo descargable **una sola vez** al crear la Key en Apple Developer — usado por Firebase (servidor) para firmar el client secret JWT que Apple exige | Apple Developer Portal → Keys → descarga única | 🔴 **Máxima sensibilidad.** Nunca en el repositorio, nunca en el chat, nunca en un log. Se sube directamente al formulario de configuración de Apple en Firebase Console (que la almacena de forma cifrada del lado de Google) — el archivo local se elimina después de subirlo, o se guarda únicamente en un gestor de secretos fuera del repositorio (mismo criterio ya aplicado a las claves de servicio de Firebase Admin, `.gitignore` ya hardenizado) |
| **Return URL / Redirect URI de Firebase** | URL que Firebase expone para recibir la respuesta de Apple tras el login (formato típico `https://ridepro-development.firebaseapp.com/__/auth/handler`) | La provee la propia pantalla de configuración de Apple en Firebase Console al habilitar el proveedor | Se registra tal cual en la configuración del Service ID en Apple Developer — no es secreta, es una URL pública |
| **Dominio verificado** | El dominio (`ridepro-development.firebaseapp.com`, o uno custom si se configura Hosting) debe declararse en la configuración del Service ID de Apple | Apple Developer Portal, sección "Domains and Subdomains" del Service ID | A confirmar en el momento de ejecución si Apple exige un archivo de verificación adicional para dominios `firebaseapp.com` (no verificable desde este entorno sin acceso a la cuenta real) |

## 3. Private Email Relay — riesgo específico para RidePro, no genérico

Apple permite a cualquier usuario **ocultar su correo real** al autorizar el login, entregando en su lugar una dirección de relevo (`xxxxx@privaterelay.appleid.com`) que Apple reenvía al correo real del usuario.

**Por qué esto es relevante para RidePro específicamente:** el flujo de `register()` (`auth_remote_datasource.dart:100`) llama automáticamente a `sendEmailVerification()` al crear una cuenta — pero ese `sendEmailVerification()` es para el flujo de **Email/Password**, no para logins sociales (Apple ya marca `emailVerified: true` para proveedores sociales, ver `:327`). Sin embargo, sí hay que verificar en la ejecución real: cualquier correo transaccional futuro que RidePro envíe a una dirección de relevo de Apple (p. ej. notificaciones, recuperación de datos) requiere que el dominio de envío de RidePro esté registrado ante el servicio de Private Email Relay de Apple para que la entrega funcione de forma confiable — de lo contrario, el correo puede perderse silenciosamente. **No se asume que esto ya funciona — se declara explícitamente como punto a verificar en la ejecución real, no antes.**

## 4. Capacidad "Sign in with Apple" en Xcode

Requiere, en `ios/Runner.xcodeproj` (Signing & Capabilities): agregar la capacidad **"Sign in with Apple"** — esto a su vez exige que el App ID correspondiente (`com.ridepro.app.dev`) tenga esa capacidad habilitada en Apple Developer Portal. **Dependencia bloqueante:** el Bundle ID de iOS para Development **todavía no está registrado** (es la Fase 3 de `16_PLAN_EJECUCION_FASE1_RIDEPRO_DEV.md`, no ejecutada). Este microplan no puede completarse para iOS hasta que esa fase se ejecute.

## 5. Requisitos para Android

Android no tiene "Sign in with Apple" nativo — el plugin `sign_in_with_apple` (ya en `pubspec.yaml`, confirmado en uso en `auth_remote_datasource.dart:149`) implementa el flujo mediante una vista web que redirige a la autenticación de Apple usando el **Service ID** como client OAuth, y espera la redirección de vuelta a la app. Esto típicamente requiere:
- El Service ID configurado con la Return URL correcta (sección 2).
- Verificar si la versión del plugin usada en este proyecto necesita configuración adicional en `android/app/src/main/AndroidManifest.xml` (esquema de redirección/intent-filter) — **a confirmar leyendo la documentación de la versión exacta del paquete al momento de ejecutar**, no asumido aquí.

## 6. Requisitos para Web

Flutter Web usa `OAuthProvider('apple.com')` a través del propio SDK de Firebase Auth (popup o redirect, gestionado por Firebase). Requiere:
- El dominio de desarrollo (p. ej. `ridepro-development.firebaseapp.com`, o el dominio real donde se sirva el build Web de development) debe estar en la lista de **"Authorized domains"** de Firebase Authentication → Settings.
- Sin código adicional más allá de lo que ya existe en `auth_remote_datasource.dart` (el mismo método `signInWithApple()` se reutiliza — el plugin `sign_in_with_apple` soporta Web).

## 7. Manejo seguro de la clave privada — procedimiento

1. Descargar el archivo `.p8` una sola vez desde Apple Developer Portal, directamente a una carpeta **fuera del repositorio** (nunca dentro de `rouvy_pro/`).
2. Subirlo únicamente al formulario de configuración del proveedor Apple en Firebase Console (donde Google lo almacena cifrado del lado del servidor).
3. Eliminar la copia local descargada una vez confirmada la subida exitosa, o moverla a un gestor de secretos si el equipo ya usa uno (no hay evidencia de que RidePro use un gestor de secretos dedicado hoy — se documenta como recomendación, no como hecho existente).
4. Si en el futuro se necesitara en CI/CD (p. ej. para regenerar configuración por script), se almacenaría como secreto de GitHub Actions codificado en base64, nunca como archivo en el checkout del pipeline — mismo criterio ya aplicado en `15_...md` §8 para credenciales de Firebase Admin.
5. **Nunca se pega el contenido de esta clave en el chat, en un commit, ni en ningún documento de `docs/`.**

## 8. Pruebas requeridas antes de declarar Apple funcional

| Plataforma | Prueba | Nota |
|---|---|---|
| iPhone físico | Login completo con Apple, primera vez (capturando nombre) y segunda vez (sin nombre, ya en `providerData`) | Mismo bloqueador ya conocido: sin acceso a macOS/iPhone real en este entorno — validación pendiente, no se declara "funcional" sin ella |
| Web | Login completo en un navegador real, confirmando que el popup/redirect completa y Firebase devuelve un usuario con `providerId: 'apple.com'` | Ejecutable una vez el dominio esté autorizado (sección 6) |
| Android | Login completo vía el flujo de vista web del plugin, confirmando que la redirección de vuelta a la app funciona sin dejar una pestaña huérfana | Requiere un build Android real, no solo análisis estático |

## 9. Dependencias de este microplan (todas deben resolverse antes de ejecutar)

- Fase 3 de `16_...md` (registro de la app iOS en `ridepro-development`, con su propio Bundle ID `com.ridepro.app.dev`) — **no ejecutada todavía**.
- Fase 2 de `16_...md` (registro de la app Android) — para poder probar el flujo Android.
- Acceso a la cuenta de Apple Developer del propietario — fuera del alcance de este entorno de desarrollo.
- Validación real en macOS/Xcode — bloqueador transversal ya documentado desde la Fase 1 de Firebase iOS.

## 10. Criterios de rollback

| Acción | Cómo revertir |
|---|---|
| Proveedor Apple habilitado en Firebase con configuración incorrecta | Deshabilitar el proveedor desde Firebase Console — instantáneo, sin pérdida de datos (no habría usuarios Apple todavía, ya que el proveedor está deshabilitado hoy) |
| Service ID / Key mal configurados en Apple Developer | Eliminar y recrear en Apple Developer Portal — sin efecto en Google/Email-Password, que son proveedores independientes |
| Capacidad "Sign in with Apple" agregada en Xcode por error | Remover la capacidad — no afecta el resto del proyecto iOS |

**Ningún paso de este microplan, tal como está diseñado, afecta a Email/Password ni a Google** — son proveedores completamente independientes en Firebase Authentication.

## 11. Checklist de salida (para cuando este microplan se ejecute — no ahora)

| # | Ítem | Evidencia requerida |
|---|---|---|
| 1 | Team ID, Service ID, Key ID documentados (sin exponer la clave privada) | Registro en el informe de cierre correspondiente |
| 2 | Clave privada manejada según sección 7, nunca expuesta | Confirmación explícita, sin el valor |
| 3 | Return URL y dominio verificados en Apple Developer | Captura/confirmación |
| 4 | Capacidad Sign in with Apple agregada en Xcode, ligada al Bundle ID correcto | Verificación en `project.pbxproj`/Xcode |
| 5 | Prueba exitosa en iPhone físico | Evidencia real, no simulada |
| 6 | Prueba exitosa en Web | Evidencia real |
| 7 | Prueba exitosa en Android | Evidencia real |
| 8 | Comportamiento de Private Email Relay verificado (sección 3) | Evidencia real, no asumida |
| 9 | `git status`/`git diff` sin cambios inesperados | Salida de ambos comandos |
| 10 | `PROJECT_STATUS.md` actualizado | Entrada nueva en el historial |
| 11 | Veredicto explícito emitido | ✅/⚠️/❌ |

---

## Estado de este documento

**Solo planificación.** No se ejecutó ninguna acción sobre Firebase, Apple Developer, ni el repositorio. Apple Sign-In permanece deshabilitado en `ridepro-development`. Este microplan queda a la espera de autorización explícita y separada — y, según sus propias dependencias (sección 9), no puede completarse hasta que las Fases 2-3 de `16_...md` (registro de apps Android/iOS) se ejecuten primero.
