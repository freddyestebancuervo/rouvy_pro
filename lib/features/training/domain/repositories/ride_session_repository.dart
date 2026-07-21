import 'package:dartz/dartz.dart';

import '../../../../core/error/failures.dart';
import '../entities/ride_session_record.dart';
import '../entities/ride_session_summary.dart';

abstract class RideSessionRepository {
  /// Persiste una sesión recién finalizada. No bloquea la navegación a la
  /// pantalla de resumen — se llama de forma asíncrona desde ahí (ver
  /// `SaveSessionController`), con la propia pantalla mostrando si el
  /// guardado tuvo éxito.
  Future<Either<Failure, void>> saveSession(RideSessionSummary summary);

  /// Historial reciente, más nuevas primero — usado por `RideHistoryPage`.
  Stream<List<RideSessionRecord>> get recentSessions;
}
