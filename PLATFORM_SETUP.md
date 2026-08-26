# Configuración nativa — Login social

> **Nota:** esta guía es una referencia rápida. Para el detalle completo usa
> `SETUP_SOCIAL_LOGIN.md`.

La configuración de login social combina pasos ya integrados con validaciones
que todavía dependen del entorno real.

## Android

1. En Firebase Console → Authentication → Sign-in method, verificar **Google**.
2. Mantener SHA-1/SHA-256 de las keystores necesarias en la app Firebase Android.
3. Confirmar que `android/app/google-services.json` corresponda al package name
   vigente.
4. No publicar keystores, contraseñas ni material privado en el repositorio.

## iOS

> **Reconciliación PR #12:** el cliente Firebase iOS y el URL scheme de Google
> dejaron de ser placeholders en PR #12. El trabajo pendiente desde ese PR era
> validar build/runtime en macOS/Xcode, no volver a pegar un
> `REVERSED_CLIENT_ID_AQUI` ficticio.

1. Verificar que el Bundle ID del target/esquema activo coincida con la app
   Firebase iOS del entorno que se está validando.
2. Verificar que el `REVERSED_CLIENT_ID` de esa configuración coincida con el
   URL scheme configurado para Runner.
3. Si se reconfigura Firebase, modificar solo el entorno correspondiente y
   revisar la consistencia antes del commit.
4. En Apple Developer Console/Xcode, habilitar **Sign in with Apple** cuando
   corresponda y validar la capability en el target real.
5. Ejecutar por separado la evidencia nativa que PR #12 no aportó:
   `flutter build ios --no-codesign`, resolución CocoaPods y prueba en
   simulador/dispositivo.

## Web

1. En Firebase Console → Authentication → Sign-in method → Google, verificar el
   Web client ID.
2. Mantener coherentes los orígenes OAuth autorizados y la configuración Web
   consumida por la app.
3. Apple Sign-In Web requiere un flujo distinto al nativo iOS y no se infiere
   automáticamente por tener la configuración iOS lista.

## Verificación de correo

Antes de una publicación real, revisar plantillas, remitente y dominio de acción
de Firebase Authentication según el entorno.

## Regla de evidencia

```text
IOS_STATIC_FIREBASE_CONFIG_SINCE_PR12 = YES
IOS_GOOGLE_URL_SCHEME_SINCE_PR12 = YES
IOS_NATIVE_BUILD_PROVEN_BY_PR12 = NO
IOS_RUNTIME_PROVEN_BY_PR12 = NO
```

Una configuración estática correcta no equivale a una validación funcional de
Firebase/Google/Apple en un dispositivo real.