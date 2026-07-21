import 'dart:async';

import 'package:dartz/dartz.dart';

import '../../../../core/error/error_handler.dart';
import '../../../../core/error/failures.dart';
import '../../domain/entities/external_activity.dart';
import '../../domain/entities/wearable_connection.dart';
import '../../domain/entities/wearable_connection_status.dart';
import '../../domain/entities/wearable_provider_type.dart';
import '../../domain/repositories/wearable_repository.dart';
import '../adapters/health_package_adapter.dart';
import '../adapters/wearable_adapter.dart';

/// Única pieza del proyecto que conoce la lista completa de adapters.
/// Recibe el `Map` ya construido por inyección de dependencias — así
/// activar un adapter real en el futuro (p. ej. `GarminAdapter` real en
/// vez de `MockWearableAdapter`) es un cambio de UNA línea en
/// `core/di/injection.dart`, no aquí.
class WearableRepositoryImpl implements WearableRepository {
  WearableRepositoryImpl({required Map<WearableProviderType, WearableAdapter> adapters})
      : _adapters = adapters {
    _connections = <WearableProviderType, WearableConnection>{
      for (final WearableProviderType type in _adapters.keys)
        type: WearableConnection(
          provider: type,
          status: _adapters[type]!.requiresPartnerApproval
              ? WearableConnectionStatus.pendingPartnerApproval
              : WearableConnectionStatus.notConnected,
        ),
    };
  }

  final Map<WearableProviderType, WearableAdapter> _adapters;
  late final Map<WearableProviderType, WearableConnection> _connections;

  final StreamController<List<WearableConnection>> _controller =
      StreamController<List<WearableConnection>>.broadcast();

  @override
  Future<Either<Failure, void>> connect(WearableProviderType provider) async {
    final WearableAdapter? adapter = _adapters[provider];
    if (adapter == null) return const Left(UnexpectedFailure('Proveedor no soportado.'));

    _updateStatus(provider, WearableConnectionStatus.connecting);
    try {
      await adapter.connect();
      // Los adapters simulados quedan en `pendingPartnerApproval` incluso
      // tras "conectar" — es una decisión deliberada (ver
      // `MockWearableAdapter`): la UI debe seguir dejando claro que es una
      // simulación, no ocultarlo una vez que el usuario pulsa conectar.
      final WearableConnectionStatus newStatus = adapter.requiresPartnerApproval
          ? WearableConnectionStatus.pendingPartnerApproval
          : WearableConnectionStatus.connected;
      _updateStatus(provider, newStatus, lastSyncAt: DateTime.now());
      return const Right(null);
    } catch (e) {
      _updateStatus(provider, WearableConnectionStatus.error, errorMessage: AppErrorHandler.handle(e).message);
      return Left(AppErrorHandler.handle(e));
    }
  }

  @override
  Future<Either<Failure, void>> disconnect(WearableProviderType provider) async {
    final WearableAdapter? adapter = _adapters[provider];
    if (adapter == null) return const Left(UnexpectedFailure('Proveedor no soportado.'));

    try {
      await adapter.disconnect();
      final WearableConnectionStatus resetStatus = adapter.requiresPartnerApproval
          ? WearableConnectionStatus.pendingPartnerApproval
          : WearableConnectionStatus.notConnected;
      _updateStatus(provider, resetStatus);
      return const Right(null);
    } catch (e) {
      return Left(AppErrorHandler.handle(e));
    }
  }

  @override
  Future<Either<Failure, List<ExternalActivity>>> importActivities(
    WearableProviderType provider, {
    DateTime? since,
  }) async {
    final WearableAdapter? adapter = _adapters[provider];
    if (adapter == null) return const Left(UnexpectedFailure('Proveedor no soportado.'));

    _updateStatus(provider, WearableConnectionStatus.syncing);
    try {
      final List<ExternalActivity> activities = await adapter.fetchActivities(since: since);
      final WearableConnectionStatus restoredStatus = adapter.requiresPartnerApproval
          ? WearableConnectionStatus.pendingPartnerApproval
          : WearableConnectionStatus.connected;

      // Tarea B3: solo `HealthPackageAdapter` lleva el contador de
      // fetches vacíos consecutivos (es específico de la ambigüedad de
      // permisos de HealthKit en iOS) — el resto de adapters no
      // implementa esto, por eso el chequeo de tipo en vez de añadirlo a
      // la interfaz `WearableAdapter` entera.
      final String? advisory = adapter is HealthPackageAdapter ? adapter.emptyFetchesHintMessage : null;

      _updateStatus(provider, restoredStatus, lastSyncAt: DateTime.now(), advisoryMessage: advisory);
      return Right(activities);
    } catch (e) {
      _updateStatus(provider, WearableConnectionStatus.error, errorMessage: AppErrorHandler.handle(e).message);
      return Left(AppErrorHandler.handle(e));
    }
  }

  @override
  Stream<List<WearableConnection>> get connectionsStream {
    // `Stream.multi` entrega el snapshot actual a CADA nuevo suscriptor de
    // inmediato (algo que un `StreamController.broadcast` simple no hace:
    // un listener que se suscribe después de la primera actualización se
    // quedaría sin estado inicial hasta el próximo cambio). Se evita traer
    // `rxdart` solo por este `BehaviorSubject`-like, ya que `Stream.multi`
    // (SDK estándar) cubre el caso exacto que se necesita aquí.
    return Stream<List<WearableConnection>>.multi((StreamController<List<WearableConnection>> controller) {
      controller.add(_connections.values.toList(growable: false));
      final StreamSubscription<List<WearableConnection>> sub = _controller.stream.listen(controller.add);
      controller.onCancel = sub.cancel;
    });
  }

  void _updateStatus(
    WearableProviderType provider,
    WearableConnectionStatus status, {
    DateTime? lastSyncAt,
    String? errorMessage,
    String? advisoryMessage,
  }) {
    final WearableConnection current = _connections[provider]!;
    _connections[provider] = current.copyWith(
      status: status,
      lastSyncAt: lastSyncAt,
      errorMessage: errorMessage,
      advisoryMessage: advisoryMessage,
    );
    _controller.add(_connections.values.toList(growable: false));
  }
}
