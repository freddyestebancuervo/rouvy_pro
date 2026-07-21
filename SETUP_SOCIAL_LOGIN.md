# Guía de configuración — Login social (Google + Apple)

Toda la **lógica y arquitectura** de Google Sign-In, Apple Sign-In y Firebase
Authentication ya está implementada (ver `features/auth/`). Esta guía cubre
únicamente el paso que falta: **pegar tus credenciales reales** en los
placeholders ya dejados en el proyecto.

## Dónde están los placeholders — resumen rápido

| Archivo | Qué reemplazar |
|---|---|
| `lib/core/config/social_login_config.dart` | `googleWebClientId` |
| `android/app/build.gradle` | `applicationId`, `namespace` |
| `android/app/google-services.json` | **Archivo entero** (descargar de Firebase) |
| `ios/Runner/Info.plist` | `YOUR_REVERSED_CLIENT_ID` dentro de `CFBundleURLSchemes` |
| `ios/Runner/GoogleService-Info.plist` | **Archivo entero** (descargar de Firebase) |
| `web/index.html` | `YOUR_GOOGLE_WEB_CLIENT_ID` en el meta tag |
| `lib/firebase_options.dart` | Se regenera automáticamente con `flutterfire configure` (ver paso 1) |

No hace falta tocar ninguna línea de lógica en `features/auth/` — todo ese
código ya lee las credenciales desde estos archivos de configuración.

---

## 1. Firebase Authentication

1. Ve a [console.firebase.google.com](https://console.firebase.google.com) →
   **Crear un proyecto** (o usa uno existente).
2. En el menú lateral: **Authentication → Comenzar**.
3. Pestaña **Sign-in method** → habilita:
   - **Correo electrónico/contraseña**
   - **Google**
   - **Apple**
4. Instala la CLI de FlutterFire y conecta el proyecto (esto genera
   automáticamente `lib/firebase_options.dart` con las credenciales
   correctas para las 3 plataformas a la vez):
   ```bash
   dart pub global activate flutterfire_cli
   flutterfire configure
   ```
   Selecciona tu proyecto de Firebase y las plataformas Android/iOS/Web
   cuando te lo pregunte. Esto crea/actualiza automáticamente
   `google-services.json` y `GoogleService-Info.plist` con los valores
   reales — si prefieres hacerlo manualmente, sigue los pasos 9 y 10 de
   esta guía en su lugar.

---

## 2. Google Sign-In en Android

1. Firebase Console → **Configuración del proyecto** (ícono de engranaje) →
   pestaña **Tus apps** → **Agregar app → Android** (si no existe ya).
2. **Package name**: debe coincidir EXACTO con `applicationId` en
   `android/app/build.gradle` (reemplaza el placeholder
   `com.ridepro.app.YOUR_APPLICATION_ID` por tu ID real, y actualiza
   también el `applicationId` en Firebase Console para que coincidan).
3. Pega el **SHA-1** de tu keystore (ver sección 6 de esta guía) en el
   campo correspondiente — es obligatorio para que Google Sign-In
   funcione en Android, aunque no lo es para el resto de Firebase.
4. Descarga el `google-services.json` generado y reemplaza POR COMPLETO el
   archivo placeholder en `android/app/google-services.json`.
5. En Firebase Console → Authentication → Sign-in method → Google, copia
   el **"Web client ID"** que aparece ahí (aunque es Android, Firebase usa
   el client ID web como "server client ID" para verificar el token) — NO
   hace falta pegarlo en ningún lado para Android, el plugin lo resuelve
   solo desde `google-services.json`.

---

## 3. Google Sign-In en iOS

1. Firebase Console → **Tus apps** → **Agregar app → iOS**.
2. **Bundle ID**: debe coincidir con el de tu proyecto Xcode
   (`ios/Runner.xcodeproj`, normalmente algo como `com.ridepro.app`).
3. Descarga el `GoogleService-Info.plist` generado y reemplaza POR
   COMPLETO el archivo placeholder en `ios/Runner/GoogleService-Info.plist`.
4. Abre ese archivo (ya con tus datos reales) y copia el valor de la clave
   **`REVERSED_CLIENT_ID`**.
5. Pega ese valor en `ios/Runner/Info.plist`, dentro de
   `CFBundleURLTypes → CFBundleURLSchemes`, reemplazando
   `com.googleusercontent.apps.YOUR_REVERSED_CLIENT_ID`.
6. En Xcode (`open ios/Runner.xcworkspace`), verifica en **Runner → Signing
   & Capabilities** que el Bundle Identifier coincida con el registrado en
   Firebase.

---

## 4. Google Sign-In en Web

1. Firebase Console → Authentication → Sign-in method → Google → despliega
   **"Web SDK configuration"** → copia el **Web client ID**
   (`XXXXXXXXXXXX-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx.apps.googleusercontent.com`).
2. Pégalo en **dos lugares** (deben ser idénticos):
   - `lib/core/config/social_login_config.dart` → constante `googleWebClientId`.
   - `web/index.html` → meta tag `google-signin-client_id`.
3. En [Google Cloud Console](https://console.cloud.google.com) → APIs y
   servicios → Credenciales → tu OAuth Client ID de tipo Web → añade en
   **"Orígenes de JavaScript autorizados"** el dominio donde sirvas la app
   (p. ej. `http://localhost:PUERTO` en desarrollo, y tu dominio de
   producción).

---

## 5. Apple Sign-In

Solo aplica a iOS (el botón ya está condicionado a `TargetPlatform.iOS` en
`login_page.dart`/`register_page.dart`, no aparece en Android ni Web).

1. En [Apple Developer Console](https://developer.apple.com/account) →
   **Certificates, Identifiers & Profiles → Identifiers** → selecciona tu
   App ID → habilita la capability **"Sign In with Apple"** → Guardar.
2. En Xcode (`ios/Runner.xcworkspace`) → **Runner → Signing & Capabilities**
   → **+ Capability** → añade **"Sign in with Apple"**.
3. Firebase Console → Authentication → Sign-in method → Apple → habilita
   el proveedor (no requiere credenciales adicionales para el flujo básico
   de iOS nativo que usa este proyecto vía `sign_in_with_apple`).
4. No se necesita ningún placeholder adicional en `Info.plist` para Apple
   — la capability del paso 2 es suficiente (ya documentado dentro del
   propio `Info.plist`).

---

## 6. Obtener el SHA-1 y SHA-256

Necesarios para el paso 2 (Google Sign-In en Android). Genera ambos con un
solo comando — **debug** (para desarrollo) y **release** (antes de publicar):

```bash
# Huella de DEBUG (la que usa `flutter run` normalmente):
keytool -list -v \
  -keystore ~/.android/debug.keystore \
  -alias androiddebugkey \
  -storepass android -keypass android
```

```bash
# Huella de RELEASE (usa tu propia keystore de firma de producción):
keytool -list -v \
  -keystore /ruta/a/tu/release-keystore.jks \
  -alias TU_ALIAS
```

La salida incluye ambas líneas, cópialas tal cual a Firebase Console (paso 2.3):
```
SHA1: XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX
SHA256: XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX
```

> Añade **ambas** huellas (debug y release) a la misma app Android en
> Firebase Console — puedes registrar varias. Sin la de debug, el login
> con Google falla en desarrollo aunque funcione perfecto en producción
> (y viceversa).

---

## 7. Configuración de `AndroidManifest.xml`

Ya está completo en `android/app/src/main/AndroidManifest.xml` — no
requiere ningún placeholder para login social (el plugin `google_sign_in`
se configura solo a partir de `google-services.json`). Ya incluye también
los permisos de Bluetooth del módulo `device_connection` (ver
`BLE_PERMISSIONS.md`) y el bloque `<queries>` requerido desde Android 11
para que el flujo OAuth pueda abrir el navegador del sistema.

Lo único que debes verificar es que `android/app/build.gradle` tenga el
`applicationId` correcto (paso 2.2) y que el plugin
`com.google.gms.google-services` esté aplicado (ya lo está por defecto en
el archivo generado).

---

## 8. Configuración de `Info.plist`

Ya está completo en `ios/Runner/Info.plist`, con:
- Las claves de Bluetooth (`NSBluetoothAlwaysUsageDescription` y
  `NSBluetoothPeripheralUsageDescription`).
- El bloque `CFBundleURLTypes` para Google Sign-In, con el placeholder
  `YOUR_REVERSED_CLIENT_ID` que debes reemplazar en el paso 3.5.

No se requiere ninguna clave adicional para Apple Sign-In (se gestiona vía
capability de Xcode, no vía plist).

---

## 9. Configuración de `GoogleService-Info.plist`

Este archivo **NO se edita campo por campo** — se reemplaza ENTERO por el
que descargas de Firebase Console (paso 3.3). El placeholder actual en
`ios/Runner/GoogleService-Info.plist` tiene la estructura correcta pero
con valores inventados (`YOUR_IOS_API_KEY`, etc.) para que el proyecto
compile mientras tanto — Firebase Auth **no funcionará** hasta que lo
reemplaces por el real.

Tras reemplazarlo, en Xcode verifica que el archivo esté efectivamente
incluido en el target `Runner` (arrástralo al navegador de proyecto si
`flutterfire configure` no lo hizo automáticamente, marcando "Copy items
if needed" y el target `Runner`).

---

## 10. Configuración de `google-services.json`

Igual que el anterior: se reemplaza ENTERO, no se edita. El placeholder en
`android/app/google-services.json` mantiene la estructura real de Firebase
(con `project_info`, `client`, `oauth_client`, `api_key`) pero con valores
inventados — suficiente para que Gradle compile, pero Firebase Auth
lanzará un error de configuración hasta que lo sustituyas por el real
descargado en el paso 2.4.

**Verificación rápida de que quedó bien puesto:** el `package_name` dentro
del JSON debe coincidir exactamente con el `applicationId` de
`android/app/build.gradle` — si no coinciden, Firebase no encuentra la
configuración y falla con un error confuso de "no matching client found".

---

## Checklist final antes de probar

- [ ] `flutterfire configure` ejecutado (o pasos 9/10 manuales completados)
- [ ] `google-services.json` real en `android/app/google-services.json`
- [ ] `GoogleService-Info.plist` real en `ios/Runner/GoogleService-Info.plist`
- [ ] `REVERSED_CLIENT_ID` pegado en `ios/Runner/Info.plist`
- [ ] `googleWebClientId` actualizado en `social_login_config.dart` y en `web/index.html`
- [ ] SHA-1 y SHA-256 (debug y release) añadidos en Firebase Console
- [ ] `applicationId` de `android/app/build.gradle` coincide con Firebase Console
- [ ] Capability "Sign in with Apple" añadida en Xcode
- [ ] Proveedores Google/Apple/Email habilitados en Firebase Console → Authentication

Con todo lo anterior, `flutter run` (Android/iOS) o `flutter run -d chrome`
(Web) deberían dejar iniciar sesión con Google/Apple sin tocar ninguna
línea de código de `features/auth/`.
