import 'package:dartz/dartz.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:rouvy_pro/core/error/failures.dart';
import 'package:rouvy_pro/features/routes_catalog/domain/entities/training_route.dart';
import 'package:rouvy_pro/features/routes_catalog/domain/repositories/routes_repository.dart';
import 'package:rouvy_pro/features/routes_catalog/presentation/providers/routes_providers.dart';
import 'package:rouvy_pro/features/training/presentation/pages/training_hud_page.dart';
import 'package:rouvy_pro/features/training/presentation/providers/ride_session_controller.dart';
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

/// KORIXA-MVP-VERTICAL-SLICE-01A — Sección 3/4, item F: un deep-link
/// DIRECTO a `/training?routeId=route-alpe-dhuez` (saltándose por
/// completo el botón deshabilitado de `RouteDetailPage`) tiene que fallar
/// seguro exactamente igual — nunca arranca `RideSessionController` con
/// una ride "solo distancia" fingiendo ser la ruta de video que el id
/// pide. No hace falta simular ningún dispositivo BLE para esta prueba:
/// si `controller.start()` nunca se llama, ninguno de los providers de
/// `device_connection` se toca en absoluto (se leen recién dentro de
/// `_subscribeToConnectedDevices`, invocado solo desde `start()`/
/// `resumeFromSnapshot()`) — así que basta con sobreescribir
/// `routesRepositoryProvider`.
void main() {
  testWidgets(
    'F. deep-link directo a una ruta existente pero no soportada (video) nunca llama a controller.start()',
    (WidgetTester tester) async {
      final ProviderContainer container = ProviderContainer(
        overrides: <Override>[
          routesRepositoryProvider.overrideWithValue(_FixedRoutesRepository(const <TrainingRoute>[_videoRoute])),
        ],
      );
      addTearDown(container.dispose);

      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: container,
          child: const MaterialApp(
            locale: Locale('es'),
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
            home: TrainingHudPage(routeId: 'route-alpe-dhuez'),
          ),
        ),
      );
      await tester.pumpAndSettle();

      // La UI muestra el aviso de "no disponible todavía"…
      expect(find.text('Ruta no disponible todavía'), findsOneWidget);
      // …y NUNCA el HUD de una sesión activa (ninguna métrica en vivo).
      expect(find.text('km/h'), findsNothing);

      // La prueba real: el controller nunca salió de `idle` — `start()`
      // jamás se llamó, así que ninguna sesión "solo distancia" arrancó
      // fingiendo ser la ruta de video pedida.
      final RideSessionState state = container.read(rideSessionControllerProvider);
      expect(state.phase, RideSessionPhase.idle);
      expect(state.isRouteBacked, isFalse);
    },
  );
}
