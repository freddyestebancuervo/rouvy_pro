import 'dart:math';

import '../../domain/entities/external_activity.dart';
import 'wearable_adapter.dart';

/// Base de los 4 adapters que representan proveedores con API cerrada
/// tras un programa de partners (Garmin, Polar, Coros, Suunto).
///
/// DECISIÓN DE ARQUITECTURA (ver `ARCHITECTURE_DECISIONS.md` sección 2):
/// en vez de dejar estas clases sin implementar o lanzando
/// `UnimplementedError`, simulan un flujo de conexión exitoso y devuelven
/// actividades de ejemplo con datos realistas. Esto permite:
///
/// 1. Construir y testear TODA la UI de wearables (lista de conexiones,
///    importación de actividades, estadísticas que las consumen) sin
///    bloquear el desarrollo a la espera de la aprobación de Garmin/Polar/
///    Coros/Suunto, que puede tardar semanas.
/// 2. Hacer demos del producto completo antes de tener acceso real.
///
/// Para que NUNCA se confunda con datos reales: cada actividad generada
/// lleva el prefijo `MOCK-` en su `id`, y `requiresPartnerApproval =
/// true` hace que la UI muestre permanentemente un badge "Simulado —
/// pendiente de aprobación oficial" sin importar el estado de conexión.
/// Sustituir esta clase por la integración real se documenta paso a paso
/// en `WEARABLES_SETUP.md`.
abstract class MockWearableAdapter implements WearableAdapter {
  bool _connected = false;
  final Random _random = Random();

  @override
  bool get requiresPartnerApproval => true;

  @override
  Future<bool> requestAuthorization() async {
    // Simula la latencia de un flujo OAuth2 real, para que la UI de
    // carga (spinners) se comporte de forma realista durante el
    // desarrollo, en vez de resolver instantáneamente.
    await Future<void>.delayed(const Duration(milliseconds: 600));
    return true;
  }

  @override
  Future<void> connect() async {
    await requestAuthorization();
    _connected = true;
  }

  @override
  Future<void> disconnect() async {
    _connected = false;
  }

  @override
  Future<bool> get isConnected async => _connected;

  @override
  Future<List<ExternalActivity>> fetchActivities({DateTime? since}) async {
    if (!_connected) return const <ExternalActivity>[];

    await Future<void>.delayed(const Duration(milliseconds: 400));

    final DateTime start = since ?? DateTime.now().subtract(const Duration(days: 30));
    final int daySpan = DateTime.now().difference(start).inDays.clamp(1, 30);
    final int activityCount = min(5, (daySpan / 7).ceil() + 1);

    return List<ExternalActivity>.generate(activityCount, (int index) {
      final DateTime activityDate = DateTime.now().subtract(Duration(days: index * 6 + 1));
      final int durationMinutes = 30 + _random.nextInt(90);
      return ExternalActivity(
        id: 'MOCK-${providerType.name}-${activityDate.millisecondsSinceEpoch}',
        provider: providerType,
        type: ExternalActivityType.cycling,
        startTime: activityDate,
        durationSeconds: durationMinutes * 60,
        distanceMeters: (durationMinutes * (25 + _random.nextInt(10))) * 1000 / 60,
        caloriesKcal: (durationMinutes * (7 + _random.nextInt(4))).toDouble(),
        averageHeartRateBpm: 130 + _random.nextInt(30),
        averagePowerWatts: 150 + _random.nextInt(80),
      );
    });
  }
}
