import 'package:dartz/dartz.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:rouvy_pro/core/error/failures.dart';
import 'package:rouvy_pro/features/workouts/domain/entities/workout.dart';
import 'package:rouvy_pro/features/workouts/domain/repositories/workouts_repository.dart';
import 'package:rouvy_pro/features/workouts/presentation/pages/workouts_list_page.dart';
import 'package:rouvy_pro/features/workouts/presentation/providers/workouts_providers.dart';
import 'package:rouvy_pro/l10n/generated/app_localizations.dart';

class _FixedWorkoutsRepository implements WorkoutsRepository {
  _FixedWorkoutsRepository(this.workouts, {this.shouldFail = false});

  final List<Workout> workouts;
  final bool shouldFail;

  @override
  Future<Either<Failure, List<Workout>>> fetchAll({required bool mineOnly}) async {
    if (shouldFail) return const Left(ServerFailure('Error simulado'));
    final List<Workout> filtered = mineOnly ? workouts.where((Workout w) => w.isMine).toList() : workouts;
    return Right(filtered);
  }

  @override
  Future<Either<Failure, WorkoutDetail>> fetchById(String id) async {
    throw UnimplementedError();
  }

  @override
  Future<Either<Failure, WorkoutDetail>> create(CreateWorkoutParams params) async {
    throw UnimplementedError();
  }

  @override
  Future<Either<Failure, WorkoutDetail>> update(String id, UpdateWorkoutParams params) async {
    throw UnimplementedError();
  }

  @override
  Future<Either<Failure, void>> archive(String id) async {
    throw UnimplementedError();
  }
}

Workout _sampleWorkout({required String id, required bool isMine}) {
  final DateTime now = DateTime(2026, 1, 10);
  return Workout(
    id: id,
    name: 'Series de umbral',
    description: null,
    sport: 'cycling',
    estimatedDurationSeconds: 1800,
    targetType: WorkoutTargetType.power,
    isPublic: false,
    isMine: isMine,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
  );
}

Widget _wrap(Widget child, {required WorkoutsRepository repository}) {
  return ProviderScope(
    overrides: <Override>[workoutsRepositoryProvider.overrideWithValue(repository)],
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
      _wrap(
        const WorkoutsListPage(),
        repository: _FixedWorkoutsRepository(<Workout>[_sampleWorkout(id: 'w1', isMine: true)]),
      ),
    );

    expect(find.byType(CircularProgressIndicator), findsOneWidget);
  });

  testWidgets('muestra los entrenamientos una vez cargados', (WidgetTester tester) async {
    await tester.pumpWidget(
      _wrap(
        const WorkoutsListPage(),
        repository: _FixedWorkoutsRepository(<Workout>[_sampleWorkout(id: 'w1', isMine: true)]),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Series de umbral'), findsOneWidget);
  });

  testWidgets('muestra el estado vacío cuando no hay entrenamientos', (WidgetTester tester) async {
    await tester.pumpWidget(
      _wrap(const WorkoutsListPage(), repository: _FixedWorkoutsRepository(<Workout>[])),
    );
    await tester.pumpAndSettle();

    expect(find.byIcon(Icons.fitness_center_outlined), findsOneWidget);
  });

  testWidgets('muestra el estado de error con botón de reintentar cuando falla', (WidgetTester tester) async {
    await tester.pumpWidget(
      _wrap(
        const WorkoutsListPage(),
        repository: _FixedWorkoutsRepository(<Workout>[], shouldFail: true),
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

  testWidgets('el filtro "Míos" oculta los entrenamientos que no son propios', (WidgetTester tester) async {
    await tester.pumpWidget(
      _wrap(
        const WorkoutsListPage(),
        repository: _FixedWorkoutsRepository(<Workout>[
          _sampleWorkout(id: 'mine', isMine: true),
          _sampleWorkout(id: 'catalog', isMine: false),
        ]),
      ),
    );
    await tester.pumpAndSettle();

    // Con el filtro por defecto ("Todos") deben verse ambas tarjetas.
    expect(find.text('Series de umbral'), findsNWidgets(2));

    await tester.tap(find.text('Míos'));
    await tester.pumpAndSettle();

    // Tras filtrar por "Míos", solo el propio queda visible.
    expect(find.text('Series de umbral'), findsOneWidget);
  });
}
