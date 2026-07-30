import 'package:dio/dio.dart';

import '../../domain/repositories/workouts_repository.dart';
import '../models/workout_model.dart';

/// Única capa que sabe que Workouts vive en el backend NestJS propio (vs.
/// Firestore, que usan otros features) — si el transporte cambiara, solo
/// esta implementación se toca.
abstract class WorkoutsRemoteDataSource {
  Future<List<WorkoutModel>> fetchAll({required bool mineOnly});

  Future<WorkoutDetailModel> fetchById(String id);

  Future<WorkoutDetailModel> create(CreateWorkoutParams params);

  Future<WorkoutDetailModel> update(String id, UpdateWorkoutParams params);

  Future<void> archive(String id);
}

class WorkoutsRemoteDataSourceImpl implements WorkoutsRemoteDataSource {
  WorkoutsRemoteDataSourceImpl(this._dio);

  /// Ya viene con el interceptor de auth del backend adjunto (ver
  /// `core/network/backend_dio_client.dart`) — este datasource no sabe
  /// nada de tokens.
  final Dio _dio;

  @override
  Future<List<WorkoutModel>> fetchAll({required bool mineOnly}) async {
    final Response<dynamic> response = await _dio.get<dynamic>(
      '/workouts',
      queryParameters: mineOnly ? <String, dynamic>{'mine': 'true'} : null,
    );
    return (response.data as List<dynamic>)
        .map((dynamic e) => WorkoutModel.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  @override
  Future<WorkoutDetailModel> fetchById(String id) async {
    final Response<dynamic> response = await _dio.get<dynamic>('/workouts/$id');
    return WorkoutDetailModel.fromJson(response.data as Map<String, dynamic>);
  }

  @override
  Future<WorkoutDetailModel> create(CreateWorkoutParams params) async {
    final Response<dynamic> response = await _dio.post<dynamic>('/workouts', data: params.toJson());
    return WorkoutDetailModel.fromJson(response.data as Map<String, dynamic>);
  }

  @override
  Future<WorkoutDetailModel> update(String id, UpdateWorkoutParams params) async {
    final Response<dynamic> response = await _dio.patch<dynamic>('/workouts/$id', data: params.toJson());
    return WorkoutDetailModel.fromJson(response.data as Map<String, dynamic>);
  }

  @override
  Future<void> archive(String id) async {
    await _dio.delete<dynamic>('/workouts/$id');
  }
}
