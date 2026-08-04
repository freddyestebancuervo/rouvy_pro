import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';

import '../config/dev_backend_test_user.dart';
import 'backend_session.dart';

/// Maneja el ciclo de vida de la sesión del backend propio (login/registro
/// de la cuenta de prueba solo en debug, refresh) y siempre entrega un
/// access token válido a quien lo pida — lo consume
/// `BackendAuthInterceptor` (ver `backend_dio_client.dart`) antes de cada
/// request a Equipment/Workouts.
///
/// Recibe un [Dio] SIN el interceptor de auth (`authlessDio`) para sus
/// propias llamadas de login/registro/refresh — evita el ciclo de que el
/// interceptor que lo invoca dispare, a su vez, otra ronda de auth.
class BackendAuthService {
  BackendAuthService({
    required Dio authlessDio,
    required BackendSessionStore store,
    required bool allowsDevBackendTestUser,
    bool isDebugMode = kDebugMode,
  })  : _dio = authlessDio,
        _store = store,
        _allowsDevBackendTestUser = allowsDevBackendTestUser,
        _isDebugMode = isDebugMode;

  final Dio _dio;
  final BackendSessionStore _store;

  /// `AppEnvironment.allowsDevBackendTestUser` — ver ese campo para el
  /// porqué (incidente "Error al comunicarse con el servidor").
  final bool _allowsDevBackendTestUser;

  /// Parámetro (no una lectura directa de `kDebugMode`) para que esta
  /// clase sea unit-testeable sin depender del modo de compilación real
  /// del test runner — mismo patrón que `resolveGoogleSignInClientId`
  /// (`core/di/injection.dart`) y `resolveBackendBaseUrl`
  /// (`core/config/backend_config_resolver.dart`).
  final bool _isDebugMode;

  Future<String>? _inFlight;

  /// Devuelve un access token válido, refrescando o (solo en
  /// `kDebugMode`) iniciando sesión con la cuenta de prueba si hace falta.
  /// Coalesce llamadas concurrentes en un único `Future` — sin esto, dos
  /// requests simultáneas sin sesión dispararían dos registros/logins en
  /// paralelo contra el backend.
  Future<String> ensureAccessToken() {
    return _inFlight ??= _ensureAccessToken().whenComplete(() => _inFlight = null);
  }

  /// Fuerza a descartar la sesión guardada — la usa el interceptor cuando
  /// el backend rechaza un token que el cliente todavía creía vigente.
  Future<void> clearSession() => _store.clear();

  Future<String> _ensureAccessToken() async {
    final BackendSession? current = await _store.read();
    if (current != null && !current.isExpired) {
      return current.accessToken;
    }

    if (current != null) {
      final BackendSession? refreshed = await _tryRefresh(current.refreshToken);
      if (refreshed != null) {
        await _store.save(refreshed);
        return refreshed.accessToken;
      }
      await _store.clear();
    }

    if (!_isDebugMode && !_allowsDevBackendTestUser) {
      throw StateError(
        'No hay sesión de backend disponible y no se puede iniciar sesión '
        'automáticamente fuera de modo debug en este entorno '
        '(AppEnvironment.allowsDevBackendTestUser == false). Ver '
        'DevBackendTestUser.',
      );
    }

    if (!DevBackendTestUser.isConfigured) {
      throw StateError(
        'DevBackendTestUser no está configurada: corré la app con '
        '--dart-define-from-file=dart_define.local.json (ver '
        'dart_define.local.json.example en la raíz del repo) para poder '
        'probar Equipment/Workouts sin una pantalla de login propia.',
      );
    }

    final BackendSession session = await _loginOrRegisterTestUser();
    await _store.save(session);
    return session.accessToken;
  }

  Future<BackendSession?> _tryRefresh(String refreshToken) async {
    try {
      final Response<dynamic> response = await _dio.post<dynamic>(
        '/auth/refresh',
        data: <String, dynamic>{'refreshToken': refreshToken},
      );
      return _sessionFromResponse(response.data as Map<String, dynamic>);
    } on DioException {
      return null;
    }
  }

  Future<BackendSession> _loginOrRegisterTestUser() async {
    try {
      final Response<dynamic> response = await _dio.post<dynamic>(
        '/auth/register',
        data: <String, dynamic>{
          'email': DevBackendTestUser.email,
          'password': DevBackendTestUser.password,
          'displayName': DevBackendTestUser.displayName,
        },
      );
      return _sessionFromResponse(response.data as Map<String, dynamic>);
    } on DioException catch (e) {
      // 409 EMAIL_ALREADY_EXISTS: la cuenta de prueba ya existía de una
      // corrida anterior — camino esperado a partir del segundo uso.
      if (e.response?.statusCode == 409) {
        final Response<dynamic> response = await _dio.post<dynamic>(
          '/auth/login',
          data: <String, dynamic>{
            'email': DevBackendTestUser.email,
            'password': DevBackendTestUser.password,
          },
        );
        return _sessionFromResponse(response.data as Map<String, dynamic>);
      }
      rethrow;
    }
  }

  BackendSession _sessionFromResponse(Map<String, dynamic> data) {
    return BackendSession(
      accessToken: data['accessToken'] as String,
      refreshToken: data['refreshToken'] as String,
      expiresAt: DateTime.now().add(Duration(seconds: data['expiresIn'] as int)),
    );
  }
}
