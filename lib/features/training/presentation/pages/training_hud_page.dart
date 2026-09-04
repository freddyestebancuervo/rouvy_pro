import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../app/router/app_router.dart';
import '../../../../core/utils/duration_formatter.dart';
import '../../../../l10n/generated/app_localizations.dart';
import '../../../device_connection/domain/entities/aggregated_telemetry.dart';
import '../../../routes_catalog/domain/entities/training_route.dart';
import '../../../routes_catalog/presentation/providers/routes_providers.dart';
import '../../data/datasources/ride_session_snapshot_local_datasource.dart';
import '../../domain/entities/ride_session_target.dart';
import '../providers/ride_session_controller.dart';
import '../widgets/metric_display.dart';

/// HUD de entrenamiento — libre (sin ruta) o "route-aware"
/// (KORIXA-MVP-VERTICAL-SLICE-01, `routeId` recibido por query param desde
/// `RouteDetailPage`). Sin video/3D sincronizado todavía (eso llega con un
/// módulo M4 posterior) — acá "ruta" significa únicamente distancia
/// objetivo y progreso propio, nunca contenido audiovisual. Consume
/// directamente la telemetría combinada de `device_connection` a través de
/// `RideSessionController`.
class TrainingHudPage extends ConsumerStatefulWidget {
  const TrainingHudPage({this.routeId, super.key});

  /// `null` → sesión libre, comportamiento histórico sin cambios.
  final String? routeId;

  @override
  ConsumerState<TrainingHudPage> createState() => _TrainingHudPageState();
}

enum _RouteResolutionStatus { none, loading, resolved, failed }

class _TrainingHudPageState extends ConsumerState<TrainingHudPage> {
  _RouteResolutionStatus _routeStatus = _RouteResolutionStatus.none;

  /// Evita una segunda navegación si, por lo que sea, `ref.listen` viera
  /// más de una transición a `finished` (defensivo — `finish()` en el
  /// controller ya es idempotente por su cuenta).
  bool _navigatedToSummary = false;

  @override
  void initState() {
    super.initState();
    // Igual que en `DeviceScanSheet`: se difiere al final del frame actual
    // porque arrancar la sesión dispara `state =` y Flutter no permite
    // eso durante el build inicial del widget.
    WidgetsBinding.instance.addPostFrameCallback((_) => _resolveRouteThenStart());
  }

  /// Resuelve `widget.routeId` (si vino uno) ANTES de arrancar cualquier
  /// sesión — requisito explícito: un `routeId` inválido/inexistente
  /// nunca debe caer en silencio a una sesión libre fingiendo que la
  /// ruta existe (fail-safe). Reusa `routesRepositoryProvider`
  /// (`routes_catalog`), que ya devuelve `Left(Failure)` para un id
  /// desconocido — ver `RoutesRepositoryImpl.fetchById`.
  Future<void> _resolveRouteThenStart() async {
    if (widget.routeId == null) {
      await _startOrOfferRecovery(target: null);
      return;
    }

    setState(() => _routeStatus = _RouteResolutionStatus.loading);

    final result = await ref.read(routesRepositoryProvider).fetchById(widget.routeId!);
    if (!mounted) return;

    TrainingRoute? route;
    result.fold((_) => route = null, (r) => route = r);

    if (route == null) {
      setState(() => _routeStatus = _RouteResolutionStatus.failed);
      return; // FAIL SAFE — nunca arranca controller.start() desde acá
    }

    setState(() => _routeStatus = _RouteResolutionStatus.resolved);
    final RideSessionTarget target = RideSessionTarget(
      routeId: route!.id,
      routeName: route!.name,
      routeTotalDistanceMeters: route!.distanceMeters,
    );
    await _startOrOfferRecovery(target: target);
  }

  /// Tarea B1 del roadmap: antes de arrancar una sesión nueva, comprueba
  /// si quedó un snapshot de una sesión anterior sin finalizar (cierre
  /// inesperado de la app) y, si lo hay, deja elegir al usuario en vez de
  /// descartarlo en silencio.
  Future<void> _startOrOfferRecovery({required RideSessionTarget? target}) async {
    final controller = ref.read(rideSessionControllerProvider.notifier);
    final RideSessionSnapshotData? recoverable = await controller.checkForRecoverableSnapshot();

    if (!mounted) return;

    if (recoverable == null) {
      controller.start(target: target);
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
      controller.start(target: target);
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

    // KORIXA-MVP-VERTICAL-SLICE-01 — solo cambia la fase; la navegación
    // real vive en un único `ref.listen` en `build()`, que reacciona a
    // ESTA transición (finalización manual) exactamente igual que a una
    // finalización automática por ruta completada — un solo punto de
    // navegación para ambos casos, sin duplicar el push.
    ref.read(rideSessionControllerProvider.notifier).finish();
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);

    // Navega al resumen exactamente una vez, al ver la transición a
    // `finished` — cubre TANTO la finalización manual (botón/back gesture,
    // `_handleFinish`) COMO la automática por ruta completada
    // (`RideSessionController._maybeAutoCompleteRoute`), sin que el
    // controller (dominio) toque `BuildContext`/navegación.
    ref.listen<RideSessionState>(rideSessionControllerProvider, (RideSessionState? previous, RideSessionState next) {
      if (_navigatedToSummary) return;
      if (next.phase != RideSessionPhase.finished) return;
      _navigatedToSummary = true;
      context.pushReplacement(AppRoute.trainingSummary);
    });

    if (_routeStatus == _RouteResolutionStatus.failed) {
      return _RouteNotFoundView(l10n: l10n);
    }

    if (_routeStatus == _RouteResolutionStatus.loading) {
      // Evita mostrar brevemente el HUD en fase `idle` (telemetría en
      // cero) mientras todavía se resuelve la ruta — el usuario nunca
      // debe ver un HUD "arrancado" antes de saber si la ruta existe.
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }

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
              // KORIXA-MVP-VERTICAL-SLICE-01 — solo visible en una sesión
              // "route-aware"; una sesión libre (`target == null`) no
              // muestra ninguna barra de progreso, comportamiento
              // histórico intacto.
              if (session.isRouteBacked)
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: <Widget>[
                          Expanded(
                            child: Text(
                              session.target!.routeName,
                              style: Theme.of(context).textTheme.labelLarge,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                          Text(
                            '${(session.routeProgress * 100).toStringAsFixed(0)}%',
                            style: Theme.of(context)
                                .textTheme
                                .labelLarge
                                ?.copyWith(fontWeight: FontWeight.w700),
                          ),
                        ],
                      ),
                      const SizedBox(height: 6),
                      ClipRRect(
                        borderRadius: BorderRadius.circular(6),
                        child: LinearProgressIndicator(
                          value: session.routeProgress,
                          minHeight: 8,
                          semanticsLabel: l10n.routeProgressLabel,
                        ),
                      ),
                    ],
                  ),
                ),
              Expanded(
                child: Center(
                  child: SingleChildScrollView(
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

/// KORIXA-MVP-VERTICAL-SLICE-01 — fail-safe explícito: un `routeId`
/// inválido/inexistente NUNCA debe arrancar una sesión libre fingiendo
/// que la ruta pedida existe. Se muestra en su lugar, con una salida
/// clara de vuelta al catálogo — nunca un HUD "a medias".
class _RouteNotFoundView extends StatelessWidget {
  const _RouteNotFoundView({required this.l10n});

  final AppLocalizations l10n;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(l10n.routeNotFoundTitle)),
      body: SafeArea(
        child: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                Icon(Icons.error_outline, size: 48, color: Theme.of(context).colorScheme.error),
                const SizedBox(height: 16),
                Text(
                  l10n.routeNotFoundMessage,
                  textAlign: TextAlign.center,
                  style: Theme.of(context).textTheme.bodyMedium,
                ),
                const SizedBox(height: 24),
                FilledButton(
                  onPressed: () => context.go(AppRoute.routesCatalog),
                  child: Text(l10n.backToRoutesAction),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
