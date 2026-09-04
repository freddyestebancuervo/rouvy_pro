import 'package:flutter_test/flutter_test.dart';

import 'package:rouvy_pro/features/routes_catalog/data/datasources/routes_mock_datasource.dart';
import 'package:rouvy_pro/features/routes_catalog/domain/entities/training_route.dart';

/// KORIXA-MVP-VERTICAL-SLICE-01 — pruebas del dominio de rutas
/// (Sección 14 del encargo, items 1-4): la ruta MVP local carga, su
/// distancia es válida, se resuelve por id exacto, y un id inexistente
/// falla seguro (nunca devuelve una ruta al azar ni lanza una excepción
/// no controlada).
void main() {
  group('RoutesMockDataSource', () {
    test('1. fetchAll() carga el catálogo, incluida la ruta MVP local truthful', () {
      final List<TrainingRoute> routes = RoutesMockDataSource.fetchAll();

      expect(routes, isNotEmpty);
      expect(routes.any((TrainingRoute r) => r.id == 'route-mvp-local-loop'), isTrue);
    });

    test('2. la ruta MVP local tiene distancia total > 0 y contentType honesto (staticRoute)', () {
      final TrainingRoute? mvpRoute = RoutesMockDataSource.fetchById('route-mvp-local-loop');

      expect(mvpRoute, isNotNull);
      expect(mvpRoute!.distanceMeters, greaterThan(0));
      expect(mvpRoute.contentType, RouteContentType.staticRoute);
    });

    test('2b. TODAS las rutas del catálogo tienen distancia total > 0 (invariante del progreso 0-100%)', () {
      for (final TrainingRoute route in RoutesMockDataSource.fetchAll()) {
        expect(route.distanceMeters, greaterThan(0), reason: 'route ${route.id} distanceMeters debe ser > 0');
      }
    });

    test('3. fetchById() resuelve exactamente la ruta pedida por id', () {
      final TrainingRoute? route = RoutesMockDataSource.fetchById('route-mvp-local-loop');

      expect(route, isNotNull);
      expect(route!.id, 'route-mvp-local-loop');
      expect(route.name, isNotEmpty);
    });

    test('4. fetchById() con un id inexistente devuelve null — nunca lanza, nunca inventa una ruta', () {
      final TrainingRoute? route = RoutesMockDataSource.fetchById('route-does-not-exist');

      expect(route, isNull);
    });
  });
}
