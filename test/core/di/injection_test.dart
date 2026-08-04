import 'package:flutter_test/flutter_test.dart';
import 'package:rouvy_pro/core/config/social_login_config.dart';
import 'package:rouvy_pro/core/config/social_login_config_development.dart';
import 'package:rouvy_pro/core/di/injection.dart';

void main() {
  group('resolveGoogleSignInClientId', () {
    test('Development recibe el Client ID de Development en Web', () {
      final String? result = resolveGoogleSignInClientId(
        isWeb: true,
        googleWebClientId: SocialLoginConfigDevelopment.googleWebClientId,
      );

      expect(result, SocialLoginConfigDevelopment.googleWebClientId);
    });

    test('Producción recibe el Client ID de Producción en Web', () {
      final String? result = resolveGoogleSignInClientId(
        isWeb: true,
        googleWebClientId: SocialLoginConfig.googleWebClientId,
      );

      expect(result, SocialLoginConfig.googleWebClientId);
    });

    test('Development nunca recibe el Client ID de Producción', () {
      final String? result = resolveGoogleSignInClientId(
        isWeb: true,
        googleWebClientId: SocialLoginConfigDevelopment.googleWebClientId,
      );

      expect(result, isNot(equals(SocialLoginConfig.googleWebClientId)));
    });

    test('una build Web sin Client ID explícito (null) falla con error claro', () {
      expect(
        () => resolveGoogleSignInClientId(isWeb: true, googleWebClientId: null),
        throwsA(
          isA<StateError>().having(
            (StateError e) => e.message,
            'message',
            contains('googleWebClientId es obligatorio para builds Web'),
          ),
        ),
      );
    });

    test('una build Web sin Client ID explícito (vacío) falla con error claro', () {
      expect(
        () => resolveGoogleSignInClientId(isWeb: true, googleWebClientId: ''),
        throwsA(isA<StateError>()),
      );
    });

    test('Android/iOS (isWeb: false) siempre devuelven null, sin importar el argumento', () {
      expect(
        resolveGoogleSignInClientId(isWeb: false, googleWebClientId: null),
        isNull,
      );
      expect(
        resolveGoogleSignInClientId(
          isWeb: false,
          googleWebClientId: SocialLoginConfig.googleWebClientId,
        ),
        isNull,
      );
    });

    test('Android/iOS nunca lanzan error aunque falte el Client ID', () {
      expect(
        () => resolveGoogleSignInClientId(isWeb: false, googleWebClientId: null),
        returnsNormally,
      );
    });
  });
}
