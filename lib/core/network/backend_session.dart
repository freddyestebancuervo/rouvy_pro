import 'package:equatable/equatable.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Sesión del backend propio de RidePro (NestJS + JWT RS256) —
/// completamente independiente de la sesión de Firebase Auth que ya
/// maneja `features/auth`. Ver `docs/TECHNICAL_SPECIFICATION_BLOQUE_D.md`:
/// Equipment (D1) y Workouts (D2) viven detrás de este backend propio, no
/// de Firebase.
class BackendSession extends Equatable {
  const BackendSession({
    required this.accessToken,
    required this.refreshToken,
    required this.expiresAt,
  });

  final String accessToken;
  final String refreshToken;
  final DateTime expiresAt;

  /// Margen de 30s antes del vencimiento real — evita arrancar una request
  /// con un token que expira a mitad de camino.
  bool get isExpired =>
      DateTime.now().isAfter(expiresAt.subtract(const Duration(seconds: 30)));

  @override
  List<Object?> get props => [accessToken, refreshToken, expiresAt];
}

/// Persiste la sesión del backend en almacenamiento seguro del
/// dispositivo — a diferencia de la sesión de Firebase (que su propio SDK
/// persiste solo), esta es responsabilidad nuestra por completo.
class BackendSessionStore {
  BackendSessionStore(this._storage);

  final FlutterSecureStorage _storage;

  static const String _kAccessToken = 'backend_access_token';
  static const String _kRefreshToken = 'backend_refresh_token';
  static const String _kExpiresAt = 'backend_expires_at';

  Future<BackendSession?> read() async {
    final String? accessToken = await _storage.read(key: _kAccessToken);
    final String? refreshToken = await _storage.read(key: _kRefreshToken);
    final String? expiresAtRaw = await _storage.read(key: _kExpiresAt);
    if (accessToken == null || refreshToken == null || expiresAtRaw == null) {
      return null;
    }
    final DateTime? expiresAt = DateTime.tryParse(expiresAtRaw);
    if (expiresAt == null) return null;
    return BackendSession(accessToken: accessToken, refreshToken: refreshToken, expiresAt: expiresAt);
  }

  Future<void> save(BackendSession session) async {
    await _storage.write(key: _kAccessToken, value: session.accessToken);
    await _storage.write(key: _kRefreshToken, value: session.refreshToken);
    await _storage.write(key: _kExpiresAt, value: session.expiresAt.toIso8601String());
  }

  Future<void> clear() async {
    await _storage.delete(key: _kAccessToken);
    await _storage.delete(key: _kRefreshToken);
    await _storage.delete(key: _kExpiresAt);
  }
}
