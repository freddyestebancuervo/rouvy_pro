import 'package:equatable/equatable.dart';

import 'wearable_connection_status.dart';
import 'wearable_provider_type.dart';

class WearableConnection extends Equatable {
  const WearableConnection({
    required this.provider,
    required this.status,
    this.lastSyncAt,
    this.errorMessage,
    this.advisoryMessage,
  });

  final WearableProviderType provider;
  final WearableConnectionStatus status;
  final DateTime? lastSyncAt;
  final String? errorMessage;

  /// Mensaje informativo, NUNCA de error — distinto de [errorMessage] en
  /// que no implica que algo falló. Tarea B3 del roadmap: se usa para
  /// sugerir revisar Ajustes tras varios `fetchActivities()` vacíos
  /// consecutivos en Apple Health (iOS), sin marcar la conexión como
  /// `error` (sigue `connected`, simplemente no ha traído datos todavía).
  final String? advisoryMessage;

  WearableConnection copyWith({
    WearableConnectionStatus? status,
    DateTime? lastSyncAt,
    String? errorMessage,
    String? advisoryMessage,
  }) {
    return WearableConnection(
      provider: provider,
      status: status ?? this.status,
      lastSyncAt: lastSyncAt ?? this.lastSyncAt,
      errorMessage: errorMessage,
      advisoryMessage: advisoryMessage,
    );
  }

  @override
  List<Object?> get props => [provider, status, lastSyncAt, errorMessage, advisoryMessage];
}
