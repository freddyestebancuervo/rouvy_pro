import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/sync/sync_status.dart';
import '../core/sync/sync_status_provider.dart';
import '../features/auth/domain/usecases/get_current_user_usecase.dart';
import '../features/auth/domain/usecases/login_usecase.dart';
import '../features/auth/domain/usecases/logout_usecase.dart';
import '../features/auth/domain/usecases/register_usecase.dart';
import '../features/auth/domain/usecases/reload_user_usecase.dart';
import '../features/auth/domain/usecases/send_email_verification_usecase.dart';
import '../features/auth/domain/usecases/send_password_reset_usecase.dart';
import '../features/auth/domain/usecases/sign_in_with_apple_usecase.dart';
import '../features/auth/domain/usecases/sign_in_with_google_usecase.dart';
import '../features/auth/domain/usecases/update_profile_usecase.dart';
import '../features/auth/presentation/providers/auth_providers.dart';
import '../features/device_connection/domain/usecases/connect_device_usecase.dart';
import '../features/device_connection/domain/usecases/disconnect_device_usecase.dart';
import '../features/device_connection/domain/usecases/forget_device_usecase.dart';
import '../features/device_connection/domain/usecases/observe_connected_devices_usecase.dart';
import '../features/device_connection/domain/usecases/observe_telemetry_usecase.dart';
import '../features/device_connection/domain/usecases/request_ble_permissions_usecase.dart';
import '../features/device_connection/domain/usecases/scan_devices_usecase.dart';
import '../features/device_connection/domain/usecases/stop_scan_usecase.dart';
import '../features/device_connection/presentation/providers/device_providers.dart';
import '../features/training/domain/usecases/observe_ride_sessions_usecase.dart';
import '../features/training/domain/usecases/save_ride_session_usecase.dart';
import '../features/training/presentation/providers/ride_history_providers.dart';
import '../features/wearables/data/adapters/wearable_adapter.dart';
import '../features/wearables/data/repositories/wearable_repository_impl.dart';
import '../features/wearables/domain/entities/wearable_provider_type.dart';
import '../features/wearables/domain/usecases/connect_wearable_usecase.dart';
import '../features/wearables/domain/usecases/disconnect_wearable_usecase.dart';
import '../features/wearables/domain/usecases/import_activities_usecase.dart';
import '../features/wearables/domain/usecases/observe_wearable_connections_usecase.dart';
import '../features/wearables/presentation/providers/wearable_providers.dart';
import 'fakes/demo_wearable_adapters.dart';
import 'fakes/fake_auth_repository.dart';
import 'fakes/fake_device_repository.dart';
import 'fakes/fake_ride_session_repository.dart';
import 'fakes/no_op_health_platform_gateway.dart';

/// Todos los `Override` necesarios para correr la app enteramente con
/// datos simulados — se pasan a `ProviderScope(overrides: ...)` en
/// `main_demo.dart`.
///
/// POR QUÉ HAY UN OVERRIDE POR CADA CASO DE USO (no solo por repositorio):
/// cada `xUseCaseProvider` en el código de producción está implementado
/// como `Provider((ref) => sl<XUseCase>())`, resolviendo el caso de uso
/// desde el contenedor GLOBAL de GetIt — que en modo demo nunca se
/// inicializa (no se llama a `initDependencyInjection()`, para no
/// depender de Firebase). Sobreescribir solo `xRepositoryProvider` NO
/// alcanzaría: los casos de uso seguirían intentando resolverse vía
/// `sl()`, que lanzaría una excepción de "no registrado". Por eso cada
/// caso de uso se reconstruye aquí explícitamente con el repositorio
/// falso ya inyectado en su constructor.
List<Override> buildDemoOverrides() {
  final FakeAuthRepository fakeAuth = FakeAuthRepository();
  final FakeDeviceRepository fakeDevices = FakeDeviceRepository();
  final FakeRideSessionRepository fakeRideSessions = FakeRideSessionRepository();

  // El repositorio de wearables SÍ se reutiliza tal cual de producción
  // (`WearableRepositoryImpl`) — no hace falta un "Fake" propio, porque
  // ya está diseñado para trabajar con adapters simulados (ver
  // `ARCHITECTURE_DECISIONS.md`). Para la demo, los 6 proveedores usan
  // adapters simulados — los 4 que ya lo son en producción
  // (Garmin/Polar/Coros/Suunto) más los 2 que en producción son reales
  // (Apple Health/Google Fit), sustituidos aquí por
  // `DemoAppleHealthAdapter`/`DemoGoogleFitAdapter` para no tocar
  // HealthKit/Health Connect nativos durante la demo.
  final Map<WearableProviderType, WearableAdapter> demoAdapters = <WearableProviderType, WearableAdapter>{
    WearableProviderType.appleHealth: DemoAppleHealthAdapter(),
    WearableProviderType.googleFit: DemoGoogleFitAdapter(),
  };
  final WearableRepositoryImpl demoWearables = WearableRepositoryImpl(adapters: demoAdapters);

  return <Override>[
    // --- Auth ---
    authRepositoryProvider.overrideWithValue(fakeAuth),
    loginUseCaseProvider.overrideWithValue(LoginUseCase(fakeAuth)),
    registerUseCaseProvider.overrideWithValue(RegisterUseCase(fakeAuth)),
    logoutUseCaseProvider.overrideWithValue(LogoutUseCase(fakeAuth)),
    getCurrentUserUseCaseProvider.overrideWithValue(GetCurrentUserUseCase(fakeAuth)),
    signInWithGoogleUseCaseProvider.overrideWithValue(SignInWithGoogleUseCase(fakeAuth)),
    signInWithAppleUseCaseProvider.overrideWithValue(SignInWithAppleUseCase(fakeAuth)),
    sendPasswordResetUseCaseProvider.overrideWithValue(SendPasswordResetUseCase(fakeAuth)),
    sendEmailVerificationUseCaseProvider.overrideWithValue(SendEmailVerificationUseCase(fakeAuth)),
    reloadUserUseCaseProvider.overrideWithValue(ReloadUserUseCase(fakeAuth)),
    updateProfileUseCaseProvider.overrideWithValue(UpdateProfileUseCase(fakeAuth)),

    // --- Device connection (BLE) ---
    deviceRepositoryProvider.overrideWithValue(fakeDevices),
    scanDevicesUseCaseProvider.overrideWithValue(ScanDevicesUseCase(fakeDevices)),
    stopScanUseCaseProvider.overrideWithValue(StopScanUseCase(fakeDevices)),
    connectDeviceUseCaseProvider.overrideWithValue(ConnectDeviceUseCase(fakeDevices)),
    disconnectDeviceUseCaseProvider.overrideWithValue(DisconnectDeviceUseCase(fakeDevices)),
    forgetDeviceUseCaseProvider.overrideWithValue(ForgetDeviceUseCase(fakeDevices)),
    observeConnectedDevicesUseCaseProvider.overrideWithValue(ObserveConnectedDevicesUseCase(fakeDevices)),
    observeTelemetryUseCaseProvider.overrideWithValue(ObserveTelemetryUseCase(fakeDevices)),
    requestBlePermissionsUseCaseProvider.overrideWithValue(RequestBlePermissionsUseCase(fakeDevices)),

    // --- Training (historial de sesiones) ---
    saveRideSessionUseCaseProvider.overrideWithValue(SaveRideSessionUseCase(fakeRideSessions)),
    observeRideSessionsUseCaseProvider.overrideWithValue(ObserveRideSessionsUseCase(fakeRideSessions)),

    // --- Wearables ---
    wearableRepositoryProvider.overrideWithValue(demoWearables),
    connectWearableUseCaseProvider.overrideWithValue(ConnectWearableUseCase(demoWearables)),
    disconnectWearableUseCaseProvider.overrideWithValue(DisconnectWearableUseCase(demoWearables)),
    importActivitiesUseCaseProvider.overrideWithValue(ImportActivitiesUseCase(demoWearables)),
    observeWearableConnectionsUseCaseProvider.overrideWithValue(
      ObserveWearableConnectionsUseCase(demoWearables),
    ),
    healthPlatformGatewayProvider.overrideWithValue(NoOpHealthPlatformGateway()),

    // --- Sincronización ---
    // Bypass completo de `FirestoreSyncService` (que internamente
    // necesita `FirebaseFirestore.instance`, inexistente sin
    // `Firebase.initializeApp()`) — en demo, el banner de sincronización
    // simplemente nunca aparece.
    syncStatusProvider.overrideWith((Ref ref) => Stream<SyncStatus>.value(SyncStatus.online)),
  ];
}
