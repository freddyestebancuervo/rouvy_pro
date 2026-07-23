/// Único lugar del código Dart donde puede hacer falta pegar una
/// credencial de login social. El resto de credenciales (SHA-1,
/// google-services.json, GoogleService-Info.plist, URL schemes) viven en
/// archivos de configuración nativos, no en Dart — ver `SETUP_SOCIAL_LOGIN.md`.
///
/// ⚠️ Reemplazar `googleWebClientId` con el "Web client ID" real ANTES de
/// probar el login con Google en la versión Web. En Android/iOS este
/// valor no se usa (el plugin lo resuelve automáticamente a partir de
/// `google-services.json` / `GoogleService-Info.plist`), pero
/// `google_sign_in` en Flutter Web sí requiere pasarlo explícitamente al
/// construir `GoogleSignIn(...)` — ver `core/di/injection.dart`.
abstract class SocialLoginConfig {
  /// Firebase Console → Authentication → Sign-in method → Google →
  /// "Web SDK configuration" → Web client ID.
  /// Formato esperado: `XXXXXXXXXXXX-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx.apps.googleusercontent.com`
  static const String googleWebClientId =
      '731660820861-3jkse9cbmat7bl4nk9ig9qj2728cv2r9.apps.googleusercontent.com';
}
