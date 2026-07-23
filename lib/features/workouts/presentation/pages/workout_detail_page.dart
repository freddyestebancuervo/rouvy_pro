import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../core/error/failures.dart';
import '../../../../core/widgets/async_value_view.dart';
import '../../../../l10n/generated/app_localizations.dart';
import '../../domain/entities/workout.dart';
import '../providers/workouts_providers.dart';
import '../widgets/workout_target_type_ui.dart';

class WorkoutDetailPage extends ConsumerWidget {
  const WorkoutDetailPage({required this.workoutId, super.key});

  final String workoutId;

  Future<void> _confirmArchive(BuildContext context, WidgetRef ref, AppLocalizations l10n) async {
    final bool? confirmed = await showDialog<bool>(
      context: context,
      builder: (BuildContext dialogContext) => AlertDialog(
        title: Text(l10n.archiveWorkoutConfirmTitle),
        content: Text(l10n.archiveWorkoutConfirmMessage),
        actions: <Widget>[
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: Text(l10n.cancelAction),
          ),
          FilledButton(
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: Text(l10n.confirmAction),
          ),
        ],
      ),
    );
    if (confirmed != true) return;

    final bool success = await ref.read(workoutFormControllerProvider.notifier).archive(workoutId);
    if (!context.mounted) return;
    if (success) {
      ScaffoldMessenger.of(context)
        ..hideCurrentSnackBar()
        ..showSnackBar(SnackBar(content: Text(l10n.workoutArchivedSuccessMessage)));
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final AsyncValue<WorkoutDetail> state = ref.watch(workoutDetailProvider(workoutId));

    ref.listen<AsyncValue<void>>(workoutFormControllerProvider, (
      AsyncValue<void>? previous,
      AsyncValue<void> next,
    ) {
      if (next.hasError && !next.isLoading) {
        final Object error = next.error!;
        final String message = error is Failure ? error.message : l10n.genericErrorMessage;
        ScaffoldMessenger.of(context)
          ..hideCurrentSnackBar()
          ..showSnackBar(SnackBar(content: Text(message)));
      }
    });

    return Scaffold(
      appBar: AppBar(
        title: Text(l10n.workoutDetailTitle),
        actions: <Widget>[
          if (state.valueOrNull?.isEditable ?? false) ...<Widget>[
            IconButton(
              icon: const Icon(Icons.edit_outlined),
              tooltip: l10n.editWorkoutTitle,
              onPressed: () => context.push('/workouts/$workoutId/edit'),
            ),
            IconButton(
              icon: const Icon(Icons.archive_outlined),
              tooltip: l10n.archiveWorkoutAction,
              onPressed: () => _confirmArchive(context, ref, l10n),
            ),
          ],
        ],
      ),
      body: SafeArea(
        child: AsyncValueView<WorkoutDetail>(
          value: state,
          onRetry: () => ref.invalidate(workoutDetailProvider(workoutId)),
          data: (BuildContext context, WorkoutDetail workout) => _WorkoutDetailBody(workout: workout),
        ),
      ),
    );
  }
}

class _WorkoutDetailBody extends StatelessWidget {
  const _WorkoutDetailBody({required this.workout});

  final WorkoutDetail workout;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final ColorScheme scheme = Theme.of(context).colorScheme;

    return Center(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 560),
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              if (!workout.isMine)
                _Notice(icon: Icons.visibility_outlined, message: l10n.workoutReadOnlyNotice)
              else if (workout.isArchived)
                _Notice(icon: Icons.archive_outlined, message: l10n.workoutArchivedNotice),
              Text(workout.name, style: Theme.of(context).textTheme.headlineSmall),
              if (workout.description != null && workout.description!.isNotEmpty) ...<Widget>[
                const SizedBox(height: 6),
                Text(workout.description!, style: Theme.of(context).textTheme.bodyMedium),
              ],
              const SizedBox(height: 16),
              Row(
                children: <Widget>[
                  _StatChip(
                    icon: Icons.timer_outlined,
                    label: formatWorkoutDuration(workout.estimatedDurationSeconds),
                  ),
                  const SizedBox(width: 10),
                  _StatChip(icon: workout.targetType.icon, label: workout.targetType.label(l10n)),
                  const SizedBox(width: 10),
                  _StatChip(
                    icon: workout.isPublic ? Icons.public : Icons.lock_outline,
                    label: workout.isMine
                        ? (workout.isPublic ? l10n.workoutPublicLabel : l10n.workoutPrivateLabel)
                        : l10n.workoutCatalogLabel,
                  ),
                ],
              ),
              const SizedBox(height: 28),
              Text(
                '${l10n.workoutIntervalsTitle} · ${l10n.workoutIntervalsCount(workout.intervals.length)}',
                style: Theme.of(context).textTheme.titleMedium,
              ),
              const SizedBox(height: 12),
              ...workout.intervals.map(
                (WorkoutInterval interval) => Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: _IntervalTile(interval: interval, targetType: workout.targetType),
                ),
              ),
              const SizedBox(height: 8),
              _IntervalBarChart(intervals: workout.intervals, color: scheme.primary),
            ],
          ),
        ),
      ),
    );
  }
}

class _Notice extends StatelessWidget {
  const _Notice({required this.icon, required this.message});

  final IconData icon;
  final String message;

  @override
  Widget build(BuildContext context) {
    final ColorScheme scheme = Theme.of(context).colorScheme;
    return Container(
      margin: const EdgeInsets.only(bottom: 16),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: scheme.secondaryContainer.withValues(alpha: 0.5),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Row(
        children: <Widget>[
          Icon(icon, size: 18, color: scheme.onSecondaryContainer),
          const SizedBox(width: 8),
          Expanded(child: Text(message, style: Theme.of(context).textTheme.bodySmall)),
        ],
      ),
    );
  }
}

class _StatChip extends StatelessWidget {
  const _StatChip({required this.icon, required this.label});

  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 10),
        decoration: BoxDecoration(
          color: Theme.of(context).colorScheme.surfaceContainerHighest,
          borderRadius: BorderRadius.circular(10),
        ),
        child: Column(
          children: <Widget>[
            Icon(icon, size: 18, color: Theme.of(context).colorScheme.primary),
            const SizedBox(height: 4),
            Text(label, style: Theme.of(context).textTheme.labelSmall, textAlign: TextAlign.center),
          ],
        ),
      ),
    );
  }
}

class _IntervalTile extends StatelessWidget {
  const _IntervalTile({required this.interval, required this.targetType});

  final WorkoutInterval interval;
  final WorkoutTargetType targetType;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final String? unit = targetType.unit;
    final String? target = (interval.targetLow != null || interval.targetHigh != null) && unit != null
        ? '${interval.targetLow?.toStringAsFixed(0) ?? '—'}-${interval.targetHigh?.toStringAsFixed(0) ?? '—'} $unit'
        : null;

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      decoration: BoxDecoration(
        border: Border.all(color: Theme.of(context).colorScheme.outlineVariant),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Row(
        children: <Widget>[
          CircleAvatar(
            radius: 14,
            child: Text('${interval.position + 1}', style: Theme.of(context).textTheme.labelSmall),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(
                  interval.label?.isNotEmpty == true
                      ? interval.label!
                      : l10n.intervalNumberLabel(interval.position + 1),
                  style: Theme.of(context).textTheme.bodyMedium,
                ),
                Text(
                  formatWorkoutDuration(interval.durationSeconds),
                  style: Theme.of(context)
                      .textTheme
                      .bodySmall
                      ?.copyWith(color: Theme.of(context).colorScheme.outline),
                ),
              ],
            ),
          ),
          if (target != null) Text(target, style: Theme.of(context).textTheme.bodySmall),
        ],
      ),
    );
  }
}

/// Barra horizontal proporcional a la duración de cada intervalo — da una
/// idea visual instantánea de la estructura del entrenamiento (calentar /
/// esfuerzo / recuperar) sin tener que leer cada fila una por una.
class _IntervalBarChart extends StatelessWidget {
  const _IntervalBarChart({required this.intervals, required this.color});

  final List<WorkoutInterval> intervals;
  final Color color;

  @override
  Widget build(BuildContext context) {
    if (intervals.isEmpty) return const SizedBox.shrink();
    final int total = intervals.fold(0, (int sum, WorkoutInterval i) => sum + i.durationSeconds);
    if (total <= 0) return const SizedBox.shrink();

    return ClipRRect(
      borderRadius: BorderRadius.circular(8),
      child: SizedBox(
        height: 28,
        child: Row(
          children: intervals.asMap().entries.map((MapEntry<int, WorkoutInterval> entry) {
            final bool isOdd = entry.key.isOdd;
            return Expanded(
              flex: entry.value.durationSeconds,
              child: Container(color: color.withValues(alpha: isOdd ? 0.35 : 0.7)),
            );
          }).toList(),
        ),
      ),
    );
  }
}
