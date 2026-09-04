import 'package:flutter_test/flutter_test.dart';

import 'package:rouvy_pro/features/routes_catalog/domain/entities/training_route.dart';

const TrainingRoute _staticMvpRoute = TrainingRoute(
  id: 'route-mvp-local-loop',
  name: 'Vuelta de prueba MVP',
  distanceMeters: 3000,
  elevationGainMeters: 0,
  difficulty: RouteDifficulty.easy,
  contentType: RouteContentType.staticRoute,
  descriptionEs: 'd',
  descriptionEn: 'd',
);

const TrainingRoute _videoRoute = TrainingRoute(
  id: 'route-alpe-dhuez',
  name: "Alpe d'Huez",
  distanceMeters: 13800,
  elevationGainMeters: 1071,
  difficulty: RouteDifficulty.extreme,
  contentType: RouteContentType.video,
  descriptionEs: 'd',
  descriptionEn: 'd',
);

const TrainingRoute _terrain3dRoute = TrainingRoute(
  id: 'route-flat-valley',
  name: 'Valle Llano',
  distanceMeters: 25000,
  elevationGainMeters: 120,
  difficulty: RouteDifficulty.easy,
  contentType: RouteContentType.terrain3d,
  descriptionEs: 'd',
  descriptionEn: 'd',
);

/// KORIXA-MVP-VERTICAL-SLICE-01A — Sección 4 del encargo, items A-C: el
/// predicado `isRunnable` (`RouteContentTypeCapability`/`TrainingRoute.isRunnable`)
/// es la única fuente de verdad de qué rutas son entrenables hoy.
void main() {
  group('RouteContentType.isRunnable / TrainingRoute.isRunnable', () {
    test('A. RouteContentType.staticRoute (y la ruta MVP local) es runnable', () {
      expect(RouteContentType.staticRoute.isRunnable, isTrue);
      expect(_staticMvpRoute.isRunnable, isTrue);
    });

    test('B. RouteContentType.video NO es runnable todavía (sin contenido de video real)', () {
      expect(RouteContentType.video.isRunnable, isFalse);
      expect(_videoRoute.isRunnable, isFalse);
    });

    test('C. RouteContentType.terrain3d NO es runnable todavía (sin motor 3D real)', () {
      expect(RouteContentType.terrain3d.isRunnable, isFalse);
      expect(_terrain3dRoute.isRunnable, isFalse);
    });
  });
}
