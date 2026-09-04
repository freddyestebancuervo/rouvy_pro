import 'package:dartz/dartz.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:rouvy_pro/core/error/failures.dart';
import 'package:rouvy_pro/features/routes_catalog/domain/entities/training_route.dart';
import 'package:rouvy_pro/features/routes_catalog/domain/repositories/routes_repository.dart';
import 'package:rouvy_pro/features/routes_catalog/presentation/pages/route_detail_page.dart';
import 'package:rouvy_pro/features/routes_catalog/presentation/providers/routes_providers.dart';
import 'package:rouvy_pro/l10n/generated/app_localizations.dart';

class _FixedRoutesRepository implements RoutesRepository {
  _FixedRoutesRepository(this.routes);

  final List<TrainingRoute> routes;

  @override
  Future<Either<Failure, List<TrainingRoute>>> fetchCatalog() async => Right(routes);

  @override
  Future<Either<Failure, TrainingRoute>> fetchById(String routeId) async {
    final TrainingRoute? route = routes.where((TrainingRoute r) => r.id == routeId).firstOrNull;
    if (route == null) return const Left(ServerFailure('No se encontró la ruta solicitada.'));
    return Right(route);
  }
}

const TrainingRoute _runnableRoute = TrainingRoute(
  id: 'route-mvp-local-loop',
  name: 'Vuelta de prueba MVP',
  distanceMeters: 3000,
  elevationGainMeters: 0,
  difficulty: RouteDifficulty.easy,
  contentType: RouteContentType.staticRoute,
  descriptionEs: 'Descripción de prueba',
  descriptionEn: 'Test description',
);

const TrainingRoute _videoRoute = TrainingRoute(
  id: 'route-alpe-dhuez',
  name: "Alpe d'Huez",
  distanceMeters: 13800,
  elevationGainMeters: 1071,
  difficulty: RouteDifficulty.extreme,
  contentType: RouteContentType.video,
  descriptionEs: 'Descripción de prueba',
  descriptionEn: 'Test description',
);

Widget _wrap(Widget child, {required RoutesRepository repository}) {
  return ProviderScope(
    overrides: <Override>[routesRepositoryProvider.overrideWithValue(repository)],
    child: MaterialApp(
      locale: const Locale('es'),
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      supportedLocales: AppLocalizations.supportedLocales,
      home: child,
    ),
  );
}

/// KORIXA-MVP-VERTICAL-SLICE-01A — Sección 4, item D: `RouteDetailPage`
/// nunca expone una acción de inicio ACTIVA para una ruta no soportada
/// (`video`/`terrain3d`) — se reemplaza por un aviso "Próximamente", y
/// NUNCA queda un botón "Entrenar esta ruta" presionable en pantalla.
void main() {
  testWidgets('D. una ruta runnable (staticRoute) SÍ expone el botón activo de inicio', (WidgetTester tester) async {
    await tester.pumpWidget(
      _wrap(
        const RouteDetailPage(routeId: 'route-mvp-local-loop'),
        repository: _FixedRoutesRepository(const <TrainingRoute>[_runnableRoute]),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Entrenar esta ruta'), findsOneWidget);
    expect(find.text('Próximamente'), findsNothing);
  });

  testWidgets(
    'D. una ruta NO runnable (video) nunca expone el botón "Entrenar esta ruta" — se reemplaza por "Próximamente"',
    (WidgetTester tester) async {
      await tester.pumpWidget(
        _wrap(
          const RouteDetailPage(routeId: 'route-alpe-dhuez'),
          repository: _FixedRoutesRepository(const <TrainingRoute>[_videoRoute]),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('Entrenar esta ruta'), findsNothing);
      expect(find.text('Próximamente'), findsOneWidget);
    },
  );
}
