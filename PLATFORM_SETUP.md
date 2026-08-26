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
> dejaron de ser placeholders en PR #12. Ese PR no probó por sí solo el build
> nativo ni el runtime.
>
> **Reconciliación PR #14:** el deployment target mínimo se elevó de iOS 13.0 a
> 14.0 y GitHub Actions completó en macOS un `flutter build ios --debug
> --no-codesign -v`, incluyendo la resolución nativa/CocoaPods y Xcode. Esto
> acredita un build iOS **sin firma** en CI; no acredita signing/provisioning ni
> runtime en simulador o dispositivo.

1. Verificar que el Bundle ID del target/esquema activo coincida con la app
   Firebase iOS del entorno que se está validando.
2. Verificar que el `REVERSED_CLIENT_ID` de esa configuración coincida con el
   URL scheme configurado para Runner.
3. Si se reconfigura Firebase, modificar solo el entorno correspondiente y
   revisar la consistencia antes del commit.
4. En Apple Developer Console/Xcode, habilitar **Sign in with Apple** cuando
   corresponda y validar la capability en el target real.
5. La compilación iOS sin firma en CI quedó probada desde PR #14. Antes de una
   release siguen pendientes las evidencias que ese PR no cubrió: firma y
   provisioning reales, instalación/ejecución en simulador o dispositivo y
   validación runtime de Firebase/Google/Apple.

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
IOS_UNSIGNED_NATIVE_BUILD_SINCE_PR14 = YES
IOS_COCOAPODS_XCODE_BUILD_SINCE_PR14 = YES
IOS_SIGNING_PROVEN_BY_PR14 = NO
IOS_SIMULATOR_DEVICE_RUNTIME_PROVEN_BY_PR14 = NO
```

Una configuración estática correcta y un build sin firma exitoso no equivalen a
una validación funcional de Firebase/Google/Apple en un dispositivo real.
