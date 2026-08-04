import 'package:flutter_test/flutter_test.dart';
import 'package:rouvy_pro/core/config/environments/environment_development.dart';
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
/// build real (`flutter build web --release --target
/// lib/main_development.dart`, verificado en las Fases 0.1/0.2), no por un
/// test unitario en VM. Por eso estas pruebas verifican los INGREDIENTES
/// de `developmentEnvironment` por separado (las constantes de las que se
/// construye), no el getter completo.
void main() {
  group('Ingredientes de developmentEnvironment (verificables en VM)', () {
    test('DefaultFirebaseOptionsDevelopment.web usa el proyecto ridepro-development', () {
      expect(DefaultFirebaseOptionsDevelopment.web.projectId, 'ridepro-development');
    });

    test('SocialLoginConfigDevelopment expone el Google Web Client ID de Development', () {
      expect(
        SocialLoginConfigDevelopment.googleWebClientId,
        startsWith('1020003121433-'),
      );
    });

    test('developmentBackendBaseUrl apunta al backend real de Cloud Run (Fase 4D), no a localhost',
        () {
      expect(
        developmentBackendBaseUrl,
        'https://ridepro-backend-dev-1020003121433.southamerica-east1.run.app/v1',
      );
      expect(developmentBackendBaseUrl, isNot(contains('localhost')));
      expect(developmentBackendBaseUrl, isNot(contains('10.0.2.2')));
      expect(developmentBackendBaseUrl, startsWith('https://'));
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
      expect(productionEnvironment.googleSignInWebClientId, SocialLoginConfig.googleWebClientId);
    });

    test('backendBaseUrl no está vacío y no es localhost', () {
      expect(productionEnvironment.backendBaseUrl, isNotEmpty);
      expect(productionEnvironment.backendBaseUrl, isNot(contains('localhost')));
    });

    test('allowsBackendOverride es false (Documento 21, Fase 0.3.1)', () {
      expect(productionEnvironment.allowsBackendOverride, isFalse);
    });
  });

  group('Development vs Production — sin fallback ni cruce silencioso (ingredientes)', () {
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

    test(
        'developmentBackendBaseUrl y productionEnvironment.backendBaseUrl son distintos '
        '(Fase 4E: Development ya no es localhost, pero tampoco es el backend de Producción)', () {
      expect(
        developmentBackendBaseUrl,
        isNot(equals(productionEnvironment.backendBaseUrl)),
      );
    });

    test('productionEnvironment.backendBaseUrl conserva su placeholder, sin heredar Cloud Run', () {
      expect(productionEnvironment.backendBaseUrl, isNot(contains('ridepro-backend-dev')));
      expect(productionEnvironment.backendBaseUrl, isNot(contains('run.app')));
    });
  });
}
