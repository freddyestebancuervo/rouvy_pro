import 'package:dartz/dartz.dart';

import '../../../../core/error/failures.dart';
import '../entities/training_route.dart';

abstract class RoutesRepository {
  Future<Either<Failure, List<TrainingRoute>>> fetchCatalog();

  Future<Either<Failure, TrainingRoute>> fetchById(String routeId);
}
