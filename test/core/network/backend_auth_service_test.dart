import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:rouvy_pro/core/network/backend_auth_service.dart';
import 'package:rouvy_pro/core/network/backend_session.dart';

class MockBackendSessionStore extends Mock implements BackendSessionStore {}

void main() {
  late MockBackendSessionStore emptyStore;

  setUp(() {
    emptyStore = MockBackendSessionStore();
    when(() => emptyStore.read()).thenAnswer((_) async => null);
  });

  /// Incidente real (canal Preview `web-dev`, creación de Workouts):
  /// `ensureAccessToken()` fallaba SIEMPRE en cualquier build no-debug,
  /// incluido Development, porque el único gate era `kDebugMode` — nunca
  /// llegaba a intentar ninguna petición HTTP real. Estas pruebas cubren
  /// exactamente el gate corregido (`AppEnvironment.allowsDevBackendTestUser`),
  /// sin depender de las credenciales reales de `DevBackendTestUser`
  /// (constantes de compilación vacías durante `flutter test`).
  group('ensureAccessToken — gate fuera de kDebugMode (incidente Preview)', () {
    test(
        'sin sesión, isDebugMode=false y allowsDevBackendTestUser=false '
        '(Production): rechaza con el error de "no se puede iniciar sesión"', () async {
      final service = BackendAuthService(
        authlessDio: Dio(),
        store: emptyStore,
        allowsDevBackendTestUser: false,
        isDebugMode: false,
      );

      await expectLater(
        service.ensureAccessToken(),
        throwsA(
          isA<StateError>().having(
            (StateError e) => e.message,
            'message',
            contains('no se puede iniciar sesión'),
          ),
        ),
      );
    });

    test(
        'sin sesión, isDebugMode=false y allowsDevBackendTestUser=true '
        '(Development/Preview): YA NO cae en el error de "no se puede iniciar sesión" '
        '— llega hasta el chequeo de DevBackendTestUser', () async {
      final service = BackendAuthService(
        authlessDio: Dio(),
        store: emptyStore,
        allowsDevBackendTestUser: true,
        isDebugMode: false,
      );

      await expectLater(
        service.ensureAccessToken(),
        throwsA(
          isA<StateError>()
              .having(
                (StateError e) => e.message,
                'message',
                isNot(contains('no se puede iniciar sesión')),
              )
              .having(
                (StateError e) => e.message,
                'message',
                contains('DevBackendTestUser no está configurada'),
              ),
        ),
      );
    });

    test(
        'sin sesión, isDebugMode=true (comportamiento local histórico, sin cambios): '
        'llega igual hasta el chequeo de DevBackendTestUser', () async {
      final service = BackendAuthService(
        authlessDio: Dio(),
        store: emptyStore,
        allowsDevBackendTestUser: false,
        isDebugMode: true,
      );

      await expectLater(
        service.ensureAccessToken(),
        throwsA(
          isA<StateError>().having(
            (StateError e) => e.message,
            'message',
            contains('DevBackendTestUser no está configurada'),
          ),
        ),
      );
    });
  });

  group('ensureAccessToken — sesión ya guardada, sin importar el gate', () {
    test('con una sesión vigente guardada, devuelve su accessToken sin tocar ningún gate',
        () async {
      when(() => emptyStore.read()).thenAnswer(
        (_) async => BackendSession(
          accessToken: 'stored-access-token',
          refreshToken: 'stored-refresh-token',
          expiresAt: DateTime.now().add(const Duration(hours: 1)),
        ),
      );
      final service = BackendAuthService(
        authlessDio: Dio(),
        store: emptyStore,
        allowsDevBackendTestUser: false,
        isDebugMode: false,
      );

      final String token = await service.ensureAccessToken();

      expect(token, 'stored-access-token');
    });
  });
}
