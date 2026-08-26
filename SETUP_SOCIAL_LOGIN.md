# Guía de configuración — Login social (Google + Apple)

Toda la **lógica y arquitectura** de Google Sign-In, Apple Sign-In y Firebase
Authentication ya está implementada (ver `features/auth/`). Esta guía combina
la configuración ya integrada con los pasos que todavía pueden requerir trabajo
manual por plataforma.

> **Reconciliación PR #12:** desde PR #12 la configuración Firebase del cliente
iOS dejó de ser un placeholder: se integraron opciones iOS en
`lib/firebase_options.dart`, un `GoogleService-Info.plist` real para la app iOS
y el URL scheme de Google en `ios/Runner/Info.plist`. La compilación nativa y
el runtime macOS/Xcode no quedaron probados por ese PR y requieren evidencia
separada. La evolución posterior de Bundle IDs/entornos debe leerse desde la
configuración vigente, no desde los valores históricos de PR #12.

## Estado de configuración — resumen rápido

| Archivo | Estado / acción |
|---|---|
| `lib/core/config/social_login_config.dart` | Verificar `googleWebClientId` para Web |
| `android/app/build.gradle` | Verificar `applicationId` y `namespace` contra Firebase |
| `android/app/google-services.json` | Verificar que corresponda al proyecto/app Android vigentes |
| `ios/Runner/Info.plist` | URL scheme Google configurado desde PR #12; verificar consistencia con la configuración iOS vigente |
| configuración Firebase iOS seleccionada por Xcode | Configurada desde PR #12; no tratarla como placeholder |
| `web/index.html` | Verificar el Web client ID configurado |
| `lib/firebase_options.dart` | Incluye `FirebaseOptions` para iOS desde PR #12 |

No hace falta tocar ninguna línea de lógica en `features/auth/` para cambiar
identificadores de plataforma; deben mantenerse coherentes las configuraciones
Firebase/Google y los Bundle IDs reales del entorno que se esté validando.

---

## 1. Firebase Authentication

1. En Firebase Console → **Authentication → Sign-in method**, verificar los
   proveedores que se vayan a utilizar:
   - **Correo electrónico/contraseña**
   - **Google**
   - **Apple**
2. Si se reconfigura deliberadamente una app Firebase, usar FlutterFire CLI o
   los archivos descargados desde Firebase y revisar el diff antes de integrar:
   ```bash
   dart pub global activate flutterfire_cli
   flutterfire configure
   ```
3. No ejecutar `flutterfire configure` solo para “rellenar placeholders” de iOS:
   PR #12 ya eliminó ese estado histórico. Una reconfiguración posterior debe
   preservar la separación de entornos y los identificadores vigentes.

---

## 2. Google Sign-In en Android

1. Firebase Console → **Configuración del proyecto → Tus apps → Android**.
2. Confirmar que el **package name** coincida exactamente con `applicationId`
   en `android/app/build.gradle`.
3. Añadir SHA-1 y SHA-256 de las keystores necesarias para Development/Release.
4. Confirmar que `android/app/google-services.json` corresponde a esa app.
5. Verificar que el proveedor Google esté habilitado en Firebase Authentication.

---

## 3. Google Sign-In en iOS

PR #12 integró la primera configuración real del cliente Firebase iOS. Por
eso estos pasos son ahora de **verificación/reconfiguración**, no de reemplazo
de un placeholder:

1. Confirmar el Bundle ID vigente en Xcode para el entorno que se va a probar.
2. Confirmar que la configuración Firebase iOS seleccionada para ese entorno
   tenga el mismo Bundle ID y el proyecto Firebase esperado.
3. Confirmar que su `REVERSED_CLIENT_ID` coincida con el URL scheme usado por
   `ios/Runner/Info.plist` / la configuración Xcode vigente.
4. Si se descarga un nuevo `GoogleService-Info.plist`, reemplazar únicamente la
   configuración del entorno correspondiente y revisar consistencia cruzada
   antes de hacer commit.
5. En Xcode (`open ios/Runner.xcworkspace`), revisar **Runner → Signing &
   Capabilities** antes de una validación real.

**Límite de evidencia de PR #12:** la consistencia estática quedó integrada y
el CI general pasó, pero PR #12 no ejecutó `flutter build ios`, CocoaPods ni
una prueba de `Firebase.initializeApp()`/Google Sign-In en simulador o dispositivo.

---

## 4. Google Sign-In en Web

1. Firebase Console → Authentication → Sign-in method → Google → desplegar
   **Web SDK configuration** y obtener el Web client ID.
2. Verificar que el mismo client ID esperado esté configurado donde lo consuma
   la aplicación Web (`social_login_config.dart` / `web/index.html`, según la
   implementación vigente).
3. En Google Cloud Console → APIs y servicios → Credenciales → OAuth Client ID
   Web, mantener los **Orígenes de JavaScript autorizados** de Development y
   Production según corresponda.

---

## 5. Apple Sign-In

Solo aplica a iOS en el flujo nativo actual.

1. En Apple Developer Console → **Certificates, Identifiers & Profiles →
   Identifiers**, habilitar **Sign In with Apple** para el App ID pertinente.
2. En Xcode → **Runner → Signing & Capabilities → + Capability**, añadir
   **Sign in with Apple** cuando corresponda al target/app que se valida.
3. Firebase Console → Authentication → Sign-in method → Apple → verificar el
   proveedor.
4. No se necesita un `REVERSED_CLIENT_ID` adicional para Apple; ese valor es
   parte del flujo Google OAuth.

---

## 6. Obtener SHA-1 y SHA-256 para Android

Ejemplo para debug:

```bash
keytool -list -v \
  -keystore ~/.android/debug.keystore \
  -alias androiddebugkey \
  -storepass android -keypass android
```

Para release, usar la keystore real de firma y no publicar contraseñas ni
material privado en el repositorio o logs.

---

## 7. Configuración de Android

`AndroidManifest.xml` no necesita un placeholder específico de Google Sign-In
en este flujo. Lo importante es mantener consistencia entre package name,
`google-services.json`, huellas SHA y la app registrada en Firebase.

---

## 8. Configuración de `Info.plist`

El bloque `CFBundleURLTypes` para Google Sign-In **ya no debe documentarse como
placeholder desde PR #12**. Debe verificarse contra el `REVERSED_CLIENT_ID` de
la configuración Firebase iOS que corresponda al entorno activo.

Las claves/capabilities de otras funciones (Bluetooth, Apple Sign-In, etc.)
deben validarse por separado según el target y el entorno.

---

## 9. Configuración de Firebase iOS

Desde PR #12 existe configuración Firebase iOS real en el repositorio. No se
debe asumir la ruta o los identificadores históricos de aquel PR como valores
eternos: las configuraciones de entorno pueden evolucionar posteriormente.

Regla vigente de mantenimiento:

- no editar identificadores a mano sin verificar Firebase/Xcode;
- mantener Bundle ID, App ID, Project ID, client ID y URL scheme coherentes;
- si existe separación Development/Production, modificar solo el archivo del
  entorno correspondiente;
- no confundir **configuración estática correcta** con **runtime probado**.

---

## 10. Configuración Android/Web

La reconciliación de PR #12 no declara cerrados los pendientes de Android o
Web que no fueron parte de ese PR. Su estado debe verificarse contra los PR
correspondientes cuando se alcance cada uno en la reconciliación secuencial.

---

## Checklist antes de validar login social

- [x] Configuración Firebase iOS dejó de ser placeholder desde PR #12.
- [x] `FirebaseOptions` iOS existe desde PR #12.
- [x] URL scheme Google iOS quedó configurado estáticamente desde PR #12.
- [ ] Confirmar que la configuración iOS activa corresponde al entorno/Bundle ID vigentes.
- [ ] Validar build nativo iOS/CocoaPods en macOS cuando corresponda.
- [ ] Validar `Firebase.initializeApp()` en runtime iOS.
- [ ] Validar callback real de Google Sign-In iOS.
- [ ] Validar capability y flujo real de Apple Sign-In iOS.
- [ ] Verificar Android y Web contra sus configuraciones vigentes.

**Importante:** CI Flutter/Firestore/Backend en verde no sustituye una prueba
nativa iOS. La evidencia de build/runtime debe registrarse de forma separada.