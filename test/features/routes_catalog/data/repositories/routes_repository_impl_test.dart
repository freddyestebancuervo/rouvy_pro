import 'package:flutter_test/flutter_test.dart';

import 'package:rouvy_pro/core/error/failures.dart';
import 'package:rouvy_pro/features/routes_catalog/data/repositories/routes_repository_impl.dart';
import 'package:rouvy_pro/features/routes_catalog/domain/entities/training_route.dart';

/// KORIXA-MVP-VERTICAL-SLICE-01 — nivel `Either<Failure, T>`, el que
/// realmente consume `TrainingHudPage._resolveRouteThenStart()` para
/// decidir si arrancar la sesión o mostrar el estado fail-safe.
void main() {
  group('RoutesRepositoryImpl.fetchById', () {
    test('3. resuelve Right(route) para un id existente', () async {
      final RoutesRepositoryImpl repo = RoutesRepositoryImpl();

      final result = await repo.fetchById('route-mvp-local-loop');

      expect(result.isRight(), isTrue);
      result.fold(
        (_) => fail('no debería fallar para un id existente'),
        (TrainingRoute route) => expect(route.id, 'route-mvp-local-loop'),
      );
    });

    test('4. resuelve Left(Failure) para un id inexistente — fail-safe, nunca Right con datos inventados', () async {
      final RoutesRepositoryImpl repo = RoutesRepositoryImpl();

      final result = await repo.fetchById('route-does-not-exist');

      expect(result.isLeft(), isTrue);
      result.fold(
        (Failure failure) => expect(failure, isA<Failure>()),
        (_) => fail('un id inexistente nunca debe resolver Right'),
      );
    });
  });
}
