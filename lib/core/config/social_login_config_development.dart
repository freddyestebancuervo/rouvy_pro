/// Google Web Client ID exclusivo del entorno Development
/// (`ridepro-development`). Usado únicamente por `main_development.dart`
/// vía `initDependencyInjection(googleWebClientId: ...)` — nunca importado
/// desde `main.dart` ni desde ningún código compartido entre entornos.
///
/// Valor verificado manualmente por el propietario en Firebase Console →
/// proyecto `ridepro-development` → Authentication → Sign-in method →
/// Google → "Web SDK configuration" → Web client ID. El prefijo numérico
/// (`1020003121433`) coincide con el Project Number de `ridepro-development`
/// (ver Documento 17), distinto del `731660820861` de `ridepro-dbafe`
/// (Producción, `SocialLoginConfig`).
abstract class SocialLoginConfigDevelopment {
  static const String googleWebClientId =
      '1020003121433-oi44p0m9fbjh4j83gagorgroijhrp5lf.apps.googleusercontent.com';
}
