import 'package:shared_preferences/shared_preferences.dart';

import '../core/ble/ble_permission_handler.dart';
import '../core/di/injection.dart';
import '../features/routes_catalog/data/repositories/routes_repository_impl.dart';
import '../features/routes_catalog/domain/repositories/routes_repository.dart';
import '../features/training/data/datasources/ride_session_snapshot_local_datasource.dart';

/// Registra en el MISMO contenedor global de GetIt (`sl`) solo las
/// piezas que:
/// (a) algún provider de producción resuelve directamente vía `sl()`
///     (no vía un `Override` de Riverpod, ver `demo_overrides.dart`), y
/// (b) no tienen NINGUNA dependencia de Firebase/Postgres/BLE real —
///     son seguras de usar tal cual en modo demo.
///
/// Deliberadamente NO se llama a `initDependencyInjection()` (la función
/// de producción) — esa registra `FirebaseAuth`/`FirebaseFirestore`
/// directamente, que lanzarían una excepción sin `Firebase.initializeApp()`
/// (que el modo demo tampoco llama, a propósito).
Future<void> initDemoDependencyInjection() async {
  if (!sl.isRegistered<SharedPreferences>()) {
    final SharedPreferences prefs = await SharedPreferences.getInstance();
    sl.registerLazySingleton<SharedPreferences>(() => prefs);
  }

  // Real, no un fake — `permission_handler` funciona igual en demo que en
  // producción, no depende de Firebase. Lo usa `BlePermissionController`
  // vía `sl<BlePermissionHandler>()` directamente (no a través de
  // `DeviceRepository`), así que necesita existir en GetIt aunque
  // `DeviceRepository` en sí esté faked vía Riverpod.
  if (!sl.isRegistered<BlePermissionHandler>()) {
    sl.registerLazySingleton<BlePermissionHandler>(BlePermissionHandler.new);
  }

  // Real también — solo envuelve `SharedPreferences`, sin Firebase. La
  // recuperación de sesión (tarea B1) funciona igual de bien en demo que
  // en producción; no hay motivo para simularla.
  if (!sl.isRegistered<RideSessionSnapshotLocalDataSource>()) {
    sl.registerLazySingleton<RideSessionSnapshotLocalDataSource>(
      () => RideSessionSnapshotLocalDataSourceImpl(sl()),
    );
  }

  // Real también — el catálogo de rutas todavía no tiene backend en
  // producción (ver el comentario de `TrainingRoute`): `RoutesRepositoryImpl`
  // ya es 100% datos fijos en memoria (`RoutesMockDataSource`), sin
  // Firebase. Sin este registro, `routesRepositoryProvider` (que resuelve
  // vía `sl()`, igual que en producción) lanzaría "not registered" apenas
  // se abriera el catálogo en modo demo.
  if (!sl.isRegistered<RoutesRepository>()) {
    sl.registerLazySingleton<RoutesRepository>(RoutesRepositoryImpl.new);
  }
}
