import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../app/router/app_router.dart';
import '../../../../core/widgets/async_value_view.dart';
import '../../../../l10n/generated/app_localizations.dart';
import '../../domain/entities/workout.dart';
import '../providers/workouts_providers.dart';
import '../widgets/workout_card.dart';

class WorkoutsListPage extends ConsumerWidget {
  const WorkoutsListPage({super.key});

  static const double _wideBreakpoint = 720;
  static const double _extraWideBreakpoint = 1080;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final bool mineOnly = ref.watch(workoutsMineOnlyFilterProvider);
    final AsyncValue<List<Workout>> state = ref.watch(workoutsListProvider(mineOnly));

    return Scaffold(
      appBar: AppBar(
        title: Text(l10n.workoutsTitle),
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(56),
          child: Padding(
            padding: const EdgeInsets.fromLTRB(20, 0, 20, 12),
            child: Align(
              alignment: Alignment.centerLeft,
              child: SegmentedButton<bool>(
                segments: <ButtonSegment<bool>>[
                  ButtonSegment<bool>(value: false, label: Text(l10n.workoutsAllFilterLabel)),
                  ButtonSegment<bool>(value: true, label: Text(l10n.workoutsMineFilterLabel)),
                ],
                selected: <bool>{mineOnly},
                onSelectionChanged: (Set<bool> selection) =>
                    ref.read(workoutsMineOnlyFilterProvider.notifier).state = selection.first,
              ),
            ),
          ),
        ),
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => context.push('${AppRoute.workouts}/new'),
        icon: const Icon(Icons.add),
        label: Text(l10n.newWorkoutAction),
      ),
      body: SafeArea(
        child: AsyncValueView<List<Workout>>(
          value: state,
          onRetry: () => ref.invalidate(workoutsListProvider(mineOnly)),
          isEmpty: (List<Workout> workouts) => workouts.isEmpty,
          emptyMessage: l10n.noWorkoutsAvailableMessage,
          emptyIcon: Icons.fitness_center_outlined,
          data: (BuildContext context, List<Workout> workouts) {
            return RefreshIndicator(
              onRefresh: () async => ref.invalidate(workoutsListProvider(mineOnly)),
              child: LayoutBuilder(
                builder: (BuildContext context, BoxConstraints constraints) {
                  final int crossAxisCount = constraints.maxWidth >= _extraWideBreakpoint
                      ? 3
                      : constraints.maxWidth >= _wideBreakpoint
                          ? 2
                          : 1;
                  return GridView.builder(
                    padding: const EdgeInsets.fromLTRB(20, 4, 20, 96),
                    gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
                      crossAxisCount: crossAxisCount,
                      crossAxisSpacing: 12,
                      mainAxisSpacing: 12,
                      childAspectRatio: crossAxisCount == 1 ? 2.6 : 1.5,
                    ),
                    itemCount: workouts.length,
                    itemBuilder: (BuildContext context, int index) {
                      final Workout workout = workouts[index];
                      return WorkoutCard(
                        workout: workout,
                        onTap: () => context.push('${AppRoute.workouts}/${workout.id}'),
                      );
                    },
                  );
                },
              ),
            );
          },
        ),
      ),
    );
  }
}
