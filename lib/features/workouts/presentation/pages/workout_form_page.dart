import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../app/router/app_router.dart';
import '../../../../core/error/failures.dart';
import '../../../../core/widgets/app_primary_button.dart';
import '../../../../core/widgets/async_value_view.dart';
import '../../../../l10n/generated/app_localizations.dart';
import '../../domain/entities/workout.dart';
import '../../domain/repositories/workouts_repository.dart';
import '../providers/workouts_providers.dart';
import '../widgets/workout_target_type_ui.dart';

/// Una sola pantalla para crear y editar — en modo edición el backend solo
/// admite `name`/`description`/`isPublic` (`sport`/`targetType`/`intervals`
/// son inmutables, ver `UpdateWorkoutDto`), así que ambos modos comparten
/// el mismo esqueleto pero el de edición oculta/deshabilita todo lo demás
/// en vez de duplicar la pantalla entera.
class WorkoutFormPage extends ConsumerWidget {
  const WorkoutFormPage({required this.workoutId, super.key});

  /// `null` = modo creación.
  final String? workoutId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final String? id = workoutId;

    if (id == null) {
      return Scaffold(
        appBar: AppBar(title: Text(l10n.createWorkoutTitle)),
        body: const SafeArea(child: _CreateWorkoutForm()),
      );
    }

    final AsyncValue<WorkoutDetail> state = ref.watch(workoutDetailProvider(id));
    return Scaffold(
      appBar: AppBar(title: Text(l10n.editWorkoutTitle)),
      body: SafeArea(
        child: AsyncValueView<WorkoutDetail>(
          value: state,
          onRetry: () => ref.invalidate(workoutDetailProvider(id)),
          data: (BuildContext context, WorkoutDetail workout) => _EditWorkoutForm(workout: workout),
        ),
      ),
    );
  }
}

/// Fila editable de un intervalo en el formulario de creación.
class _IntervalDraft {
  _IntervalDraft()
      : durationController = TextEditingController(),
        targetLowController = TextEditingController(),
        targetHighController = TextEditingController(),
        labelController = TextEditingController();

  final TextEditingController durationController;
  final TextEditingController targetLowController;
  final TextEditingController targetHighController;
  final TextEditingController labelController;

  void dispose() {
    durationController.dispose();
    targetLowController.dispose();
    targetHighController.dispose();
    labelController.dispose();
  }
}

class _CreateWorkoutForm extends ConsumerStatefulWidget {
  const _CreateWorkoutForm();

  @override
  ConsumerState<_CreateWorkoutForm> createState() => _CreateWorkoutFormState();
}

class _CreateWorkoutFormState extends ConsumerState<_CreateWorkoutForm> {
  final _formKey = GlobalKey<FormState>();
  final _nameController = TextEditingController();
  final _descriptionController = TextEditingController();
  WorkoutTargetType _targetType = WorkoutTargetType.power;
  bool _isPublic = false;
  final List<_IntervalDraft> _intervals = <_IntervalDraft>[_IntervalDraft()];

  @override
  void dispose() {
    _nameController.dispose();
    _descriptionController.dispose();
    for (final _IntervalDraft draft in _intervals) {
      draft.dispose();
    }
    super.dispose();
  }

  void _addInterval() => setState(() => _intervals.add(_IntervalDraft()));

  void _removeInterval(int index) {
    setState(() {
      _intervals.removeAt(index).dispose();
    });
  }

  Future<void> _submit(AppLocalizations l10n) async {
    if (!_formKey.currentState!.validate()) return;
    if (_intervals.isEmpty) {
      ScaffoldMessenger.of(context)
        ..hideCurrentSnackBar()
        ..showSnackBar(SnackBar(content: Text(l10n.validationAtLeastOneInterval)));
      return;
    }

    final List<WorkoutIntervalInput> intervals = _intervals.map((_IntervalDraft draft) {
      final double? low = double.tryParse(draft.targetLowController.text.trim());
      final double? high = double.tryParse(draft.targetHighController.text.trim());
      return WorkoutIntervalInput(
        durationSeconds: int.parse(draft.durationController.text.trim()),
        targetLow: _targetType == WorkoutTargetType.none ? null : low,
        targetHigh: _targetType == WorkoutTargetType.none ? null : high,
        label: draft.labelController.text,
      );
    }).toList();

    final WorkoutDetail? created =
        await ref.read(workoutFormControllerProvider.notifier).create(
              CreateWorkoutParams(
                name: _nameController.text.trim(),
                description: _descriptionController.text,
                targetType: _targetType,
                isPublic: _isPublic,
                intervals: intervals,
              ),
            );

    if (!mounted || created == null) return;
    context.pushReplacement('${AppRoute.workouts}/${created.id}');
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final AsyncValue<void> formState = ref.watch(workoutFormControllerProvider);

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

    return Center(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 560),
        child: Form(
          key: _formKey,
          child: ListView(
            padding: const EdgeInsets.all(20),
            children: <Widget>[
              TextFormField(
                controller: _nameController,
                decoration: InputDecoration(labelText: l10n.nameLabel),
                validator: (String? value) {
                  final String trimmed = value?.trim() ?? '';
                  if (trimmed.length < 2 || trimmed.length > 150) {
                    return l10n.nameLabel;
                  }
                  return null;
                },
              ),
              const SizedBox(height: 16),
              TextFormField(
                controller: _descriptionController,
                maxLines: 3,
                decoration: InputDecoration(labelText: l10n.workoutDescriptionLabel),
              ),
              const SizedBox(height: 20),
              Text(l10n.workoutTargetTypeLabel, style: Theme.of(context).textTheme.titleSmall),
              const SizedBox(height: 8),
              SegmentedButton<WorkoutTargetType>(
                segments: WorkoutTargetType.values
                    .map(
                      (WorkoutTargetType type) =>
                          ButtonSegment<WorkoutTargetType>(value: type, label: Text(type.label(l10n))),
                    )
                    .toList(),
                selected: <WorkoutTargetType>{_targetType},
                onSelectionChanged: (Set<WorkoutTargetType> selection) =>
                    setState(() => _targetType = selection.first),
              ),
              const SizedBox(height: 12),
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                title: Text(l10n.workoutPublicSwitchLabel),
                subtitle: Text(l10n.workoutPublicSwitchHint),
                value: _isPublic,
                onChanged: (bool value) => setState(() => _isPublic = value),
              ),
              const SizedBox(height: 20),
              Row(
                children: <Widget>[
                  Expanded(
                    child: Text(l10n.workoutIntervalsTitle, style: Theme.of(context).textTheme.titleSmall),
                  ),
                  TextButton.icon(
                    onPressed: _addInterval,
                    icon: const Icon(Icons.add),
                    label: Text(l10n.addIntervalAction),
                  ),
                ],
              ),
              ...List<Widget>.generate(_intervals.length, (int index) {
                return Padding(
                  padding: const EdgeInsets.only(bottom: 12),
                  child: _IntervalForm(
                    index: index,
                    draft: _intervals[index],
                    targetType: _targetType,
                    l10n: l10n,
                    onRemove: _intervals.length > 1 ? () => _removeInterval(index) : null,
                  ),
                );
              }),
              const SizedBox(height: 12),
              AppPrimaryButton(
                label: l10n.createWorkoutButton,
                isLoading: formState.isLoading,
                onPressed: () => _submit(l10n),
              ),
              const SizedBox(height: 32),
            ],
          ),
        ),
      ),
    );
  }
}

class _IntervalForm extends StatelessWidget {
  const _IntervalForm({
    required this.index,
    required this.draft,
    required this.targetType,
    required this.l10n,
    required this.onRemove,
  });

  final int index;
  final _IntervalDraft draft;
  final WorkoutTargetType targetType;
  final AppLocalizations l10n;
  final VoidCallback? onRemove;

  @override
  Widget build(BuildContext context) {
    final (double min, double max)? range = targetType.targetRange;

    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        border: Border.all(color: Theme.of(context).colorScheme.outlineVariant),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Row(
            children: <Widget>[
              Expanded(
                child: Text(
                  l10n.intervalNumberLabel(index + 1),
                  style: Theme.of(context).textTheme.labelLarge,
                ),
              ),
              if (onRemove != null)
                IconButton(
                  icon: const Icon(Icons.close, size: 18),
                  tooltip: l10n.removeAction,
                  onPressed: onRemove,
                ),
            ],
          ),
          TextFormField(
            controller: draft.durationController,
            keyboardType: TextInputType.number,
            decoration: InputDecoration(labelText: l10n.intervalDurationLabel),
            validator: (String? value) {
              final int? seconds = int.tryParse(value?.trim() ?? '');
              if (seconds == null || seconds < 1 || seconds > 36000) {
                return l10n.validationDurationRequired;
              }
              return null;
            },
          ),
          if (range != null) ...<Widget>[
            const SizedBox(height: 8),
            Row(
              children: <Widget>[
                Expanded(
                  child: TextFormField(
                    controller: draft.targetLowController,
                    keyboardType: const TextInputType.numberWithOptions(decimal: true),
                    decoration: InputDecoration(
                      labelText: '${l10n.intervalTargetLowLabel} (${range.$1.toStringAsFixed(0)}-${range.$2.toStringAsFixed(0)})',
                    ),
                    validator: (String? value) => _validateTarget(value, range),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: TextFormField(
                    controller: draft.targetHighController,
                    keyboardType: const TextInputType.numberWithOptions(decimal: true),
                    decoration: InputDecoration(labelText: l10n.intervalTargetHighLabel),
                    validator: (String? value) {
                      final String? lowError = _validateTarget(value, range);
                      if (lowError != null) return lowError;
                      final double? low = double.tryParse(draft.targetLowController.text.trim());
                      final double? high = double.tryParse(value?.trim() ?? '');
                      if (low != null && high != null && low > high) {
                        return l10n.validationTargetRangeInvalid;
                      }
                      return null;
                    },
                  ),
                ),
              ],
            ),
          ],
          const SizedBox(height: 8),
          TextFormField(
            controller: draft.labelController,
            decoration: InputDecoration(labelText: l10n.intervalLabelLabel),
          ),
        ],
      ),
    );
  }

  String? _validateTarget(String? value, (double min, double max) range) {
    final String trimmed = value?.trim() ?? '';
    if (trimmed.isEmpty) return null; // opcional
    final double? parsed = double.tryParse(trimmed);
    if (parsed == null || parsed < range.$1 || parsed > range.$2) {
      return l10n.validationTargetRangeInvalid;
    }
    return null;
  }
}

class _EditWorkoutForm extends ConsumerStatefulWidget {
  const _EditWorkoutForm({required this.workout});

  final WorkoutDetail workout;

  @override
  ConsumerState<_EditWorkoutForm> createState() => _EditWorkoutFormState();
}

class _EditWorkoutFormState extends ConsumerState<_EditWorkoutForm> {
  final _formKey = GlobalKey<FormState>();
  late final TextEditingController _nameController;
  late final TextEditingController _descriptionController;
  late bool _isPublic;

  @override
  void initState() {
    super.initState();
    _nameController = TextEditingController(text: widget.workout.name);
    _descriptionController = TextEditingController(text: widget.workout.description ?? '');
    _isPublic = widget.workout.isPublic;
  }

  @override
  void dispose() {
    _nameController.dispose();
    _descriptionController.dispose();
    super.dispose();
  }

  Future<void> _submit(AppLocalizations l10n) async {
    if (!_formKey.currentState!.validate()) return;

    final WorkoutDetail? updated = await ref.read(workoutFormControllerProvider.notifier).updateWorkout(
          widget.workout.id,
          UpdateWorkoutParams(
            name: _nameController.text.trim(),
            description: _descriptionController.text,
            isPublic: _isPublic,
          ),
        );

    if (!mounted || updated == null) return;
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(l10n.workoutUpdatedSuccessMessage)));
    context.pop();
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final AsyncValue<void> formState = ref.watch(workoutFormControllerProvider);
    final bool editable = widget.workout.isEditable;

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

    return Center(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 560),
        child: Form(
          key: _formKey,
          child: ListView(
            padding: const EdgeInsets.all(20),
            children: <Widget>[
              if (!editable)
                Padding(
                  padding: const EdgeInsets.only(bottom: 16),
                  child: Text(
                    widget.workout.isArchived ? l10n.workoutArchivedNotice : l10n.workoutReadOnlyNotice,
                    style: TextStyle(color: Theme.of(context).colorScheme.error),
                  ),
                ),
              TextFormField(
                controller: _nameController,
                enabled: editable,
                decoration: InputDecoration(labelText: l10n.nameLabel),
                validator: (String? value) {
                  final String trimmed = value?.trim() ?? '';
                  return (trimmed.length < 2 || trimmed.length > 150) ? l10n.nameLabel : null;
                },
              ),
              const SizedBox(height: 16),
              TextFormField(
                controller: _descriptionController,
                enabled: editable,
                maxLines: 3,
                decoration: InputDecoration(labelText: l10n.workoutDescriptionLabel),
              ),
              const SizedBox(height: 12),
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                title: Text(l10n.workoutPublicSwitchLabel),
                subtitle: Text(l10n.workoutPublicSwitchHint),
                value: _isPublic,
                onChanged: editable ? (bool value) => setState(() => _isPublic = value) : null,
              ),
              const SizedBox(height: 12),
              Text(
                '${l10n.workoutTargetTypeLabel}: ${widget.workout.targetType.label(l10n)} · '
                '${l10n.workoutIntervalsCount(widget.workout.intervals.length)}',
                style: Theme.of(context)
                    .textTheme
                    .bodySmall
                    ?.copyWith(color: Theme.of(context).colorScheme.outline),
              ),
              const SizedBox(height: 24),
              if (editable)
                AppPrimaryButton(
                  label: l10n.saveChangesButton,
                  isLoading: formState.isLoading,
                  onPressed: () => _submit(l10n),
                ),
              const SizedBox(height: 32),
            ],
          ),
        ),
      ),
    );
  }
}
