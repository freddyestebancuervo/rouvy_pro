import 'package:dartz/dartz.dart';

import '../../../../core/error/error_handler.dart';
import '../../../../core/error/failures.dart';
import '../../domain/entities/ride_session_record.dart';
import '../../domain/entities/ride_session_summary.dart';
import '../../domain/repositories/ride_session_repository.dart';
import '../datasources/ride_session_remote_datasource.dart';
import '../models/ride_session_record_model.dart';

class RideSessionRepositoryImpl implements RideSessionRepository {
  RideSessionRepositoryImpl({required RideSessionRemoteDataSource remoteDataSource})
      : _remoteDataSource = remoteDataSource;

  final RideSessionRemoteDataSource _remoteDataSource;

  @override
  Future<Either<Failure, void>> saveSession(RideSessionSummary summary) async {
    try {
      final RideSessionRecordModel record = RideSessionRecordModel.fromSummary(summary);
      await _remoteDataSource.saveSession(record);
      return const Right(null);
    } catch (e) {
      return Left(AppErrorHandler.handle(e));
    }
  }

  @override
  Stream<List<RideSessionRecord>> get recentSessions => _remoteDataSource.recentSessions;
}
