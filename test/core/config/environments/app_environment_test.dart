import 'package:flutter_test/flutter_test.dart';
import 'package:rouvy_pro/core/config/backend_config_resolver.dart';
import 'package:rouvy_pro/core/config/environments/environment_production.dart';
import 'package:rouvy_pro/core/config/social_login_config.dart';
import 'package:rouvy_pro/core/config/social_login_config_development.dart';
import 'package:rouvy_pro/firebase_options_development.dart';

/// Nota de diseño de estas pruebas: `developmentEnvironment` (el getter
/// completo) construye un único `AppEnvironment(...)` cuyos argumentos
/// Dart evalúa todos antes de llamar al constructor — incluido
/// `firebaseOptions: DefaultFirebaseOptionsDevelopment.currentPlatform`,
/// que lanza `UnsupportedError` fuera de Web (`kIsWeb == false`, el caso
/// del runner de `flutter test`, que corre en VM). Esto significa que
/// **cualquier** acceso a `developmentEnvironment` (incluso a `.name`)
/// dispara esa excepción en un test de VM, sin relación con qué campo se
/// quiera leer. `DefaultFirebaseOptionsDevelopment` solo tiene registrada
/// la plataforma Web (Documento 20) — ese branch ya está cubierto por un
/// build real (`flutter build web --target lib/main_development.dart`,
/// verificado en este mismo bloque), no por un test unitario en VM. Por
/// eso estas pruebas verifican los INGREDIENTES de `developmentEnvironment`
/// por separado (las constantes de las que se construye), no el getter
/// completo.
void main() {
  group('Ingredientes de developmentEnvironment (verificables en VM)', () {
    test(
        'DefaultFirebaseOptionsDevelopment.web usa el proyecto ridepro-development',
        () {
      expect(
        DefaultFirebaseOptionsDevelopment.web.projectId,
        'ridepro-development',
      );
    });

    test(
        'SocialLoginConfigDevelopment expone el Google Web Client ID de Development',
        () {
      expect(
        SocialLoginConfigDevelopment.googleWebClientId,
        startsWith('1020003121433-'),
      );
    });
  });

  group(
      'productionEnvironment (evaluable en VM: DefaultFirebaseOptions soporta todas las plataformas)',
      () {
    test('name es "production"', () {
      expect(productionEnvironment.name, 'production');
    });

    test('conserva el proyecto Firebase de Producción', () {
      expect(productionEnvironment.firebaseOptions.projectId, 'ridepro-dbafe');
    });

    test('conserva el Google Web Client ID de Producción', () {
      expect(
        productionEnvironment.googleSignInWebClientId,
        SocialLoginConfig.googleWebClientId,
      );
    });

    test(
      'backendBaseUrl conserva el default local platform-aware — mismo comportamiento que '
      'el antiguo main.dart/ApiConfig, sin ningún backend real hardcodeado en este bloque',
      () {
        expect(productionEnvironment.backendBaseUrl, isNotEmpty);
        expect(
          productionEnvironment.backendBaseUrl,
          defaultLocalBackendBaseUrl(),
        );
      },
    );

    test('allowsBackendOverride es false (Documento 21, Fase 0.3.1)', () {
      expect(productionEnvironment.allowsBackendOverride, isFalse);
    });

    test('allowsDevBackendTestUser es false, sin excepción', () {
      expect(productionEnvironment.allowsDevBackendTestUser, isFalse);
    });
  });

  group(
      'Development vs Production — sin fallback ni cruce silencioso (ingredientes)',
      () {
    test('los projectId de Firebase son distintos', () {
      expect(
        DefaultFirebaseOptionsDevelopment.web.projectId,
        isNot(equals(productionEnvironment.firebaseOptions.projectId)),
      );
    });

    test('los Google Web Client ID son distintos', () {
      expect(
        SocialLoginConfigDevelopment.googleWebClientId,
        isNot(equals(productionEnvironment.googleSignInWebClientId)),
      );
    });
  });
}
