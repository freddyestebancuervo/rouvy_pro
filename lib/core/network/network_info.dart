import 'package:connectivity_plus/connectivity_plus.dart';

/// Puerto simple para consultar el estado de la conexión.
///
/// Se inyecta en los `RepositoryImpl` para decidir si conviene ir a la
/// fuente remota o fallar rápido con un [NetworkFailure] — evita esperar
/// un timeout largo de Firebase cuando ya sabemos que no hay red.
abstract class NetworkInfo {
  Future<bool> get isConnected;

  /// Stream en vivo de cambios de conectividad — a diferencia de
  /// [isConnected] (una comprobación puntual), esto es lo que permite
  /// reaccionar automáticamente al momento exacto en que la red vuelve,
  /// sin que nadie tenga que hacer polling. Lo consume
  /// `FirestoreSyncService` (`core/sync/`) para disparar la sincronización
  /// en cuanto se detecta la transición offline → online.
  Stream<bool> get onConnectivityChanged;
}

class NetworkInfoImpl implements NetworkInfo {
  NetworkInfoImpl(this._connectivity);

  final Connectivity _connectivity;

  @override
  Future<bool> get isConnected async {
    final List<ConnectivityResult> result =
        await _connectivity.checkConnectivity();
    return !result.contains(ConnectivityResult.none);
  }

  @override
  Stream<bool> get onConnectivityChanged {
    return _connectivity.onConnectivityChanged.map(
      (List<ConnectivityResult> result) => !result.contains(ConnectivityResult.none),
    );
  }
}
