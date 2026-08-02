import 'package:dio/dio.dart';

import 'backend_auth_service.dart';

BaseOptions _baseOptions(String backendBaseUrl) => BaseOptions(
      baseUrl: backendBaseUrl,
      connectTimeout: const Duration(seconds: 10),
      receiveTimeout: const Duration(seconds: 15),
    );

/// Cliente Dio SIN el interceptor de auth — lo usa [BackendAuthService] para
/// sus propias llamadas de login/registro/refresh (evita el ciclo de que el
/// interceptor de auth dispare, a su vez, otra ronda de auth).
///
/// [backendBaseUrl] llega ya resuelto por entorno — ver
/// `core/config/backend_config_resolver.dart` y `core/di/injection.dart`,
/// el único lugar que debería llamar a esta función.
Dio createAuthlessBackendDio(String backendBaseUrl) =>
    Dio(_baseOptions(backendBaseUrl));

/// Cliente Dio CON el interceptor de auth — lo usan los datasources de
/// features (Workouts, y en el futuro Equipment) para llamar al backend ya
/// autenticado, sin que cada uno tenga que saber nada de tokens.
Dio createAuthenticatedBackendDio(
  BackendAuthService authService,
  String backendBaseUrl,
) {
  final Dio dio = Dio(_baseOptions(backendBaseUrl));
  dio.interceptors.add(_BackendAuthInterceptor(authService, backendBaseUrl));
  return dio;
}

class _BackendAuthInterceptor extends Interceptor {
  _BackendAuthInterceptor(this._authService, this._backendBaseUrl);

  final BackendAuthService _authService;
  final String _backendBaseUrl;

  @override
  Future<void> onRequest(
    RequestOptions options,
    RequestInterceptorHandler handler,
  ) async {
    try {
      final String token = await _authService.ensureAccessToken();
      options.headers['Authorization'] = 'Bearer $token';
      handler.next(options);
    } catch (error, stackTrace) {
      handler.reject(
        DioException(
          requestOptions: options,
          error: error,
          stackTrace: stackTrace,
        ),
      );
    }
  }

  @override
  Future<void> onError(
    DioException err,
    ErrorInterceptorHandler handler,
  ) async {
    // Reintento único: un 401 acá significa que el token que SE ADJUNTÓ
    // (distinto del caso "no hay sesión", ya cubierto en onRequest) fue
    // rechazado por el backend — pudo expirar justo entre que se leyó y se
    // usó, o quedar invalidado del lado del servidor. `extra['retried']`
    // evita un bucle si el reintento también falla.
    final bool alreadyRetried = err.requestOptions.extra['retried'] == true;
    if (err.response?.statusCode == 401 && !alreadyRetried) {
      try {
        await _authService.clearSession();
        final String token = await _authService.ensureAccessToken();
        final RequestOptions retryOptions = err.requestOptions
          ..headers['Authorization'] = 'Bearer $token'
          ..extra['retried'] = true;
        final Response<dynamic> response = await Dio(
          _baseOptions(_backendBaseUrl),
        ).fetch<dynamic>(retryOptions);
        handler.resolve(response);
        return;
      } catch (_) {
        // Cae al handler.next(err) de abajo con el error original — el
        // reintento no pudo resolverlo (p. ej. backend caído).
      }
    }
    handler.next(err);
  }
}
