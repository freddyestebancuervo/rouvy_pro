import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/di/injection.dart';
import '../../data/datasources/ride_session_snapshot_local_datasource.dart';

/// Se expone como provider (en vez de que `RideSessionController` llame a
/// `sl<...>()` directamente) específicamente para poder sobreescribirlo
/// con un datasource falso en tests — ver
/// `test/features/training/presentation/providers/ride_session_controller_test.dart`,
/// que no inicializa el contenedor de DI completo y necesita este punto
/// de extensión para no reventar al llamar a `start()`/`finish()`.
final rideSessionSnapshotDataSourceProvider =
    Provider<RideSessionSnapshotLocalDataSource>((Ref ref) => sl<RideSessionSnapshotLocalDataSource>());
