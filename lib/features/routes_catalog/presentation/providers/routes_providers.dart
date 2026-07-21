import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/di/injection.dart';
import '../../domain/entities/training_route.dart';
import '../../domain/repositories/routes_repository.dart';

final routesRepositoryProvider = Provider<RoutesRepository>((Ref ref) => sl<RoutesRepository>());

final routesCatalogProvider = FutureProvider<List<TrainingRoute>>((Ref ref) async {
  final result = await ref.watch(routesRepositoryProvider).fetchCatalog();
  return result.fold((failure) => throw failure, (routes) => routes);
});

final routeDetailProvider = FutureProvider.family<TrainingRoute, String>((Ref ref, String routeId) async {
  final result = await ref.watch(routesRepositoryProvider).fetchById(routeId);
  return result.fold((failure) => throw failure, (route) => route);
});
