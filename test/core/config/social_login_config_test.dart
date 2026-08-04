import 'package:flutter_test/flutter_test.dart';
import 'package:rouvy_pro/core/config/social_login_config.dart';
import 'package:rouvy_pro/core/config/social_login_config_development.dart';

void main() {
  group('SocialLoginConfig (Producción) vs SocialLoginConfigDevelopment', () {
    test('Producción usa el prefijo de proyecto de ridepro-dbafe', () {
      expect(
        SocialLoginConfig.googleWebClientId,
        startsWith('731660820861-'),
      );
    });

    test('Development usa el prefijo de proyecto de ridepro-development', () {
      expect(
        SocialLoginConfigDevelopment.googleWebClientId,
        startsWith('1020003121433-'),
      );
    });

    test('Development nunca coincide con el Client ID de Producción', () {
      expect(
        SocialLoginConfigDevelopment.googleWebClientId,
        isNot(equals(SocialLoginConfig.googleWebClientId)),
      );
    });

    test('ambos valores tienen el formato oficial de un Google OAuth Client ID', () {
      final RegExp pattern = RegExp(r'^\d+-[0-9A-Za-z_]+\.apps\.googleusercontent\.com$');
      expect(pattern.hasMatch(SocialLoginConfig.googleWebClientId), isTrue);
      expect(pattern.hasMatch(SocialLoginConfigDevelopment.googleWebClientId), isTrue);
    });
  });
}
