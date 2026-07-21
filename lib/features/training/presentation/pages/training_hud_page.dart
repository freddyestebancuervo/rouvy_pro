import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../app/router/app_router.dart';
import '../../../../core/utils/duration_formatter.dart';
import '../../../../l10n/generated/app_localizations.dart';
import '../../../device_connection/domain/entities/aggregated_telemetry.dart';
import '../../data/datasources/ride_session_snapshot_local_datasource.dart';
import '../providers/ride_session_controller.dart';
import '../widgets/metric_display.dart';

/// HUD de entrenamiento libre — sin ruta de video/3D todavía (eso llega
/// con el módulo de rutas, M4). Consume directamente la telemetría
/// combinada de `device_connection` a través de `RideSessionController`.
class TrainingHudPage extends ConsumerStatefulWidget {
  const TrainingHudPage({super.key});

  @override
  ConsumerState<TrainingHudPage> createState() => _TrainingHudPageState();
}

class _TrainingHudPageState extends ConsumerState<TrainingHudPage> {
  @override
  void initState() {
    super.initState();
    // Igual que en `DeviceScanSheet`: se difiere al final del frame actual
    // porque arrancar la sesión dispara `state =` y Flutter no permite
    // eso durante el build inicial del widget.
    WidgetsBinding.instance.addPostFrameCallback((_) => _startOrOfferRecovery());
  }

  /// Tarea B1 del roadmap: antes de arrancar una sesión nueva, comprueba
  /// si quedó un snapshot de una sesión anterior sin finalizar (cierre
  /// inesperado de la app) y, si lo hay, deja elegir al usuario en vez de
  /// descartarlo en silencio.
  Future<void> _startOrOfferRecovery() async {
    final controller = ref.read(rideSessionControllerProvider.notifier);
    final RideSessionSnapshotData? recoverable = await controller.checkForRecoverableSnapshot();

    if (!mounted) return;

    if (recoverable == null) {
      controller.start();
      return;
    }

    final AppLocalizations l10n = AppLocalizations.of(context);
    final bool? shouldResume = await showDialog<bool>(
      context: context,
      barrierDismissible: false,
      builder: (BuildContext dialogContext) => AlertDialog(
        title: Text(l10n.recoverSessionTitle),
        content: Text(
          l10n.recoverSessionMessage(
            DurationFormatter.format(Duration(seconds: recoverable.elapsedSeconds)),
            (recoverable.distanceMeters / 1000).toStringAsFixed(1),
          ),
        ),
        actions: <Widget>[
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: Text(l10n.discardSessionAction),
          ),
          FilledButton(
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: Text(l10n.resumeSessionAction),
          ),
        ],
      ),
    );

    if (!mounted) return;

    if (shouldResume == true) {
      controller.resumeFromSnapshot(recoverable);
    } else {
      await controller.discardRecoverableSnapshot();
      controller.start();
    }
  }

  Future<void> _handleFinish(AppLocalizations l10n) async {
    final bool? confirmed = await showDialog<bool>(
      context: context,
      builder: (BuildContext dialogContext) => AlertDialog(
        title: Text(l10n.finishSessionConfirmTitle),
        content: Text(l10n.finishSessionConfirmMessage),
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

    if (confirmed != true || !mounted) return;

    ref.read(rideSessionControllerProvider.notifier).finish();
    context.pushReplacement(AppRoute.trainingSummary);
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final RideSessionState session = ref.watch(rideSessionControllerProvider);
    final AggregatedTelemetry t = session.telemetry;

    return PopScope(
      // Evita salir por gesto/botón atrás sin pasar por la confirmación
      // de "Finalizar" — perder una sesión activa por accidente sería un
      // mal momento para que ocurra, literalmente en medio del esfuerzo.
      canPop: false,
      onPopInvokedWithResult: (bool didPop, _) {
        if (!didPop) _handleFinish(l10n);
      },
      child: Scaffold(
        appBar: AppBar(
          title: Text(l10n.trainingPageTitle),
          automaticallyImplyLeading: false,
          actions: <Widget>[
            IconButton(
              icon: const Icon(Icons.stop_circle_outlined),
              tooltip: l10n.finishSessionAction,
              onPressed: () => _handleFinish(l10n),
            ),
          ],
        ),
        body: SafeArea(
          child: Column(
            children: <Widget>[
              if (session.connectedDeviceCount == 0)
                Container(
                  width: double.infinity,
                  margin: const EdgeInsets.fromLTRB(16, 12, 16, 0),
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: Theme.of(context).colorScheme.primaryContainer.withValues(alpha: 0.4),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Row(
                    children: <Widget>[
                      Icon(Icons.bluetooth_disabled, size: 18, color: Theme.of(context).colorScheme.primary),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(l10n.noDevicesConnectedHint, style: Theme.of(context).textTheme.bodySmall),
                      ),
                    ],
                  ),
                ),
              Expanded(
                child: Center(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: <Widget>[
                      Text(
                        DurationFormatter.format(session.elapsed),
                        style: Theme.of(context).textTheme.displayMedium?.copyWith(fontWeight: FontWeight.w700),
                      ),
                      Text(l10n.metricTimeLabel, style: Theme.of(context).textTheme.bodySmall),
                      const SizedBox(height: 32),
                      GridView.count(
                        shrinkWrap: true,
                        physics: const NeverScrollableScrollPhysics(),
                        crossAxisCount: 2,
                        mainAxisSpacing: 32,
                        crossAxisSpacing: 16,
                        childAspectRatio: 1.8,
                        padding: const EdgeInsets.symmetric(horizontal: 24),
                        children: <Widget>[
                          MetricDisplay(
                            label: l10n.metricSpeedLabel,
                            value: t.speedKmh.toStringAsFixed(1),
                            unit: 'km/h',
                          ),
                          MetricDisplay(
                            label: l10n.metricPowerLabel,
                            value: t.powerWatts.toString(),
                            unit: 'W',
                          ),
                          MetricDisplay(
                            label: l10n.metricCadenceLabel,
                            value: t.cadenceRpm.toString(),
                            unit: 'rpm',
                          ),
                          MetricDisplay(
                            label: l10n.metricHeartRateLabel,
                            value: t.heartRateBpm?.toString() ?? '--',
                            unit: 'bpm',
                            color: t.heartRateBpm != null ? Colors.redAccent : null,
                          ),
                        ],
                      ),
                      const SizedBox(height: 24),
                      Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: <Widget>[
                          Text(
                            '${(t.distanceMeters / 1000).toStringAsFixed(2)} km',
                            style: Theme.of(context).textTheme.titleMedium,
                          ),
                          const SizedBox(width: 24),
                          Text(
                            '${t.caloriesKcal.round()} kcal',
                            style: Theme.of(context).textTheme.titleMedium,
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ),
              Padding(
                padding: const EdgeInsets.all(20),
                child: Row(
                  children: <Widget>[
                    Expanded(
                      child: OutlinedButton.icon(
                        onPressed: () {
                          final RideSessionController controller =
                              ref.read(rideSessionControllerProvider.notifier);
                          if (session.phase == RideSessionPhase.active) {
                            controller.pause();
                          } else if (session.phase == RideSessionPhase.paused) {
                            controller.resume();
                          }
                        },
                        icon: Icon(
                          session.phase == RideSessionPhase.active
                              ? Icons.pause
                              : Icons.play_arrow,
                        ),
                        label: Text(
                          session.phase == RideSessionPhase.active ? l10n.pauseAction : l10n.resumeAction,
                        ),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: FilledButton.icon(
                        onPressed: () => _handleFinish(l10n),
                        icon: const Icon(Icons.flag_outlined),
                        label: Text(l10n.finishSessionAction),
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
