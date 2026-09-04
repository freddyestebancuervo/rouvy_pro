import 'package:dartz/dartz.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';

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

const TrainingRoute _sampleRoute = TrainingRoute(
  id: 'route-mvp-local-loop',
  name: 'Vuelta de prueba MVP',
  distanceMeters: 3000,
  elevationGainMeters: 0,
  difficulty: RouteDifficulty.easy,
  contentType: RouteContentType.staticRoute,
  descriptionEs: 'Descripción de prueba',
  descriptionEn: 'Test description',
);

/// KORIXA-MVP-VERTICAL-SLICE-01 — Sección 14, item 5: la navegación desde
/// `RouteDetailPage` lleva el `routeId` seleccionado (query param en
/// `/training`), en vez del defecto anterior (`context.push('/training')`
/// sin ningún argumento). Se prueba contra un `GoRouter` real, no contra
/// el widget aislado — es exactamente el seam que tenía el bug.
void main() {
  testWidgets(
    '5. el botón "entrenar esta ruta" navega a /training con el routeId seleccionado como query param',
    (WidgetTester tester) async {
      String? capturedRouteId;
      bool trainingPageReached = false;

      final GoRouter router = GoRouter(
        initialLocation: '/routes/route-mvp-local-loop',
        routes: <RouteBase>[
          GoRoute(
            path: '/routes/:routeId',
            builder: (BuildContext context, GoRouterState state) =>
                RouteDetailPage(routeId: state.pathParameters['routeId']!),
          ),
          GoRoute(
            path: '/training',
            builder: (BuildContext context, GoRouterState state) {
              trainingPageReached = true;
              capturedRouteId = state.uri.queryParameters['routeId'];
              return const Scaffold(body: Text('training-page-reached'));
            },
          ),
        ],
      );

      await tester.pumpWidget(
        ProviderScope(
          overrides: <Override>[
            routesRepositoryProvider.overrideWithValue(_FixedRoutesRepository(const <TrainingRoute>[_sampleRoute])),
          ],
          child: MaterialApp.router(
            routerConfig: router,
            locale: const Locale('es'),
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
          ),
        ),
      );
      await tester.pumpAndSettle();

      await tester.tap(find.text('Entrenar esta ruta'));
      await tester.pumpAndSettle();

      expect(trainingPageReached, isTrue);
      expect(capturedRouteId, 'route-mvp-local-loop');
    },
  );
}
