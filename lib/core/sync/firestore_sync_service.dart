import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';

import '../network/network_info.dart';
import 'sync_status.dart';

/// Convierte "conectividad de red" (un hecho de bajo nivel) en "estado de
/// sincronización" (lo que la UI realmente necesita comunicar).
///
/// Por qué existe además de la persistencia offline nativa de Firestore
/// (activada en `main.dart`): esa persistencia resuelve el CASO DE USO
/// (la app sigue funcionando sin red) de forma completamente transparente
/// y automática — pero no expone, por sí sola, ningún estado observable
/// de "¿ya se sincronizó todo lo que quedó pendiente mientras estaba
/// offline?". Este servicio cierra ese hueco combinando dos señales:
///
/// 1. `NetworkInfo.onConnectivityChanged` — cuándo cambia la conectividad.
/// 2. `FirebaseFirestore.waitForPendingWrites()` — un `Future` que el SDK
///    de Firestore resuelve exactamente cuando todas las escrituras
///    encoladas localmente ya fueron confirmadas por el servidor. Es una
///    API real del SDK, no una implementación propia de "esperar y
///    reintentar" — se apoya en el propio mecanismo de sincronización de
///    Firestore en vez de reinventarlo.
class FirestoreSyncService {
  FirestoreSyncService({
    required NetworkInfo networkInfo,
    required FirebaseFirestore firestore,
  })  : _networkInfo = networkInfo,
        _firestore = firestore;

  final NetworkInfo _networkInfo;
  final FirebaseFirestore _firestore;

  final StreamController<SyncStatus> _controller = StreamController<SyncStatus>.broadcast();
  StreamSubscription<bool>? _connectivitySub;
  bool _wasOffline = false;

  /// Se llama una vez al arrancar la app (junto al resto de la
  /// inicialización en `main.dart`/DI) para empezar a escuchar cambios de
  /// conectividad. No hace falta desuscribirse manualmente en ningún sitio
  /// del ciclo de vida de la app — vive tanto como el proceso, igual que
  /// `BleDataSource`.
  void start() {
    _connectivitySub = _networkInfo.onConnectivityChanged.listen(_handleConnectivityChange);
  }

  Future<void> _handleConnectivityChange(bool isConnected) async {
    if (!isConnected) {
      _wasOffline = true;
      _controller.add(SyncStatus.offline);
      return;
    }

    // Transición offline → online: si hubo un periodo sin red, se espera
    // explícitamente a que Firestore confirme que ya no quedan escrituras
    // pendientes antes de reportar `online` — así el banner puede mostrar
    // "sincronizando…" durante esa ventana en vez de pasar directo a "sin
    // avisos" mientras técnicamente todavía hay datos por confirmar.
    if (_wasOffline) {
      _controller.add(SyncStatus.syncingPendingWrites);
      try {
        await _firestore.waitForPendingWrites();
      } catch (_) {
        // `waitForPendingWrites()` puede fallar si la conexión se corta
        // de nuevo a mitad de la espera — no es un error fatal, el
        // próximo cambio de conectividad reintentará el ciclo completo.
      }
      _wasOffline = false;
    }

    _controller.add(SyncStatus.online);
  }

  Stream<SyncStatus> get statusStream => _controller.stream;

  void dispose() {
    _connectivitySub?.cancel();
    _controller.close();
  }
}
