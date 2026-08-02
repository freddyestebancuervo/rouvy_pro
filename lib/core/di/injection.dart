import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:dio/dio.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/foundation.dart' show kIsWeb, visibleForTesting;
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:get_it/get_it.dart';
import 'package:google_sign_in/google_sign_in.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../ble/ble_permission_handler.dart';
import '../config/app_environment.dart';
import '../config/backend_config_resolver.dart';
import '../health/health_platform_gateway.dart';
import '../health/health_platform_gateway_impl.dart';
import '../network/backend_auth_service.dart';
import '../network/backend_dio_client.dart';
import '../network/backend_session.dart';
import '../network/network_info.dart';
import '../sync/firestore_sync_service.dart';
import '../../features/workouts/data/datasources/workouts_remote_datasource.dart';
import '../../features/workouts/data/repositories/workouts_repository_impl.dart';
import '../../features/workouts/domain/repositories/workouts_repository.dart';
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

/// Resuelve el `clientId` real que se pasa a `GoogleSignIn`, separado de
/// `initDependencyInjection` para que sea unit-testeable sin necesitar
/// compilar a Web real (el llamador le pasa el valor real de `kIsWeb`).
///
/// En Android/iOS (`isWeb: false`) siempre devuelve `null` — el valor se
/// ignora en esas plataformas, se resuelve de forma nativa vía
/// `google-services.json` / `GoogleService-Info.plist`.
///
/// En Web (`isWeb: true`) exige `googleWebClientId` no nulo ni vacío y lo
/// devuelve tal cual — sin valor por defecto y sin fallback a ningún otro
/// entorno. Cada entry point (`main.dart`, `main_development.dart`) debe
/// pasar el Client ID oficial de su propio proyecto Firebase.
@visibleForTesting
String? resolveGoogleSignInClientId({
  required bool isWeb,
  required String? googleWebClientId,
}) {
  if (!isWeb) return null;
  if (googleWebClientId == null || googleWebClientId.isEmpty) {
    throw StateError(
      'googleWebClientId es obligatorio para builds Web. El entry point '
      '(main.dart / main_development.dart) debe pasarlo explícitamente a '
      'initDependencyInjection() — no existe un valor por defecto ni un '
      'fallback silencioso a otro entorno.',
    );
  }
  return googleWebClientId;
}

Future<void> initDependencyInjection(AppEnvironment environment) async {
  final String? resolvedGoogleSignInClientId = resolveGoogleSignInClientId(
    isWeb: kIsWeb,
    googleWebClientId: environment.googleSignInWebClientId,
  );
  // Resuelto ANTES de registrar los clientes Dio del backend (Documento 21,
  // Fase 0.3) — nunca se lee `BACKEND_BASE_URL_OVERRIDE` ni
  // `environment.backendBaseUrl` por separado en otro lugar.
  final String resolvedBackendBaseUrl = resolveBackendBaseUrl(environment);

  // ---------------------------------------------------------------------
  // Externos (SDKs de terceros) — siempre singletons, una sola instancia
  // ---------------------------------------------------------------------
  sl.registerLazySingleton<FirebaseAuth>(() => FirebaseAuth.instance);
  sl.registerLazySingleton<FirebaseFirestore>(() => FirebaseFirestore.instance);
  sl.registerLazySingleton<Connectivity>(Connectivity.new);
  sl.registerLazySingleton<GoogleSignIn>(
    () => GoogleSignIn(
      scopes: <String>['email', 'profile'],
      clientId: resolvedGoogleSignInClientId,
    ),
  );

  // `SharedPreferences.getInstance()` es async — se resuelve UNA vez aquí
  // y se registra la instancia ya lista (no la `Future`), para que el
  // resto del código la use de forma síncrona vía `sl<SharedPreferences>()`.
  final SharedPreferences sharedPreferences =
      await SharedPreferences.getInstance();
  sl.registerLazySingleton<SharedPreferences>(() => sharedPreferences);

  // ---------------------------------------------------------------------
  // Backend propio (NestJS, Bloque D — Equipment/Workouts) — sistema de
  // auth y transporte COMPLETAMENTE independiente de Firebase. Dos
  // instancias de Dio con nombre porque cumplen roles distintos: la
  // "authless" es la que usa `BackendAuthService` para sus propias
  // llamadas de login/registro/refresh (sin el interceptor, para no
  // disparar un ciclo de auth-dentro-de-auth); la "backendDio" es la que
  // consumen los datasources de features, ya con el token adjunto solo.
  // ---------------------------------------------------------------------
  sl.registerLazySingleton<FlutterSecureStorage>(
    () => const FlutterSecureStorage(),
  );
  sl.registerLazySingleton<BackendSessionStore>(
    () => BackendSessionStore(sl()),
  );
  sl.registerLazySingleton<Dio>(
    () => createAuthlessBackendDio(resolvedBackendBaseUrl),
    instanceName: 'backendAuthlessDio',
  );
  sl.registerLazySingleton<BackendAuthService>(
    () => BackendAuthService(
      authlessDio: sl<Dio>(instanceName: 'backendAuthlessDio'),
      store: sl(),
      allowsDevBackendTestUser: environment.allowsDevBackendTestUser,
    ),
  );
  sl.registerLazySingleton<Dio>(
    () => createAuthenticatedBackendDio(sl(), resolvedBackendBaseUrl),
    instanceName: 'backendDio',
  );

  // ---------------------------------------------------------------------
  // Core
  // ---------------------------------------------------------------------
  sl.registerLazySingleton<NetworkInfo>(() => NetworkInfoImpl(sl()));
  sl.registerLazySingleton<BlePermissionHandler>(BlePermissionHandler.new);
  sl.registerLazySingleton<HealthPlatformGateway>(
    HealthPlatformGatewayImpl.new,
  );
  sl.registerLazySingleton<FirestoreSyncService>(
    () => FirestoreSyncService(networkInfo: sl(), firestore: sl()),
  );

  // ---------------------------------------------------------------------
  // Feature: Auth
  // ---------------------------------------------------------------------
  sl.registerLazySingleton<AuthRemoteDataSource>(
    () => AuthRemoteDataSourceImpl(
      firebaseAuth: sl(),
      firestore: sl(),
      googleSignIn: sl(),
    ),
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
    () => BleDataSourceImpl(
      knownDevicesLocalDataSource: sl(),
      permissionHandler: sl(),
    ),
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
      WearableProviderType.appleHealth: HealthPackageAdapter(
        providerType: WearableProviderType.appleHealth,
        gateway: sl(),
      ),
      WearableProviderType.googleFit: HealthPackageAdapter(
        providerType: WearableProviderType.googleFit,
        gateway: sl(),
      ),
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

  // ---------------------------------------------------------------------
  // Feature: Entrenamientos (D2, Bloque D) — backend NestJS propio, ver
  // el bloque "Backend propio" más arriba. Primer feature del cliente que
  // habla con ese backend en vez de Firebase.
  // ---------------------------------------------------------------------
  sl.registerLazySingleton<WorkoutsRemoteDataSource>(
    () => WorkoutsRemoteDataSourceImpl(sl<Dio>(instanceName: 'backendDio')),
  );
  sl.registerLazySingleton<WorkoutsRepository>(
    () => WorkoutsRepositoryImpl(sl()),
  );
}
