import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:rouvy_pro/core/network/backend_auth_service.dart';
import 'package:rouvy_pro/core/network/backend_dio_client.dart';

class MockBackendAuthService extends Mock implements BackendAuthService {}

void main() {
  group('createAuthlessBackendDio', () {
    test(
        'configura Dio con exactamente la baseUrl recibida, sin valor por defecto',
        () {
      const String customUrl = 'https://custom-test-backend.example/v1';

      final dio = createAuthlessBackendDio(customUrl);

      expect(dio.options.baseUrl, customUrl);
      expect(dio.options.baseUrl, isNot(contains('localhost')));
    });

    test(
        'dos URLs distintas producen dos configuraciones distintas (no hay caché/fallback compartido)',
        () {
      final dioA = createAuthlessBackendDio('https://a.example/v1');
      final dioB = createAuthlessBackendDio('https://b.example/v1');

      expect(dioA.options.baseUrl, 'https://a.example/v1');
      expect(dioB.options.baseUrl, 'https://b.example/v1');
    });
  });

  group('createAuthenticatedBackendDio', () {
    test(
        'configura Dio con exactamente la baseUrl recibida, sin valor por defecto',
        () {
      const String customUrl =
          'https://custom-authenticated-backend.example/v1';
      final authService = MockBackendAuthService();

      final dio = createAuthenticatedBackendDio(authService, customUrl);

      expect(dio.options.baseUrl, customUrl);
      expect(dio.options.baseUrl, isNot(contains('localhost')));
    });

    test('adjunta el interceptor de autenticación', () {
      final authService = MockBackendAuthService();

      final dio =
          createAuthenticatedBackendDio(authService, 'https://x.example/v1');

      expect(dio.interceptors, isNotEmpty);
    });
  });
}
