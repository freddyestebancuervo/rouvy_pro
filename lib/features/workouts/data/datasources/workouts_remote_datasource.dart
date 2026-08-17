import 'package:dio/dio.dart';

import '../../../../core/error/exceptions.dart';
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

  /// T-F0.5 (docs/tasks/TF0_5_PAGINATION_CONTRACT.md) — el backend acepta
  /// hasta `MAX_LIMIT=100`; usar ese máximo minimiza el número de
  /// round-trips para recorrer la colección completa.
  static const int _pageSize = 100;

  /// Guarda defensiva contra un bug de servidor que reemitiera cursores
  /// sin fin — no es el mecanismo principal de corte (ese es
  /// `_seenCursors`, ítem J del diseño), solo evita un loop realmente
  /// infinito si esa detección fallara. Deliberadamente alto: a
  /// `_pageSize=100` esto cubriría hasta 10 millones de filas antes de
  /// activarse, muy por encima de cualquier colección real esperada, para
  /// no truncar en silencio ningún recorrido legítimo.
  static const int _maxPages = 100000;

  /// T-F0.5 — recorre TODAS las páginas de `GET /workouts` en modo
  /// paginado (`limit=100` + `cursor` opaco, contract §6.1/§9/§11) y
  /// devuelve la lista completa, preservando exactamente:
  ///
  /// - el filtro `mine` efectivo en cada request (nunca cambia a mitad
  ///   de un recorrido — un valor de filtro distinto implicaría una
  ///   travesía nueva, no continuar esta);
  /// - el orden en que el servidor entrega los items
  ///   (`created_at DESC, id DESC`) — nunca se reordena localmente;
  /// - la firma pública de este método, para que
  ///   `WorkoutsRepositoryImpl`/`workoutsListProvider`/la UI sigan
  ///   recibiendo `List<WorkoutModel>` sin saber nada de paginación.
  ///
  /// El cursor es completamente opaco para este cliente: nunca se
  /// decodifica, reconstruye ni reinterpreta — solo se copia tal cual del
  /// header `X-Next-Cursor` de una respuesta al query param `cursor` de
  /// la siguiente.
  @override
  Future<List<WorkoutModel>> fetchAll({required bool mineOnly}) async {
    // Ausente y 'false' son el mismo filtro efectivo para el backend
    // (ver equipment/workouts service) — se preserva el mismo criterio
    // que ya usaba el código legacy (nunca mandaba `mine=false`
    // explícito), así el fingerprint de filtros del servidor es
    // consistente entre esta primera página y todas las siguientes.
    final Map<String, dynamic> baseQuery = <String, dynamic>{
      'limit': _pageSize.toString(),
      if (mineOnly) 'mine': 'true',
    };

    final List<WorkoutModel> items = <WorkoutModel>[];
    final Set<String> seenIds = <String>{};
    final Set<String> seenCursors = <String>{};
    String? cursor;

    for (int page = 0; page < _maxPages; page++) {
      final Map<String, dynamic> query = <String, dynamic>{
        ...baseQuery,
        if (cursor != null) 'cursor': cursor,
      };

      final Response<dynamic> response = await _dio.get<dynamic>(
        '/workouts',
        queryParameters: query,
      );

      for (final dynamic raw in response.data as List<dynamic>) {
        final WorkoutModel model =
            WorkoutModel.fromJson(raw as Map<String, dynamic>);
        // Duplicado real de protocolo (mismo id en más de una página) —
        // nunca se resuelve en silencio (toSet()/distinct()/Map por id):
        // eso escondería un defecto real de paginación del lado del
        // servidor. Se traduce a un error acotado que la UI ya sabe
        // mostrar (mismo `ServerException` → `ServerFailure` que
        // cualquier otro fallo de backend).
        if (!seenIds.add(model.id)) {
          throw ServerException(
            'La paginación de entrenamientos devolvió el mismo elemento '
            '(${model.id}) en más de una página.',
          );
        }
        items.add(model);
      }

      // Headers HTTP son case-insensitive — `dio` normaliza el nombre
      // acá (probado explícitamente, ver
      // workouts_remote_datasource_test.dart).
      final String? nextCursor = response.headers.value('x-next-cursor');
      if (nextCursor == null || nextCursor.isEmpty) {
        return items;
      }
      // Protección principal contra loop infinito (ítem I del diseño):
      // un cursor que el servidor ya emitió antes en este mismo
      // recorrido es un error de protocolo, nunca un caso válido de
      // "seguir pidiendo páginas" — un dataset estático con un keyset
      // total y determinista (`created_at DESC, id DESC`) no puede
      // producir el mismo cursor dos veces salvo un bug real.
      if (!seenCursors.add(nextCursor)) {
        throw ServerException(
          'La paginación de entrenamientos devolvió un cursor repetido '
          '("$nextCursor") — se interrumpió el recorrido para evitar un '
          'bucle infinito.',
        );
      }
      cursor = nextCursor;
    }

    // Solo alcanzable si `_maxPages` (guarda defensiva, no el mecanismo
    // principal) se agotó sin que el servidor emitiera nunca un cursor
    // repetido ni un header ausente — indica un problema real, no debe
    // devolverse una lista parcial en silencio.
    throw const ServerException(
      'La paginación de entrenamientos superó el límite defensivo de '
      '$_maxPages páginas sin terminar.',
    );
  }

  @override
  Future<WorkoutDetailModel> fetchById(String id) async {
    final Response<dynamic> response = await _dio.get<dynamic>('/workouts/$id');
    return WorkoutDetailModel.fromJson(response.data as Map<String, dynamic>);
  }

  @override
  Future<WorkoutDetailModel> create(CreateWorkoutParams params) async {
    final Response<dynamic> response =
        await _dio.post<dynamic>('/workouts', data: params.toJson());
    return WorkoutDetailModel.fromJson(response.data as Map<String, dynamic>);
  }

  @override
  Future<WorkoutDetailModel> update(
    String id,
    UpdateWorkoutParams params,
  ) async {
    final Response<dynamic> response =
        await _dio.patch<dynamic>('/workouts/$id', data: params.toJson());
    return WorkoutDetailModel.fromJson(response.data as Map<String, dynamic>);
  }

  @override
  Future<void> archive(String id) async {
    await _dio.delete<dynamic>('/workouts/$id');
  }
}
