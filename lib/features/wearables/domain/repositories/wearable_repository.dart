import 'package:dartz/dartz.dart';

import '../../../../core/error/failures.dart';
import '../entities/external_activity.dart';
import '../entities/wearable_connection.dart';
import '../entities/wearable_provider_type.dart';

/// Puerto único de todo el módulo de wearables. La capa `presentation`
/// nunca sabe si detrás de `connect(WearableProviderType.garmin)` hay una
/// llamada real a la API de Garmin o un adapter simulado — esa decisión
/// vive enteramente en `WearableRepositoryImpl` (ver `ARCHITECTURE_DECISIONS.md`).
abstract class WearableRepository {
  Future<Either<Failure, void>> connect(WearableProviderType provider);

  Future<Either<Failure, void>> disconnect(WearableProviderType provider);

  Future<Either<Failure, List<ExternalActivity>>> importActivities(
    WearableProviderType provider, {
    DateTime? since,
  });

  /// Estado combinado de los 6 proveedores — alimenta la pantalla de
  /// gestión de wearables completa de una sola vez.
  Stream<List<WearableConnection>> get connectionsStream;
}
