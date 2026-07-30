import 'package:dartz/dartz.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:rouvy_pro/core/error/failures.dart';
import 'package:rouvy_pro/features/routes_catalog/domain/entities/training_route.dart';
import 'package:rouvy_pro/features/routes_catalog/domain/repositories/routes_repository.dart';
import 'package:rouvy_pro/features/routes_catalog/presentation/pages/routes_catalog_page.dart';
import 'package:rouvy_pro/features/routes_catalog/presentation/providers/routes_providers.dart';
import 'package:rouvy_pro/l10n/generated/app_localizations.dart';

class _FixedRoutesRepository implements RoutesRepository {
  _FixedRoutesRepository(this.routes, {this.shouldFail = false});

  final List<TrainingRoute> routes;
  final bool shouldFail;

  @override
  Future<Either<Failure, List<TrainingRoute>>> fetchCatalog() async {
    if (shouldFail) return const Left(ServerFailure('Error simulado'));
    return Right(routes);
  }

  @override
  Future<Either<Failure, TrainingRoute>> fetchById(String routeId) async {
    final TrainingRoute route = routes.firstWhere((TrainingRoute r) => r.id == routeId);
    return Right(route);
  }
}

const TrainingRoute _sampleRoute = TrainingRoute(
  id: 'route-1',
  name: 'Ruta de prueba',
  distanceMeters: 20000,
  elevationGainMeters: 300,
  difficulty: RouteDifficulty.moderate,
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

void main() {
  testWidgets('muestra un spinner mientras carga', (WidgetTester tester) async {
    await tester.pumpWidget(
      _wrap(const RoutesCatalogPage(), repository: _FixedRoutesRepository(const <TrainingRoute>[_sampleRoute])),
    );

    expect(find.byType(CircularProgressIndicator), findsOneWidget);
  });

  testWidgets('muestra las rutas una vez cargadas', (WidgetTester tester) async {
    await tester.pumpWidget(
      _wrap(const RoutesCatalogPage(), repository: _FixedRoutesRepository(const <TrainingRoute>[_sampleRoute])),
    );
    await tester.pumpAndSettle();

    expect(find.text('Ruta de prueba'), findsOneWidget);
  });

  testWidgets('muestra el estado vacío cuando el catálogo no tiene rutas', (WidgetTester tester) async {
    await tester.pumpWidget(
      _wrap(const RoutesCatalogPage(), repository: _FixedRoutesRepository(const <TrainingRoute>[])),
    );
    await tester.pumpAndSettle();

    expect(find.byIcon(Icons.map_outlined), findsOneWidget);
  });

  testWidgets('muestra el estado de error con botón de reintentar cuando falla', (WidgetTester tester) async {
    await tester.pumpWidget(
      _wrap(
        const RoutesCatalogPage(),
        repository: _FixedRoutesRepository(const <TrainingRoute>[], shouldFail: true),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byIcon(Icons.error_outline), findsOneWidget);
    // `FilledButton.icon` ya no expone `FilledButton` como runtimeType exacto
    // desde Flutter 3.32.0 (delega en el widget interno `_FilledButtonWithIcon`,
    // que SÍ extiende `FilledButton`) — `find.byType`/`widgetWithText` comparan
    // por tipo exacto y ya no lo encuentran, por eso se usa `is FilledButton`.
    expect(
      find.ancestor(
        of: find.text('Reintentar'),
        matching: find.byWidgetPredicate((Widget widget) => widget is FilledButton),
      ),
      findsOneWidget,
    );
  });
}
