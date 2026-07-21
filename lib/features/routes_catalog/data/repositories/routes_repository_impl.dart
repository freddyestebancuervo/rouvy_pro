import 'package:dartz/dartz.dart';

import '../../../../core/error/failures.dart';
import '../../domain/entities/training_route.dart';
import '../../domain/repositories/routes_repository.dart';
import '../datasources/routes_mock_datasource.dart';

class RoutesRepositoryImpl implements RoutesRepository {
  @override
  Future<Either<Failure, List<TrainingRoute>>> fetchCatalog() async {
    // `Future.delayed` simula la latencia de una consulta real — sin
    // esto, la pantalla nunca mostraría su estado de carga durante el
    // desarrollo, y ese estado (punto 12 del encargo) quedaría sin probar
    // hasta tener un backend real.
    await Future<void>.delayed(const Duration(milliseconds: 500));
    return Right(RoutesMockDataSource.fetchAll());
  }

  @override
  Future<Either<Failure, TrainingRoute>> fetchById(String routeId) async {
    await Future<void>.delayed(const Duration(milliseconds: 300));
    final TrainingRoute? route = RoutesMockDataSource.fetchById(routeId);
    if (route == null) {
      return const Left(ServerFailure('No se encontró la ruta solicitada.'));
    }
    return Right(route);
  }
}
