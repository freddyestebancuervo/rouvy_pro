import 'package:flutter_test/flutter_test.dart';
import 'package:rouvy_pro/core/health/health_availability.dart';
import 'package:rouvy_pro/core/health/health_permission_status.dart';
import 'package:rouvy_pro/core/health/health_platform_gateway_impl.dart';

/// Regresión de T-F0.1 (crash de `dart:io`'s `Platform.isX` en Flutter
/// Web — ver `docs/tasks/TF0_1_ANALISIS_Y_DISENO.md`).
///
/// `kIsWeb` es una constante de compilación, no mockeable en una corrida
/// normal de `flutter test` (VM) — por eso `HealthPlatformGatewayImpl`
/// acepta un `isWeb` inyectable (mismo patrón ya usado en
/// `HealthPackageAdapter._isIOS`), lo que permite probar aquí el
/// CONTRATO de la guarda (Web → `unavailable`, sin tocar el plugin
/// nativo) sin necesitar un build Web real. La reproducción exacta del
/// `UnsupportedError` original de `dart:io` en un runtime Web real se
/// valida por separado con `flutter build web` (ver plan de pruebas del
/// documento de diseño, sección 14) — este archivo no la sustituye.
void main() {
  group('HealthPlatformGatewayImpl — guarda de plataforma Web (T-F0.1)', () {
    test('checkAvailability() en Web devuelve unavailable sin evaluar Platform.isX', () async {
      final HealthPlatformGatewayImpl gateway = HealthPlatformGatewayImpl(isWeb: () => true);

      // Si la guarda no existiera o estuviera mal ubicada, este `await`
      // llegaría a evaluar `Platform.isIOS`/`Platform.isAndroid` — bajo
      // VM eso no lanza (limitación de Web, no de la VM), pero sí
      // continuaría hacia el plugin `health` real, que no está
      // disponible en este entorno de test. Que la llamada complete de
      // inmediato con el valor esperado, sin tocar `_health`, confirma
      // que la guarda cortó el flujo en el punto correcto.
      final HealthAvailability result = await gateway.checkAvailability();
      expect(result, HealthAvailability.unavailable);
    });

    test('requestPermissions() en Web devuelve unavailable (delega en checkAvailability)', () async {
      final HealthPlatformGatewayImpl gateway = HealthPlatformGatewayImpl(isWeb: () => true);
      final HealthPermissionStatus result = await gateway.requestPermissions();
      expect(result, HealthPermissionStatus.unavailable);
    });

    test('checkPermissionStatus() en Web devuelve unavailable (delega en checkAvailability)', () async {
      final HealthPlatformGatewayImpl gateway = HealthPlatformGatewayImpl(isWeb: () => true);
      final HealthPermissionStatus result = await gateway.checkPermissionStatus();
      expect(result, HealthPermissionStatus.unavailable);
    });

    test('checkAvailability() fuera de Web conserva el comportamiento anterior (desktop/host de test)', () async {
      // Sin `isWeb` inyectado, usa `PlatformCapabilities.isWeb` real —
      // `false` en cualquier corrida de `flutter test` (VM). El host que
      // ejecuta la suite no es iOS ni Android, así que cae en la misma
      // rama "desktop" que ya existía antes de T-F0.1 — comportamiento
      // sin cambios para esta configuración.
      final HealthPlatformGatewayImpl gateway = HealthPlatformGatewayImpl();
      final HealthAvailability result = await gateway.checkAvailability();
      expect(result, HealthAvailability.unavailable);
    });
  });
}
