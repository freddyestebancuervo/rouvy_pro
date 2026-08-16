import 'package:flutter_test/flutter_test.dart';
import 'package:rouvy_pro/core/health/health_availability.dart';
import 'package:rouvy_pro/core/health/health_permission_status.dart';
import 'package:rouvy_pro/core/health/health_platform_gateway_impl.dart';

/// Regresión de T-F0.1 (crash de `dart:io`'s `Platform.isX` en Flutter
/// Web — ver `docs/tasks/TF0_1_ANALISIS_Y_DISENO.md`).
///
/// Este archivo prueba la implementación REAL (`HealthPlatformGatewayImpl`),
/// no un fake — a propósito, porque el bug vivía en esta clase concreta.
/// Bajo `flutter test` normal (VM), `kIsWeb` es `false` y este test no
/// distingue nada nuevo (el código viejo tampoco fallaba en la VM/Windows,
/// solo en Web). La prueba de regresión real de esta corrección requiere
/// ejecutarse compilado para Web:
///
///   flutter test --platform chrome test/core/health/health_platform_gateway_impl_test.dart
///
/// Con el código previo al fix, esa corrida terminaba con `UnsupportedError`
/// sin capturar dentro del propio test (falla). Con el fix, pasa limpio.
void main() {
  group('HealthPlatformGatewayImpl — comportamiento en Web (T-F0.1)', () {
    late HealthPlatformGatewayImpl gateway;

    setUp(() {
      gateway = HealthPlatformGatewayImpl();
    });

    test('checkAvailability() no lanza y devuelve un valor válido', () async {
      // Antes del fix, bajo `--platform chrome`, esta línea lanzaba
      // UnsupportedError (dart:io Platform.isIOS no soportado en Web)
      // antes de poder devolver cualquier valor.
      final HealthAvailability result = await gateway.checkAvailability();
      expect(result, isA<HealthAvailability>());
    });

    test('requestPermissions() no lanza y devuelve un valor válido', () async {
      final HealthPermissionStatus result = await gateway.requestPermissions();
      expect(result, isA<HealthPermissionStatus>());
    });

    test('checkPermissionStatus() no lanza y devuelve un valor válido', () async {
      final HealthPermissionStatus result = await gateway.checkPermissionStatus();
      expect(result, isA<HealthPermissionStatus>());
    });
  });
}
