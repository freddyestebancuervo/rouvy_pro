import 'package:firebase_core/firebase_core.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rouvy_pro/core/config/app_environment.dart';
import 'package:rouvy_pro/core/config/backend_config_resolver.dart';
import 'package:rouvy_pro/core/config/environments/environment_production.dart';

const FirebaseOptions _testFirebaseOptions = FirebaseOptions(
  apiKey: 'test-api-key',
  appId: 'test-app-id',
  messagingSenderId: 'test-sender-id',
  projectId: 'test-project',
);

/// [AppEnvironment] de prueba que SÍ permite override (equivalente a
/// Development) — valores sintéticos, sin relación con ningún proyecto
/// Firebase real.
const AppEnvironment _overridableEnvironment = AppEnvironment(
  name: 'test-development',
  firebaseOptions: _testFirebaseOptions,
  googleSignInWebClientId: 'test-client-id',
  backendBaseUrl: 'http://environment-default.example/v1',
  allowsBackendOverride: true,
  allowsDevBackendTestUser: true,
);

/// [AppEnvironment] de prueba que NUNCA permite override (equivalente a
/// Production).
const AppEnvironment _lockedEnvironment = AppEnvironment(
  name: 'test-production',
  firebaseOptions: _testFirebaseOptions,
  googleSignInWebClientId: 'test-client-id',
  backendBaseUrl: 'https://environment-default-prod.example/v1',
  allowsBackendOverride: false,
  allowsDevBackendTestUser: false,
);

void main() {
  group(
      'override ausente/vacío — usa el valor del AppEnvironment (ambas políticas)',
      () {
    test(
        'entorno que permite override, sin override: usa su valor predeterminado',
        () {
      final String result =
          resolveBackendBaseUrl(_overridableEnvironment, override: '');

      expect(result, 'http://environment-default.example/v1');
    });

    test(
        'entorno que permite override, override vacío tras trim: usa su valor predeterminado',
        () {
      final String result =
          resolveBackendBaseUrl(_overridableEnvironment, override: '   ');

      expect(result, 'http://environment-default.example/v1');
    });

    test(
        'entorno que NO permite override, sin override: usa su valor predeterminado',
        () {
      final String result =
          resolveBackendBaseUrl(_lockedEnvironment, override: '');

      expect(result, 'https://environment-default-prod.example/v1');
    });
  });

  group(
      'Development (allowsBackendOverride: true) — override aceptado si es válido',
      () {
    test('override válido lo acepta y lo usa en vez del valor del entorno', () {
      final String result = resolveBackendBaseUrl(
        _overridableEnvironment,
        override: 'http://192.168.1.50:3000/v1',
      );

      expect(result, 'http://192.168.1.50:3000/v1');
      expect(result, isNot(equals(_overridableEnvironment.backendBaseUrl)));
    });

    test('override inválido lo rechaza (falla de formato, no de política)', () {
      expect(
        () => resolveBackendBaseUrl(
          _overridableEnvironment,
          override: 'no-es-una-url',
        ),
        throwsStateError,
      );
    });

    test('preserva la URL exacta del override, sin normalizarla', () {
      const String override = 'https://Mi-Backend.EXAMPLE.com:8443/v1/';

      final String result =
          resolveBackendBaseUrl(_overridableEnvironment, override: override);

      expect(result, override);
    });
  });

  group(
      'Production (allowsBackendOverride: false) — override siempre rechazado',
      () {
    test(
        'override válido (URL bien formada) igual se rechaza por política de entorno',
        () {
      expect(
        () => resolveBackendBaseUrl(
          _lockedEnvironment,
          override: 'https://otro-backend.example/v1',
        ),
        throwsStateError,
      );
    });

    test('override inválido también se rechaza por política de entorno', () {
      expect(
        () => resolveBackendBaseUrl(
          _lockedEnvironment,
          override: 'no-es-una-url',
        ),
        throwsStateError,
      );
    });

    test(
        'el mensaje de excepción explica claramente que Production no admite override',
        () {
      try {
        resolveBackendBaseUrl(
          _lockedEnvironment,
          override: 'https://otro-backend.example/v1',
        );
        fail('Debía lanzar StateError');
      } on StateError catch (e) {
        expect(e.message, contains('test-production'));
        expect(e.message, contains('no admite BACKEND_BASE_URL_OVERRIDE'));
      }
    });

    test(
        'un override prohibido nunca cae en silencio al valor del entorno — falla, no continúa',
        () {
      // Si "cayera en silencio" al valor del entorno, esta llamada
      // devolvería 'https://environment-default-prod.example/v1' en vez de
      // lanzar. Se comprueba explícitamente que la función NUNCA retorna
      // un valor en este caso — solo lanza.
      String? returnedValue;
      Object? caughtError;
      try {
        returnedValue = resolveBackendBaseUrl(
          _lockedEnvironment,
          override: 'https://otro-backend.example/v1',
        );
      } catch (e) {
        caughtError = e;
      }

      expect(returnedValue, isNull);
      expect(caughtError, isA<StateError>());
    });
  });

  group(
      'productionEnvironment REAL (no un doble sintético) — prueba de inicialización',
      () {
    test(
      'un override de BACKEND_BASE_URL_OVERRIDE contra el productionEnvironment real '
      'es rechazado con mensaje claro — este es exactamente el código que '
      'ejecutaría bootstrapRideProApp/initDependencyInjection al arrancar '
      'la app; `flutter build` compila igual (el define es una constante '
      'de compilación, la política se evalúa en runtime), por eso esta '
      'prueba —no el build— es la demostración real del rechazo.',
      () {
        expect(
          () => resolveBackendBaseUrl(
            productionEnvironment,
            override: 'https://no-deberia-usarse.example/v1',
          ),
          throwsA(
            isA<StateError>()
                .having(
                  (StateError e) => e.message,
                  'message',
                  contains('production'),
                )
                .having(
                  (StateError e) => e.message,
                  'message',
                  contains('no admite BACKEND_BASE_URL_OVERRIDE'),
                ),
          ),
        );
      },
    );
  });

  group(
      'resolveBackendBaseUrl — validación de formato de URL (aplica a ambas políticas)',
      () {
    test(
        'rechaza cadena vacía después de trim (valor del propio entorno mal configurado)',
        () {
      const AppEnvironment brokenEnvironment = AppEnvironment(
        name: 'broken',
        firebaseOptions: _testFirebaseOptions,
        googleSignInWebClientId: null,
        backendBaseUrl: '   ',
        allowsBackendOverride: true,
        allowsDevBackendTestUser: true,
      );

      expect(
        () => resolveBackendBaseUrl(brokenEnvironment, override: ''),
        throwsStateError,
      );
    });

    test('rechaza un esquema distinto de http/https', () {
      expect(
        () => resolveBackendBaseUrl(
          _overridableEnvironment,
          override: 'ftp://backend.example/v1',
        ),
        throwsStateError,
      );
    });

    test('rechaza una URL sin host', () {
      expect(
        () => resolveBackendBaseUrl(
          _overridableEnvironment,
          override: 'http:///v1',
        ),
        throwsStateError,
      );
    });
  });

  group(
      'defaultLocalBackendBaseUrl — default platform-aware (reemplaza al antiguo ApiConfig)',
      () {
    test('devuelve una URL http/https no vacía', () {
      final String url = defaultLocalBackendBaseUrl();
      final Uri? parsed = Uri.tryParse(url);

      expect(url, isNotEmpty);
      expect(parsed, isNotNull);
      expect(parsed!.scheme, 'http');
      expect(parsed.host, isNotEmpty);
    });

    test(
        'apunta a localhost o al alias de Android (10.0.2.2), nunca a un dominio externo',
        () {
      final String url = defaultLocalBackendBaseUrl();

      expect(
        url.contains('localhost') || url.contains('10.0.2.2'),
        isTrue,
        reason:
            'defaultLocalBackendBaseUrl() debe seguir siendo un default local, '
            'nunca un backend real hardcodeado — esa es una decisión de '
            'infraestructura aparte (ver environment_development.dart).',
      );
    });

    test(
        'el resultado siempre pasa la propia validación de resolveBackendBaseUrl',
        () {
      final AppEnvironment envWithDefault = AppEnvironment(
        name: 'test-default',
        firebaseOptions: _testFirebaseOptions,
        googleSignInWebClientId: null,
        backendBaseUrl: defaultLocalBackendBaseUrl(),
        allowsBackendOverride: true,
        allowsDevBackendTestUser: false,
      );

      expect(
        () => resolveBackendBaseUrl(envWithDefault, override: ''),
        returnsNormally,
      );
    });
  });
}
