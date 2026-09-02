import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:rouvy_pro/core/config/dev_backend_test_user.dart';
import 'package:rouvy_pro/core/network/backend_auth_service.dart';
import 'package:rouvy_pro/core/network/backend_session.dart';

class MockBackendSessionStore extends Mock implements BackendSessionStore {}

class MockDio extends Mock implements Dio {}

BackendSession _fallbackSession() => BackendSession(
      accessToken: 'fallback-access',
      refreshToken: 'fallback-refresh',
      expiresAt: DateTime.now().add(const Duration(hours: 1)),
    );

Response<dynamic> _sessionResponse(
  String path, {
  String accessToken = 'access',
}) {
  return Response<dynamic>(
    requestOptions: RequestOptions(path: path),
    statusCode: 200,
    data: <String, dynamic>{
      'accessToken': accessToken,
      'refreshToken': 'refresh',
      'expiresIn': 3600,
    },
  );
}

DioException _dioError(String path, int statusCode) {
  return DioException(
    requestOptions: RequestOptions(path: path),
    response: Response<dynamic>(
      requestOptions: RequestOptions(path: path),
      statusCode: statusCode,
    ),
  );
}

void _verifyNeverRegisters(MockDio dio) {
  verifyNever(
    () => dio.post<dynamic>('/auth/register', data: any(named: 'data')),
  );
}

void main() {
  setUpAll(() {
    registerFallbackValue(_fallbackSession());
  });

  late MockBackendSessionStore emptyStore;

  setUp(() {
    emptyStore = MockBackendSessionStore();
    when(() => emptyStore.read()).thenAnswer((_) async => null);
    when(() => emptyStore.save(any())).thenAnswer((_) async {});
    when(() => emptyStore.clear()).thenAnswer((_) async {});
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
        '(Production): rechaza con el error de "no se puede iniciar sesión"',
        () async {
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
    test(
        'con una sesión vigente guardada, devuelve su accessToken sin tocar ningún gate',
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

  group('ensureAccessToken — refresh, sin depender de DevBackendTestUser', () {
    test(
        'sesión expirada con refresh exitoso: reutiliza la sesión refrescada, '
        'nunca llama a login ni a register', () async {
      when(() => emptyStore.read()).thenAnswer(
        (_) async => BackendSession(
          accessToken: 'expired',
          refreshToken: 'good-refresh',
          expiresAt: DateTime.now().subtract(const Duration(minutes: 1)),
        ),
      );
      final MockDio dio = MockDio();
      when(
        () => dio.post<dynamic>('/auth/refresh', data: any(named: 'data')),
      ).thenAnswer(
        (_) async => _sessionResponse(
          '/auth/refresh',
          accessToken: 'refreshed-access',
        ),
      );
      final service = BackendAuthService(
        authlessDio: dio,
        store: emptyStore,
        allowsDevBackendTestUser: false,
        isDebugMode: false,
      );

      final String token = await service.ensureAccessToken();

      expect(token, 'refreshed-access');
      verifyNever(
        () => dio.post<dynamic>('/auth/login', data: any(named: 'data')),
      );
      _verifyNeverRegisters(dio);
    });
  });

  /// B2-QA-IDENTITY-HARDENING (2026-09-01): antes, un login QA fallido
  /// intentaba `POST /auth/register` automáticamente ante un 409 en el
  /// camino inverso (register primero, login en 409) — si las credenciales
  /// locales se desalineaban de la cuenta QA real, el registro podía tener
  /// éxito y crear una cuenta nueva en silencio. Estas pruebas demuestran
  /// que `_loginTestUser` SOLO llama a `/auth/login` y NUNCA a
  /// `/auth/register`, sin importar el resultado.
  ///
  /// `DevBackendTestUser.email`/`password` son `const
  /// String.fromEnvironment(...)` — constantes de compilación que no
  /// pueden inyectarse en runtime. Sin `--dart-define`, quedan vacías y
  /// `DevBackendTestUser.isConfigured == false`, por lo que
  /// `BackendAuthService` nunca llega a intentar ninguna petición HTTP (ver
  /// el primer grupo de este archivo). Este grupo solo se ejercita de
  /// verdad ejecutando:
  ///   flutter test --dart-define=QA_BACKEND_EMAIL=qa-test@example.invalid
  ///     --dart-define=QA_BACKEND_PASSWORD=qa-test-password
  /// — valores de prueba obviamente falsos, nunca credenciales reales. Sin
  /// ese dart-define, cada test de este grupo se salta explícitamente (no
  /// falla) para que `flutter test` normal siga en verde.
  group('ensureAccessToken — DevBackendTestUser: SOLO login, nunca registro',
      () {
    final bool configured = DevBackendTestUser.isConfigured;
    final String skipReason = configured
        ? ''
        : 'Requiere flutter test --dart-define=QA_BACKEND_EMAIL=... '
            '--dart-define=QA_BACKEND_PASSWORD=... (valores de prueba, nunca '
            'reales) para que DevBackendTestUser.isConfigured sea true.';

    test(
      'login exitoso: llama exactamente una vez a /auth/login, nunca a /auth/register',
      () async {
        final MockDio dio = MockDio();
        when(() => dio.post<dynamic>('/auth/login', data: any(named: 'data')))
            .thenAnswer((_) async => _sessionResponse('/auth/login'));
        final service = BackendAuthService(
          authlessDio: dio,
          store: emptyStore,
          allowsDevBackendTestUser: false,
          isDebugMode: true,
        );

        final String token = await service.ensureAccessToken();

        expect(token, 'access');
        verify(() => dio.post<dynamic>('/auth/login', data: any(named: 'data')))
            .called(1);
        _verifyNeverRegisters(dio);
      },
      skip: configured ? false : skipReason,
    );

    test(
      'login con 401: falla con QA_BACKEND_IDENTITY_INVALID, nunca registra',
      () async {
        final MockDio dio = MockDio();
        when(() => dio.post<dynamic>('/auth/login', data: any(named: 'data')))
            .thenThrow(_dioError('/auth/login', 401));
        final service = BackendAuthService(
          authlessDio: dio,
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
              contains('QA_BACKEND_IDENTITY_INVALID'),
            ),
          ),
        );
        _verifyNeverRegisters(dio);
      },
      skip: configured ? false : skipReason,
    );

    test(
      'login con 404 (cuenta inexistente): también falla, nunca registra',
      () async {
        final MockDio dio = MockDio();
        when(() => dio.post<dynamic>('/auth/login', data: any(named: 'data')))
            .thenThrow(_dioError('/auth/login', 404));
        final service = BackendAuthService(
          authlessDio: dio,
          store: emptyStore,
          allowsDevBackendTestUser: false,
          isDebugMode: true,
        );

        await expectLater(
          service.ensureAccessToken(),
          throwsA(isA<StateError>()),
        );
        _verifyNeverRegisters(dio);
      },
      skip: configured ? false : skipReason,
    );

    test(
      'otro fallo (5xx) también falla sin registrar',
      () async {
        final MockDio dio = MockDio();
        when(() => dio.post<dynamic>('/auth/login', data: any(named: 'data')))
            .thenThrow(_dioError('/auth/login', 503));
        final service = BackendAuthService(
          authlessDio: dio,
          store: emptyStore,
          allowsDevBackendTestUser: false,
          isDebugMode: true,
        );

        await expectLater(
          service.ensureAccessToken(),
          throwsA(isA<StateError>()),
        );
        _verifyNeverRegisters(dio);
      },
      skip: configured ? false : skipReason,
    );

    test(
      'refresh fallido cae al login QA únicamente donde el gate lo permite, nunca registra',
      () async {
        when(() => emptyStore.read()).thenAnswer(
          (_) async => BackendSession(
            accessToken: 'expired',
            refreshToken: 'bad-refresh',
            expiresAt: DateTime.now().subtract(const Duration(minutes: 1)),
          ),
        );
        final MockDio dio = MockDio();
        when(() => dio.post<dynamic>('/auth/refresh', data: any(named: 'data')))
            .thenThrow(_dioError('/auth/refresh', 401));
        when(
          () => dio.post<dynamic>('/auth/login', data: any(named: 'data')),
        ).thenAnswer(
          (_) async => _sessionResponse(
            '/auth/login',
            accessToken: 'new-access',
          ),
        );
        final service = BackendAuthService(
          authlessDio: dio,
          store: emptyStore,
          allowsDevBackendTestUser: false,
          isDebugMode: true,
        );

        final String token = await service.ensureAccessToken();

        expect(token, 'new-access');
        verify(() => emptyStore.clear()).called(1);
        _verifyNeverRegisters(dio);
      },
      skip: configured ? false : skipReason,
    );
  });
}
