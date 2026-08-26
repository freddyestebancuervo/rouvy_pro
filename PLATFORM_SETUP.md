# Configuración nativa — Login social

> **Nota:** esta guía quedó como referencia rápida. Para la guía completa
> con checklist, capturas de dónde encontrar cada dato en Firebase/Google
> Cloud/Apple Developer Console, y la ubicación exacta de cada placeholder
> ya dejado en el proyecto, usa **`SETUP_SOCIAL_LOGIN.md`** en su lugar.

El código Dart ya está completo, pero Google/Apple Sign-In requieren
configuración a nivel de plataforma que **no se puede generar desde aquí**
(depende de IDs de proyecto/bundle reales). Pasos pendientes para el equipo:

## Android

1. En Firebase Console → Authentication → Sign-in method, habilitar **Google**.
2. Generar el SHA-1 y SHA-256 de la keystore de debug/release y añadirlos al
   proyecto Firebase (`Configuración del proyecto → Tus apps → Android`).
3. Descargar el `google-services.json` actualizado y colocarlo en
   `android/app/google-services.json` (se regenera automáticamente al correr
   `flutterfire configure`, ver README principal).
4. No se requiere configuración adicional en `AndroidManifest.xml` para
   `google_sign_in` en versiones recientes del plugin.

## iOS

1. En Firebase Console → Authentication → Sign-in method, habilitar
   **Google** y **Apple**.
2. Añadir el **REVERSED_CLIENT_ID** (viene en el `GoogleService-Info.plist`
   generado por `flutterfire configure`) como URL Scheme en
   `ios/Runner/Info.plist`:
   ```xml
   <key>CFBundleURLTypes</key>
   <array>
     <dict>
       <key>CFBundleURLSchemes</key>
       <array>
         <string>REVERSED_CLIENT_ID_AQUI</string>
       </array>
     </dict>
   </array>
   ```
3. En Apple Developer Console: habilitar la capability **"Sign in with
   Apple"** en el App ID del proyecto, y en Xcode añadir la capability
   correspondiente al target `Runner`.
4. `sign_in_with_apple` no requiere más configuración de Info.plist más
   allá de la capability.

## Web

1. En Firebase Console → Authentication → Sign-in method → Google, copiar
   el **Web client ID**.
2. En `web/index.html`, añadir dentro de `<head>`:
   ```html
   <meta name="google-signin-client_id" content="TU_WEB_CLIENT_ID_AQUI">
   ```
3. **Apple Sign-In en Web** no está soportado por el paquete
   `sign_in_with_apple` de la misma forma que iOS — en `login_page.dart` y
   `register_page.dart` el botón de Apple ya está condicionado a
   `!kIsWeb && defaultTargetPlatform == TargetPlatform.iOS`, por lo que no
   aparece en Web sin trabajo adicional (Apple JS SDK + redirect flow, fuera
   del alcance de este módulo).

## Verificación de correo (todas las plataformas)

Firebase envía el correo de verificación con una plantilla y dominio de
acción por defecto (`*.firebaseapp.com`). Antes de producción, personalizar
la plantilla en **Firebase Console → Authentication → Templates** (idioma,
remitente, dominio de acción con el dominio propio de la app vía "Dynamic
Links" o "Hosting", si se desea).
