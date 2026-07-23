import 'package:dartz/dartz.dart';

import '../../../../core/error/error_handler.dart';
import '../../../../core/error/failures.dart';
import '../../domain/entities/workout.dart';
import '../../domain/repositories/workouts_repository.dart';
import '../datasources/workouts_remote_datasource.dart';

class WorkoutsRepositoryImpl implements WorkoutsRepository {
  WorkoutsRepositoryImpl(this._remoteDataSource);

  final WorkoutsRemoteDataSource _remoteDataSource;

  @override
  Future<Either<Failure, List<Workout>>> fetchAll({required bool mineOnly}) async {
    try {
      return Right(await _remoteDataSource.fetchAll(mineOnly: mineOnly));
    } catch (e) {
      return Left(AppErrorHandler.handle(e));
    }
  }

  @override
  Future<Either<Failure, WorkoutDetail>> fetchById(String id) async {
    try {
      return Right(await _remoteDataSource.fetchById(id));
    } catch (e) {
      return Left(AppErrorHandler.handle(e));
    }
  }

  @override
  Future<Either<Failure, WorkoutDetail>> create(CreateWorkoutParams params) async {
    try {
      return Right(await _remoteDataSource.create(params));
    } catch (e) {
      return Left(AppErrorHandler.handle(e));
    }
  }

  @override
  Future<Either<Failure, WorkoutDetail>> update(String id, UpdateWorkoutParams params) async {
    try {
      return Right(await _remoteDataSource.update(id, params));
    } catch (e) {
      return Left(AppErrorHandler.handle(e));
    }
  }

  @override
  Future<Either<Failure, void>> archive(String id) async {
    try {
      await _remoteDataSource.archive(id);
      return const Right(null);
    } catch (e) {
      return Left(AppErrorHandler.handle(e));
    }
  }
}
