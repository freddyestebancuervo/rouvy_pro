/// Google Web Client ID exclusivo del entorno de **Producción**
/// (`ridepro-dbafe`). Usado únicamente por `main.dart` vía
/// `initDependencyInjection(googleWebClientId: ...)` — nunca importado
/// desde `main_development.dart` ni desde ningún código compartido entre
/// entornos. Ver `SocialLoginConfigDevelopment` para el equivalente de
/// `ridepro-development`.
///
/// El resto de credenciales (SHA-1, google-services.json,
/// GoogleService-Info.plist, URL schemes) viven en archivos de
/// configuración nativos, no en Dart — ver `SETUP_SOCIAL_LOGIN.md`.
///
/// En Android/iOS este valor no se usa (el plugin lo resuelve
/// automáticamente a partir de `google-services.json` /
/// `GoogleService-Info.plist`), pero `google_sign_in` en Flutter Web sí
/// requiere pasarlo explícitamente — ver `core/di/injection.dart`.
abstract class SocialLoginConfig {
  /// Firebase Console → Authentication → Sign-in method → Google →
  /// "Web SDK configuration" → Web client ID.
  /// Formato esperado: `XXXXXXXXXXXX-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx.apps.googleusercontent.com`
  static const String googleWebClientId =
      '731660820861-3jkse9cbmat7bl4nk9ig9qj2728cv2r9.apps.googleusercontent.com';
}
