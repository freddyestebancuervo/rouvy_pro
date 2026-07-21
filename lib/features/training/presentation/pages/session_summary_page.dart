import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../app/router/app_router.dart';
import '../../../../core/utils/duration_formatter.dart';
import '../../../../l10n/generated/app_localizations.dart';
import '../../domain/entities/ride_session_summary.dart';
import '../providers/ride_history_providers.dart';
import '../providers/ride_session_controller.dart';

class SessionSummaryPage extends ConsumerStatefulWidget {
  const SessionSummaryPage({super.key});

  @override
  ConsumerState<SessionSummaryPage> createState() => _SessionSummaryPageState();
}

class _SessionSummaryPageState extends ConsumerState<SessionSummaryPage> {
  @override
  void initState() {
    super.initState();
    final RideSessionSummary? summary = ref.read(rideSessionControllerProvider).summary;
    if (summary != null) {
      // Se guarda en background apenas se muestra el resumen — el usuario
      // ya está viendo sus datos desde la memoria del controller, no hace
      // falta esperar a Firestore para eso; el guardado es complementario.
      WidgetsBinding.instance.addPostFrameCallback((_) {
        ref.read(saveSessionControllerProvider.notifier).save(summary);
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final RideSessionSummary? summary = ref.watch(rideSessionControllerProvider).summary;
    final AsyncValue<void> saveState = ref.watch(saveSessionControllerProvider);

    // Si por algún motivo se llega aquí sin una sesión finalizada (p. ej.
    // el usuario refrescó en Web), se vuelve a Home en vez de mostrar una
    // pantalla vacía o un error — degradación segura, no un crash.
    if (summary == null) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (context.mounted) context.go(AppRoute.home);
      });
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }

    final telemetry = summary.finalTelemetry;

    return Scaffold(
      appBar: AppBar(
        title: Text(l10n.sessionSummaryTitle),
        automaticallyImplyLeading: false,
        actions: <Widget>[
          Padding(
            padding: const EdgeInsets.only(right: 16),
            child: Center(child: _SaveStatusIndicator(state: saveState)),
          ),
        ],
      ),
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 480),
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(24),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: <Widget>[
                  Icon(Icons.emoji_events_outlined, size: 56, color: Theme.of(context).colorScheme.primary),
                  const SizedBox(height: 12),
                  Text(
                    l10n.sessionSummarySubtitle,
                    textAlign: TextAlign.center,
                    style: Theme.of(context).textTheme.headlineSmall,
                  ),
                  const SizedBox(height: 24),
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.all(20),
                      child: Row(
                        mainAxisAlignment: MainAxisAlignment.spaceAround,
                        children: <Widget>[
                          _SummaryStat(
                            label: l10n.metricTimeLabel,
                            value: DurationFormatter.format(summary.duration),
                          ),
                          _SummaryStat(
                            label: l10n.metricDistanceLabel,
                            value: '${(telemetry.distanceMeters / 1000).toStringAsFixed(2)} km',
                          ),
                          _SummaryStat(
                            label: l10n.metricCaloriesLabel,
                            value: '${telemetry.caloriesKcal.round()} kcal',
                          ),
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(height: 20),
                  if (summary.connectedDeviceCount > 0) ...<Widget>[
                    Text(l10n.lastReadingsLabel, style: Theme.of(context).textTheme.titleSmall),
                    const SizedBox(height: 8),
                    Card(
                      child: Padding(
                        padding: const EdgeInsets.all(16),
                        child: Wrap(
                          spacing: 24,
                          runSpacing: 12,
                          children: <Widget>[
                            _MiniStat(label: l10n.metricPowerLabel, value: '${telemetry.powerWatts} W'),
                            _MiniStat(label: l10n.metricCadenceLabel, value: '${telemetry.cadenceRpm} rpm'),
                            if (telemetry.heartRateBpm != null)
                              _MiniStat(label: l10n.metricHeartRateLabel, value: '${telemetry.heartRateBpm} bpm'),
                          ],
                        ),
                      ),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      l10n.devicesUsedLabel(summary.connectedDeviceCount),
                      style: Theme.of(context)
                          .textTheme
                          .bodySmall
                          ?.copyWith(color: Theme.of(context).colorScheme.outline),
                    ),
                  ] else
                    Text(
                      l10n.noReadingsMessage,
                      textAlign: TextAlign.center,
                      style: Theme.of(context)
                          .textTheme
                          .bodyMedium
                          ?.copyWith(color: Theme.of(context).colorScheme.outline),
                    ),
                  const SizedBox(height: 32),
                  ElevatedButton(
                    onPressed: () {
                      ref.read(rideSessionControllerProvider.notifier).reset();
                      context.go(AppRoute.home);
                    },
                    child: Text(l10n.backToHomeAction),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _SummaryStat extends StatelessWidget {
  const _SummaryStat({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: <Widget>[
        Text(value, style: Theme.of(context).textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w700)),
        const SizedBox(height: 4),
        Text(label, style: Theme.of(context).textTheme.bodySmall),
      ],
    );
  }
}

class _MiniStat extends StatelessWidget {
  const _MiniStat({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Text(value, style: Theme.of(context).textTheme.titleMedium),
        Text(
          label,
          style: Theme.of(context).textTheme.bodySmall?.copyWith(color: Theme.of(context).colorScheme.outline),
        ),
      ],
    );
  }
}

/// Pequeño indicador silencioso en el AppBar — un fallo de guardado NO se
/// muestra como error bloqueante (el usuario ya vio y "tiene" su resumen
/// en pantalla); solo se comunica con un ícono discreto para no arruinar
/// el momento de "terminé mi entrenamiento" con un diálogo de error por
/// un problema de red.
class _SaveStatusIndicator extends StatelessWidget {
  const _SaveStatusIndicator({required this.state});

  final AsyncValue<void> state;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);

    if (state.isLoading) {
      return Tooltip(
        message: l10n.savingSessionLabel,
        child: const SizedBox(height: 16, width: 16, child: CircularProgressIndicator(strokeWidth: 2)),
      );
    }
    if (state.hasError) {
      return Tooltip(
        message: l10n.sessionSaveErrorLabel,
        child: Icon(Icons.cloud_off, size: 20, color: Theme.of(context).colorScheme.error),
      );
    }
    return Tooltip(
      message: l10n.sessionSavedLabel,
      child: Icon(Icons.cloud_done_outlined, size: 20, color: Theme.of(context).colorScheme.outline),
    );
  }
}
