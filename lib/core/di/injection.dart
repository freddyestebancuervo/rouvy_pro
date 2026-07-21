import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:get_it/get_it.dart';
import 'package:google_sign_in/google_sign_in.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../ble/ble_permission_handler.dart';
import '../config/social_login_config.dart';
import '../health/health_platform_gateway.dart';
import '../health/health_platform_gateway_impl.dart';
import '../network/network_info.dart';
import '../sync/firestore_sync_service.dart';
import '../../features/auth/data/datasources/auth_remote_datasource.dart';
import '../../features/auth/data/repositories/auth_repository_impl.dart';
import '../../features/auth/domain/repositories/auth_repository.dart';
import '../../features/auth/domain/usecases/get_current_user_usecase.dart';
import '../../features/auth/domain/usecases/login_usecase.dart';
import '../../features/auth/domain/usecases/logout_usecase.dart';
import '../../features/auth/domain/usecases/register_usecase.dart';
import '../../features/auth/domain/usecases/reload_user_usecase.dart';
import '../../features/auth/domain/usecases/send_email_verification_usecase.dart';
import '../../features/auth/domain/usecases/send_password_reset_usecase.dart';
import '../../features/auth/domain/usecases/sign_in_with_apple_usecase.dart';
import '../../features/auth/domain/usecases/sign_in_with_google_usecase.dart';
import '../../features/auth/domain/usecases/update_profile_usecase.dart';
import '../../features/device_connection/data/datasources/ble_datasource.dart';
import '../../features/device_connection/data/datasources/known_devices_local_datasource.dart';
import '../../features/device_connection/data/repositories/device_repository_impl.dart';
import '../../features/device_connection/domain/repositories/device_repository.dart';
import '../../features/device_connection/domain/usecases/connect_device_usecase.dart';
import '../../features/device_connection/domain/usecases/disconnect_device_usecase.dart';
import '../../features/device_connection/domain/usecases/forget_device_usecase.dart';
import '../../features/device_connection/domain/usecases/observe_connected_devices_usecase.dart';
import '../../features/device_connection/domain/usecases/observe_telemetry_usecase.dart';
import '../../features/device_connection/domain/usecases/request_ble_permissions_usecase.dart';
import '../../features/device_connection/domain/usecases/scan_devices_usecase.dart';
import '../../features/device_connection/domain/usecases/stop_scan_usecase.dart';
import '../../features/training/data/datasources/ride_session_remote_datasource.dart';
import '../../features/training/data/datasources/ride_session_snapshot_local_datasource.dart';
import '../../features/training/data/repositories/ride_session_repository_impl.dart';
import '../../features/training/domain/repositories/ride_session_repository.dart';
import '../../features/training/domain/usecases/observe_ride_sessions_usecase.dart';
import '../../features/training/domain/usecases/save_ride_session_usecase.dart';
import '../../features/wearables/data/adapters/coros_adapter.dart';
import '../../features/wearables/data/adapters/garmin_adapter.dart';
import '../../features/wearables/data/adapters/health_package_adapter.dart';
import '../../features/wearables/data/adapters/polar_adapter.dart';
import '../../features/wearables/data/adapters/suunto_adapter.dart';
import '../../features/wearables/data/adapters/wearable_adapter.dart';
import '../../features/wearables/data/repositories/wearable_repository_impl.dart';
import '../../features/wearables/domain/entities/wearable_provider_type.dart';
import '../../features/wearables/domain/repositories/wearable_repository.dart';
import '../../features/wearables/domain/usecases/connect_wearable_usecase.dart';
import '../../features/wearables/domain/usecases/disconnect_wearable_usecase.dart';
import '../../features/wearables/domain/usecases/import_activities_usecase.dart';
import '../../features/wearables/domain/usecases/observe_wearable_connections_usecase.dart';
import '../../features/routes_catalog/data/repositories/routes_repository_impl.dart';
import '../../features/routes_catalog/domain/repositories/routes_repository.dart';

/// Contenedor global de dependencias.
///
/// DECISIÓN DE DISEÑO: el registro es **manual** (no con
/// `injectable`/`build_runner`) para que el proyecto compile de inmediato
/// sin pasos de generación de código previos. `injectable` queda como
/// dependencia disponible en `pubspec.yaml` por si el equipo decide migrar
/// a registro por anotaciones cuando el número de features crezca.
final GetIt sl = GetIt.instance; // sl = "service locator"

Future<void> initDependencyInjection() async {
  // ---------------------------------------------------------------------
  // Externos (SDKs de terceros) — siempre singletons, una sola instancia
  // ---------------------------------------------------------------------
  sl.registerLazySingleton<FirebaseAuth>(() => FirebaseAuth.instance);
  sl.registerLazySingleton<FirebaseFirestore>(() => FirebaseFirestore.instance);
  sl.registerLazySingleton<Connectivity>(Connectivity.new);
  sl.registerLazySingleton<GoogleSignIn>(
    () => GoogleSignIn(
      scopes: <String>['email', 'profile'],
      // En Android/iOS este parámetro se ignora (se resuelve de forma
      // nativa vía google-services.json / GoogleService-Info.plist); en
      // Web es OBLIGATORIO — sin él, `signIn()` falla en silencio.
      clientId: kIsWeb ? SocialLoginConfig.googleWebClientId : null,
    ),
  );

  // `SharedPreferences.getInstance()` es async — se resuelve UNA vez aquí
  // y se registra la instancia ya lista (no la `Future`), para que el
  // resto del código la use de forma síncrona vía `sl<SharedPreferences>()`.
  final SharedPreferences sharedPreferences = await SharedPreferences.getInstance();
  sl.registerLazySingleton<SharedPreferences>(() => sharedPreferences);

  // ---------------------------------------------------------------------
  // Core
  // ---------------------------------------------------------------------
  sl.registerLazySingleton<NetworkInfo>(() => NetworkInfoImpl(sl()));
  sl.registerLazySingleton<BlePermissionHandler>(BlePermissionHandler.new);
  sl.registerLazySingleton<HealthPlatformGateway>(HealthPlatformGatewayImpl.new);
  sl.registerLazySingleton<FirestoreSyncService>(
    () => FirestoreSyncService(networkInfo: sl(), firestore: sl()),
  );

  // ---------------------------------------------------------------------
  // Feature: Auth
  // ---------------------------------------------------------------------
  sl.registerLazySingleton<AuthRemoteDataSource>(
    () => AuthRemoteDataSourceImpl(firebaseAuth: sl(), firestore: sl(), googleSignIn: sl()),
  );

  sl.registerLazySingleton<AuthRepository>(
    () => AuthRepositoryImpl(remoteDataSource: sl(), networkInfo: sl()),
  );

  sl.registerFactory(() => LoginUseCase(sl()));
  sl.registerFactory(() => RegisterUseCase(sl()));
  sl.registerFactory(() => LogoutUseCase(sl()));
  sl.registerFactory(() => GetCurrentUserUseCase(sl()));
  sl.registerFactory(() => SignInWithGoogleUseCase(sl()));
  sl.registerFactory(() => SignInWithAppleUseCase(sl()));
  sl.registerFactory(() => SendPasswordResetUseCase(sl()));
  sl.registerFactory(() => SendEmailVerificationUseCase(sl()));
  sl.registerFactory(() => ReloadUserUseCase(sl()));
  sl.registerFactory(() => UpdateProfileUseCase(sl()));

  // ---------------------------------------------------------------------
  // Feature: Device connection (BLE)
  // ---------------------------------------------------------------------
  sl.registerLazySingleton<KnownDevicesLocalDataSource>(
    () => KnownDevicesLocalDataSourceImpl(sl()),
  );

  // Singleton (no factory): el datasource mantiene estado en memoria — las
  // sesiones de conexión activas, sus streams de telemetría — que debe
  // persistir durante toda la vida de la app, no recrearse en cada acceso.
  sl.registerLazySingleton<BleDataSource>(
    () => BleDataSourceImpl(knownDevicesLocalDataSource: sl(), permissionHandler: sl()),
  );

  sl.registerLazySingleton<DeviceRepository>(
    () => DeviceRepositoryImpl(dataSource: sl()),
  );

  sl.registerFactory(() => ScanDevicesUseCase(sl()));
  sl.registerFactory(() => StopScanUseCase(sl()));
  sl.registerFactory(() => ConnectDeviceUseCase(sl()));
  sl.registerFactory(() => DisconnectDeviceUseCase(sl()));
  sl.registerFactory(() => ForgetDeviceUseCase(sl()));
  sl.registerFactory(() => ObserveConnectedDevicesUseCase(sl()));
  sl.registerFactory(() => ObserveTelemetryUseCase(sl()));
  sl.registerFactory(() => RequestBlePermissionsUseCase(sl()));

  // ---------------------------------------------------------------------
  // Feature: Wearables (Apple Health, Google Fit + Garmin/Polar/Coros/Suunto simulados)
  // ---------------------------------------------------------------------
  //
  // ÚNICO PUNTO DE ACTIVACIÓN de una integración real cuando llegue la
  // aprobación de partner: reemplazar, p. ej., `GarminAdapter()` por
  // `GarminAdapterImpl(...)` en este mapa — ver WEARABLES_SETUP.md.
  sl.registerLazySingleton<Map<WearableProviderType, WearableAdapter>>(
    () => <WearableProviderType, WearableAdapter>{
      WearableProviderType.appleHealth:
          HealthPackageAdapter(providerType: WearableProviderType.appleHealth, gateway: sl()),
      WearableProviderType.googleFit:
          HealthPackageAdapter(providerType: WearableProviderType.googleFit, gateway: sl()),
      WearableProviderType.garmin: GarminAdapter(),
      WearableProviderType.polar: PolarAdapter(),
      WearableProviderType.coros: CorosAdapter(),
      WearableProviderType.suunto: SuuntoAdapter(),
    },
  );

  sl.registerLazySingleton<WearableRepository>(
    () => WearableRepositoryImpl(adapters: sl()),
  );

  sl.registerFactory(() => ConnectWearableUseCase(sl()));
  sl.registerFactory(() => DisconnectWearableUseCase(sl()));
  sl.registerFactory(() => ImportActivitiesUseCase(sl()));
  sl.registerFactory(() => ObserveWearableConnectionsUseCase(sl()));

  // ---------------------------------------------------------------------
  // Feature: Training (historial de sesiones — base de M3 Estadísticas)
  // ---------------------------------------------------------------------
  sl.registerLazySingleton<RideSessionRemoteDataSource>(
    () => RideSessionRemoteDataSourceImpl(firestore: sl(), firebaseAuth: sl()),
  );
  sl.registerLazySingleton<RideSessionSnapshotLocalDataSource>(
    () => RideSessionSnapshotLocalDataSourceImpl(sl()),
  );
  sl.registerLazySingleton<RideSessionRepository>(
    () => RideSessionRepositoryImpl(remoteDataSource: sl()),
  );
  sl.registerFactory(() => SaveRideSessionUseCase(sl()));
  sl.registerFactory(() => ObserveRideSessionsUseCase(sl()));

  // ---------------------------------------------------------------------
  // Feature: Catálogo de rutas (M4) — mock hoy, sin backend real todavía
  // (ver docstring de `TrainingRoute`). Se registra igual que cualquier
  // otro repositorio porque no depende de Firebase/Postgres/BLE en
  // absoluto — es seguro tenerlo activo en producción ya mismo.
  // ---------------------------------------------------------------------
  sl.registerLazySingleton<RoutesRepository>(RoutesRepositoryImpl.new);
}
