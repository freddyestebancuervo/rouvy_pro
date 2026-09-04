import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../device_connection/domain/entities/aggregated_telemetry.dart';
import '../../../device_connection/domain/entities/ble_device.dart';
import '../../../device_connection/domain/entities/device_connection_status.dart';
import '../../../device_connection/domain/entities/telemetry_snapshot.dart';
import '../../../device_connection/domain/services/telemetry_aggregator.dart';
import '../../../device_connection/presentation/providers/device_providers.dart';
import '../../data/datasources/ride_session_snapshot_local_datasource.dart';
import '../../domain/entities/ride_session_summary.dart';
import '../../domain/entities/ride_session_target.dart';
import 'ride_session_snapshot_providers.dart';

enum RideSessionPhase { idle, active, paused, finished }

class RideSessionState {
  const RideSessionState({
    this.phase = RideSessionPhase.idle,
    this.telemetry = const AggregatedTelemetry(),
    this.elapsed = Duration.zero,
    this.connectedDeviceCount = 0,
    this.summary,
    this.target,
  });

  final RideSessionPhase phase;
  final AggregatedTelemetry telemetry;
  final Duration elapsed;
  final int connectedDeviceCount;
  final RideSessionSummary? summary;

  /// KORIXA-MVP-VERTICAL-SLICE-01 — `null` para una sesión libre (el
  /// comportamiento histórico, sin cambios). Fijado una única vez en
  /// `start()`, nunca reasignado durante la sesión.
  final RideSessionTarget? target;

  bool get isRouteBacked => target != null;

  /// Progreso 0.0–1.0 a lo largo de la ruta, derivado DIRECTAMENTE de
  /// `telemetry.distanceMeters` (el acumulado que ya calcula
  /// `TelemetryAggregator`) — deliberadamente no es un contador paralelo,
  /// para heredar gratis su comportamiento ya correcto ante velocidad
  /// cero (no integra), pausa (deja de integrar) y huecos largos de
  /// reconexión (los descarta, no crea saltos falsos). Clamped a [0, 1]:
  /// nunca negativo, nunca por encima de 1.0 aunque el ciclista siga
  /// pedaleando después de completar la ruta.
  double get routeProgress {
    final RideSessionTarget? t = target;
    if (t == null || t.routeTotalDistanceMeters <= 0) return 0;
    final double raw = telemetry.distanceMeters / t.routeTotalDistanceMeters;
    if (raw.isNaN || raw < 0) return 0;
    return raw > 1 ? 1 : raw;
  }

  RideSessionState copyWith({
    RideSessionPhase? phase,
    AggregatedTelemetry? telemetry,
    Duration? elapsed,
    int? connectedDeviceCount,
    RideSessionSummary? summary,
    RideSessionTarget? target,
  }) {
    return RideSessionState(
      phase: phase ?? this.phase,
      telemetry: telemetry ?? this.telemetry,
      elapsed: elapsed ?? this.elapsed,
      connectedDeviceCount: connectedDeviceCount ?? this.connectedDeviceCount,
      summary: summary ?? this.summary,
      target: target ?? this.target,
    );
  }
}

final rideSessionControllerProvider =
    NotifierProvider<RideSessionController, RideSessionState>(RideSessionController.new);

/// Orquesta una sesión de entrenamiento libre combinando lo que el módulo
/// `device_connection` ya expone: la lista de dispositivos conectados y el
/// stream de telemetría de cada uno. Este controlador NO habla con BLE
/// directamente — solo con las abstracciones de dominio de ese módulo, lo
/// que mantiene `training` desacoplado del transporte real de los datos
/// (podría ser BLE hoy y ANT+ u otra cosa mañana sin cambiar una línea aquí).
class RideSessionController extends Notifier<RideSessionState> {
  final TelemetryAggregator _aggregator = TelemetryAggregator();
  final Map<String, StreamSubscription<TelemetrySnapshot>> _deviceSubs =
      <String, StreamSubscription<TelemetrySnapshot>>{};
  StreamSubscription<List<BleDevice>>? _devicesSub;
  Timer? _ticker;
  Timer? _snapshotTimer;
  DateTime? _startTime;
  DateTime? _pausedAt;
  Duration _pausedDurationTotal = Duration.zero;

  /// KORIXA-MVP-VERTICAL-SLICE-01 — evita que dos snapshots ya en vuelo
  /// (llegados antes de que `finish()` alcance a cancelar la
  /// suscripción) disparen una segunda finalización automática. Se
  /// resetea en `start()`; no hace falta en `resumeFromSnapshot()` porque
  /// esa vía nunca trae un `target` (ver su propio docblock).
  bool _autoCompletionTriggered = false;

  RideSessionSnapshotLocalDataSource get _snapshotDataSource =>
      ref.read(rideSessionSnapshotDataSourceProvider);

  @override
  RideSessionState build() {
    ref.onDispose(_disposeAll);
    return const RideSessionState();
  }

  /// Se llama ANTES de `start()`, típicamente desde el `initState` de
  /// `TrainingHudPage`, para decidir si ofrecer "recuperar sesión
  /// anterior" en vez de arrancar una nueva directamente (tarea B1 del
  /// roadmap — recuperación tras un cierre inesperado de la app).
  Future<RideSessionSnapshotData?> checkForRecoverableSnapshot() {
    return _snapshotDataSource.load();
  }

  Future<void> discardRecoverableSnapshot() {
    return _snapshotDataSource.clear();
  }

  /// [target] es opcional (KORIXA-MVP-VERTICAL-SLICE-01): `null` arranca
  /// una sesión libre, exactamente el comportamiento histórico. Con un
  /// `target`, la sesión queda "route-aware" — ver `RideSessionState.routeProgress`
  /// y `_maybeAutoCompleteRoute`.
  void start({RideSessionTarget? target}) {
    _aggregator.reset();
    _startTime = DateTime.now();
    _pausedDurationTotal = Duration.zero;
    _autoCompletionTriggered = false;
    state = RideSessionState(phase: RideSessionPhase.active, target: target);

    _subscribeToConnectedDevices();
    _startTicker();
    _startSnapshotTimer();
  }

  /// Continúa una sesión a partir de un snapshot recuperado — a
  /// diferencia de `start()`, no resetea el acumulado de distancia ni
  /// calorías: sigue integrando sobre lo que ya se había guardado.
  ///
  /// KORIXA-MVP-VERTICAL-SLICE-01 — límite conocido, documentado a
  /// propósito: `RideSessionSnapshotData` (recuperación tras cierre
  /// inesperado, tarea B1) todavía no persiste el `RideSessionTarget` de
  /// la sesión. Una sesión "route-aware" que se recupera así vuelve como
  /// sesión libre (sin ruta asociada, `routeProgress == 0`) — no pierde
  /// datos de telemetría/distancia, solo el vínculo con la ruta. Ampliar
  /// el snapshot para incluir el `target` queda fuera de este slice.
  void resumeFromSnapshot(RideSessionSnapshotData snapshot) {
    _aggregator.reset();
    _autoCompletionTriggered = false;
    _aggregator.seed(
      AggregatedTelemetry(
        distanceMeters: snapshot.distanceMeters,
        caloriesKcal: snapshot.caloriesKcal,
        elapsedSeconds: snapshot.elapsedSeconds,
      ),
    );
    // El "inicio" efectivo se recalcula hacia atrás para que el reloj de
    // la sesión (`elapsed`) continúe desde donde se quedó, en vez de
    // reiniciar a 00:00.
    _startTime = DateTime.now().subtract(Duration(seconds: snapshot.elapsedSeconds));
    _pausedDurationTotal = Duration.zero;

    state = RideSessionState(
      phase: RideSessionPhase.active,
      telemetry: _aggregator.currentState,
      elapsed: Duration(seconds: snapshot.elapsedSeconds),
      connectedDeviceCount: snapshot.connectedDeviceCount,
    );

    _subscribeToConnectedDevices();
    _startTicker();
    _startSnapshotTimer();
  }

  void pause() {
    if (state.phase != RideSessionPhase.active) return;
    _pausedAt = DateTime.now();
    _unsubscribeAllDevices(); // congela la telemetría: no se sigue integrando distancia/calorías
    _ticker?.cancel();
    _snapshotTimer?.cancel();
    state = state.copyWith(phase: RideSessionPhase.paused);
  }

  void resume() {
    if (state.phase != RideSessionPhase.paused) return;
    if (_pausedAt != null) {
      _pausedDurationTotal += DateTime.now().difference(_pausedAt!);
      _pausedAt = null;
    }
    state = state.copyWith(phase: RideSessionPhase.active);
    _subscribeToConnectedDevices();
    _startTicker();
    _startSnapshotTimer();
  }

  /// KORIXA-MVP-VERTICAL-SLICE-01 — idempotente: si ya está `finished`
  /// (llamada manual mientras la finalización automática ya corrió, o
  /// cualquier doble-tap/reentrada), devuelve el MISMO resumen ya
  /// construido sin repetir el teardown ni reconstruir el estado — así
  /// nunca hay un segundo guardado en Firestore ni una segunda
  /// navegación disparada por un segundo cambio de fase (`ref.listen` en
  /// `TrainingHudPage` solo reacciona a una transición real a
  /// `finished`, que solo ocurre una vez).
  RideSessionSummary finish() {
    final RideSessionSummary? existing = state.summary;
    if (state.phase == RideSessionPhase.finished && existing != null) {
      return existing;
    }

    final DateTime endTime = DateTime.now();
    _unsubscribeAllDevices();
    _devicesSub?.cancel();
    _ticker?.cancel();
    _snapshotTimer?.cancel();
    unawaited(_snapshotDataSource.clear()); // ya no hay nada que recuperar

    final RideSessionTarget? target = state.target;
    // `routeCompleted` se deriva del estado en el momento de finalizar —
    // nunca de si `finish()` fue llamado "automáticamente" o "a mano":
    // una finalización automática solo ocurre cuando la distancia ya
    // alcanzó el total (ver `_maybeAutoCompleteRoute`), así que esta
    // misma condición cubre ambos casos sin necesitar un parámetro extra.
    final bool? routeCompleted = target == null
        ? null
        : (target.routeTotalDistanceMeters > 0 &&
            _aggregator.currentState.distanceMeters >= target.routeTotalDistanceMeters);

    final RideSessionSummary summary = RideSessionSummary(
      startTime: _startTime ?? endTime,
      endTime: endTime,
      finalTelemetry: _aggregator.currentState,
      connectedDeviceCount: state.connectedDeviceCount,
      routeId: target?.routeId,
      routeName: target?.routeName,
      routeTotalDistanceMeters: target?.routeTotalDistanceMeters,
      routeCompleted: routeCompleted,
    );

    state = state.copyWith(phase: RideSessionPhase.finished, summary: summary);
    return summary;
  }

  /// Se llama al salir de la pantalla de resumen, para dejar el
  /// controlador listo para una nueva sesión sin arrastrar estado de la
  /// anterior.
  void reset() {
    _disposeAll();
    state = const RideSessionState();
  }

  // ---------------------------------------------------------------------
  // Fusión de dispositivos conectados
  // ---------------------------------------------------------------------

  void _subscribeToConnectedDevices() {
    _devicesSub?.cancel();
    _devicesSub = ref.read(observeConnectedDevicesUseCaseProvider)().listen((List<BleDevice> devices) {
      final Set<String> currentlyConnected = devices
          .where((BleDevice d) => d.status == DeviceConnectionStatus.connected)
          .map((BleDevice d) => d.id)
          .toSet();

      // Deja de escuchar dispositivos que se desconectaron durante la sesión.
      final List<String> toRemove =
          _deviceSubs.keys.where((String id) => !currentlyConnected.contains(id)).toList();
      for (final String id in toRemove) {
        _deviceSubs.remove(id)?.cancel();
      }

      // Empieza a escuchar dispositivos nuevos (conectados a mitad de sesión).
      for (final String id in currentlyConnected) {
        if (_deviceSubs.containsKey(id)) continue;
        _deviceSubs[id] = ref.read(observeTelemetryUseCaseProvider)(id).listen((TelemetrySnapshot snapshot) {
          final AggregatedTelemetry updated = _aggregator.ingest(snapshot);
          state = state.copyWith(telemetry: updated);
          _maybeAutoCompleteRoute();
        });
      }

      state = state.copyWith(connectedDeviceCount: currentlyConnected.length);
    });
  }

  void _unsubscribeAllDevices() {
    for (final StreamSubscription<TelemetrySnapshot> sub in _deviceSubs.values) {
      sub.cancel();
    }
    _deviceSubs.clear();
  }

  // ---------------------------------------------------------------------
  // Finalización automática de ruta (KORIXA-MVP-VERTICAL-SLICE-01)
  // ---------------------------------------------------------------------

  /// Se llama tras CADA snapshot de telemetría ingerido. Dispara
  /// `finish()` exactamente una vez cuando la distancia acumulada
  /// alcanza el total de la ruta — nunca navega ni toca `BuildContext`
  /// (eso lo hace `TrainingHudPage`, observando la transición de fase).
  ///
  /// Doble guarda contra reentrada: `_autoCompletionTriggered` (evita que
  /// un snapshot ya en vuelo cuando `finish()` cancela la suscripción
  /// dispare una segunda vez) y `state.phase != active` (además,
  /// `finish()` en sí mismo ya es idempotente — ver su docblock).
  void _maybeAutoCompleteRoute() {
    if (_autoCompletionTriggered) return;
    if (state.phase != RideSessionPhase.active) return;

    final RideSessionTarget? target = state.target;
    if (target == null || target.routeTotalDistanceMeters <= 0) return;
    if (state.telemetry.distanceMeters < target.routeTotalDistanceMeters) return;

    _autoCompletionTriggered = true;
    finish();
  }

  // ---------------------------------------------------------------------
  // Reloj de la sesión (independiente de si llega telemetría o no — un
  // ciclista puede parar de pedalear un momento sin que la app "pierda"
  // el tiempo transcurrido de la sesión).
  // ---------------------------------------------------------------------

  void _startTicker() {
    _ticker?.cancel();
    _ticker = Timer.periodic(const Duration(seconds: 1), (_) {
      if (_startTime == null) return;
      final Duration elapsed = DateTime.now().difference(_startTime!) - _pausedDurationTotal;
      state = state.copyWith(elapsed: elapsed);
    });
  }

  // ---------------------------------------------------------------------
  // Snapshot de recuperación (tarea B1, ROADMAP_M0_M1.md)
  // ---------------------------------------------------------------------

  void _startSnapshotTimer() {
    _snapshotTimer?.cancel();
    _snapshotTimer = Timer.periodic(const Duration(seconds: 10), (_) => _persistSnapshot());
  }

  void _persistSnapshot() {
    if (_startTime == null) return;
    final AggregatedTelemetry t = state.telemetry;
    unawaited(
      _snapshotDataSource.save(
        RideSessionSnapshotData(
          startTimeIso: _startTime!.toIso8601String(),
          elapsedSeconds: state.elapsed.inSeconds,
          distanceMeters: t.distanceMeters,
          caloriesKcal: t.caloriesKcal,
          connectedDeviceCount: state.connectedDeviceCount,
          savedAtIso: DateTime.now().toIso8601String(),
        ),
      ),
    );
  }

  void _disposeAll() {
    _unsubscribeAllDevices();
    _devicesSub?.cancel();
    _ticker?.cancel();
    _snapshotTimer?.cancel();
  }
}
