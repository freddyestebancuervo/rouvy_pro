import 'package:flutter_test/flutter_test.dart';
import 'package:rouvy_pro/features/device_connection/domain/entities/aggregated_telemetry.dart';
import 'package:rouvy_pro/features/device_connection/domain/entities/telemetry_snapshot.dart';
import 'package:rouvy_pro/features/device_connection/domain/services/telemetry_aggregator.dart';

void main() {
  group('TelemetryAggregator', () {
    test('la primera lectura fija los valores instantáneos sin integrar distancia/calorías', () {
      final TelemetryAggregator aggregator = TelemetryAggregator();
      final DateTime t0 = DateTime(2026, 1, 1, 12, 0, 0);

      final AggregatedTelemetry result = aggregator.ingest(
        TelemetrySnapshot(deviceId: 'trainer-1', timestamp: t0, speedKmh: 30, powerWatts: 200, cadenceRpm: 90),
      );

      expect(result.speedKmh, 30);
      expect(result.powerWatts, 200);
      expect(result.distanceMeters, 0); // sin lectura previa, no hay intervalo que integrar
      expect(result.caloriesKcal, 0);
    });

    test('integra distancia y calorías entre dos lecturas separadas por un intervalo conocido', () {
      final TelemetryAggregator aggregator = TelemetryAggregator();
      final DateTime t0 = DateTime(2026, 1, 1, 12, 0, 0);

      aggregator.ingest(
        TelemetrySnapshot(deviceId: 'trainer-1', timestamp: t0, speedKmh: 36, powerWatts: 200),
      );

      // 10 segundos después, misma velocidad/potencia sostenida.
      final AggregatedTelemetry result = aggregator.ingest(
        TelemetrySnapshot(
          deviceId: 'trainer-1',
          timestamp: t0.add(const Duration(seconds: 10)),
          speedKmh: 36,
          powerWatts: 200,
        ),
      );

      // distancia = (36 km/h / 3.6) * 10s = 100 m
      expect(result.distanceMeters, closeTo(100, 0.01));
      // calorías ≈ 200W * 10s / 1000 = 2.0 kcal (aproximación kJ≈kcal)
      expect(result.caloriesKcal, closeTo(2.0, 0.01));
    });

    test('un dispositivo sin velocidad no pisa la velocidad reportada por otro (fusión de campos)', () {
      final TelemetryAggregator aggregator = TelemetryAggregator();
      final DateTime t0 = DateTime(2026, 1, 1, 12, 0, 0);

      // Rodillo aporta velocidad y potencia.
      aggregator.ingest(
        TelemetrySnapshot(deviceId: 'trainer-1', timestamp: t0, speedKmh: 28, powerWatts: 180),
      );

      // Pulsómetro, un segundo después, solo aporta FC — no debe borrar
      // la velocidad/potencia ya conocidas.
      final AggregatedTelemetry result = aggregator.ingest(
        TelemetrySnapshot(
          deviceId: 'hr-1',
          timestamp: t0.add(const Duration(seconds: 1)),
          heartRateBpm: 145,
        ),
      );

      expect(result.heartRateBpm, 145);
      expect(result.speedKmh, 28); // conservada del snapshot anterior
      expect(result.powerWatts, 180);
    });

    test('reset() vuelve el estado a cero para empezar una nueva sesión', () {
      final TelemetryAggregator aggregator = TelemetryAggregator();
      final DateTime t0 = DateTime(2026, 1, 1, 12, 0, 0);

      aggregator.ingest(TelemetrySnapshot(deviceId: 'trainer-1', timestamp: t0, speedKmh: 30, powerWatts: 200));
      aggregator.ingest(
        TelemetrySnapshot(deviceId: 'trainer-1', timestamp: t0.add(const Duration(seconds: 5)), speedKmh: 30),
      );

      aggregator.reset();

      expect(aggregator.currentState, const AggregatedTelemetry());
    });

    test('seed() restaura un estado previo y las siguientes lecturas integran a partir de ahí (B1)', () {
      final TelemetryAggregator aggregator = TelemetryAggregator();
      aggregator.seed(const AggregatedTelemetry(distanceMeters: 5000, caloriesKcal: 120));

      expect(aggregator.currentState.distanceMeters, 5000);
      expect(aggregator.currentState.caloriesKcal, 120);

      final DateTime t0 = DateTime(2026, 1, 1, 12, 0, 0);
      aggregator.ingest(TelemetrySnapshot(deviceId: 'trainer-1', timestamp: t0, speedKmh: 36, powerWatts: 200));
      final AggregatedTelemetry result = aggregator.ingest(
        TelemetrySnapshot(
          deviceId: 'trainer-1',
          timestamp: t0.add(const Duration(seconds: 10)),
          speedKmh: 36,
          powerWatts: 200,
        ),
      );

      // 5000m sembrados + 100m integrados en los 10s siguientes (36km/h = 10m/s)
      expect(result.distanceMeters, closeTo(5100, 0.01));
    });
  });
}
