import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/di/injection.dart';
import '../../../../core/health/health_platform_gateway.dart';
import '../../domain/entities/wearable_connection.dart';
import '../../domain/repositories/wearable_repository.dart';
import '../../domain/usecases/connect_wearable_usecase.dart';
import '../../domain/usecases/disconnect_wearable_usecase.dart';
import '../../domain/usecases/import_activities_usecase.dart';
import '../../domain/usecases/observe_wearable_connections_usecase.dart';

final wearableRepositoryProvider = Provider<WearableRepository>((Ref ref) => sl<WearableRepository>());

/// Se expone directamente (en vez de un caso de uso dedicado) porque
/// "abrir los ajustes del sistema" no es una regla de negocio — es una
/// acción de plataforma sin lógica que orquestar, mismo criterio ya usado
/// en `BlePermissionController.openSettings()`.
final healthPlatformGatewayProvider = Provider<HealthPlatformGateway>((Ref ref) => sl<HealthPlatformGateway>());

final connectWearableUseCaseProvider =
    Provider<ConnectWearableUseCase>((Ref ref) => sl<ConnectWearableUseCase>());
final disconnectWearableUseCaseProvider =
    Provider<DisconnectWearableUseCase>((Ref ref) => sl<DisconnectWearableUseCase>());
final importActivitiesUseCaseProvider =
    Provider<ImportActivitiesUseCase>((Ref ref) => sl<ImportActivitiesUseCase>());
final observeWearableConnectionsUseCaseProvider =
    Provider<ObserveWearableConnectionsUseCase>((Ref ref) => sl<ObserveWearableConnectionsUseCase>());

/// Estado combinado de los 6 proveedores — alimenta `WearablesPage`.
final wearableConnectionsProvider = StreamProvider<List<WearableConnection>>((Ref ref) {
  return ref.watch(observeWearableConnectionsUseCaseProvider)();
});
