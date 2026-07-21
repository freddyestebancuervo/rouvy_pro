import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:rouvy_pro/features/training/data/datasources/ride_session_snapshot_local_datasource.dart';

void main() {
  late RideSessionSnapshotLocalDataSourceImpl dataSource;

  setUp(() async {
    SharedPreferences.setMockInitialValues(<String, Object>{});
    final SharedPreferences prefs = await SharedPreferences.getInstance();
    dataSource = RideSessionSnapshotLocalDataSourceImpl(prefs);
  });

  RideSessionSnapshotData buildSnapshot({DateTime? savedAt}) {
    return RideSessionSnapshotData(
      startTimeIso: DateTime(2026, 1, 1, 8).toIso8601String(),
      elapsedSeconds: 600,
      distanceMeters: 5000,
      caloriesKcal: 120,
      connectedDeviceCount: 1,
      savedAtIso: (savedAt ?? DateTime.now()).toIso8601String(),
    );
  }

  test('load() devuelve null cuando no hay ningún snapshot guardado', () async {
    expect(await dataSource.load(), isNull);
  });

  test('save() → load() conserva todos los campos', () async {
    final RideSessionSnapshotData original = buildSnapshot();

    await dataSource.save(original);
    final RideSessionSnapshotData? loaded = await dataSource.load();

    expect(loaded, isNotNull);
    expect(loaded!.elapsedSeconds, 600);
    expect(loaded.distanceMeters, 5000);
    expect(loaded.caloriesKcal, 120);
    expect(loaded.connectedDeviceCount, 1);
  });

  test('clear() elimina el snapshot guardado', () async {
    await dataSource.save(buildSnapshot());
    await dataSource.clear();

    expect(await dataSource.load(), isNull);
  });

  test('un snapshot más viejo que maxRecoverableAge se descarta automáticamente', () async {
    final DateTime tooOld = DateTime.now().subtract(const Duration(hours: 4));
    await dataSource.save(buildSnapshot(savedAt: tooOld));

    expect(await dataSource.load(), isNull);
  });

  test('un snapshot dentro de maxRecoverableAge sí se recupera', () async {
    final DateTime recent = DateTime.now().subtract(const Duration(minutes: 30));
    await dataSource.save(buildSnapshot(savedAt: recent));

    expect(await dataSource.load(), isNotNull);
  });
}
