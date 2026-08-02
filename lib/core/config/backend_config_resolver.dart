import 'package:flutter/foundation.dart';

import 'app_environment.dart';

/// Resuelve la `backendBaseUrl` real a usar (Documento 21, Fases 0.3/0.3.1).
///
/// Prioridad:
/// 1. Si `BACKEND_BASE_URL_OVERRIDE` (vía `--dart-define` o
///    `--dart-define-from-file=dart_define.local.json`) queda vacío tras
///    `trim()` → se usa `environment.backendBaseUrl`, validado.
/// 2. Si no queda vacío y `environment.allowsBackendOverride` es `true` →
///    se usa el override, validado.
/// 3. Si no queda vacío y `environment.allowsBackendOverride` es `false`
///    → **falla explícitamente** con [StateError], sin importar si el
///    override en sí es una URL válida o no — la política de entorno se
///    evalúa antes que el formato. Nunca se ignora un override prohibido
///    en silencio para "seguir funcionando" con el valor del entorno.
///
/// [override] es un parámetro con valor por defecto — no una lectura
/// interna fija — para que este resolver sea unit-testeable sin necesitar
/// pasar un `--dart-define` real al ejecutar `flutter test`. Mismo patrón
/// ya usado por `resolveGoogleSignInClientId` en `core/di/injection.dart`.
///
/// Deliberadamente NO toca `environment.firebaseOptions` ni
/// `environment.googleSignInWebClientId` — cubre única y exclusivamente
/// la URL del backend NestJS. No existe, ni debe existir, un mecanismo
/// equivalente para la identidad de Firebase (Documento 20, D20-1: eso
/// nunca se decide vía `dart-define`).
///
/// La URL que termina usándose (override o la del entorno) se valida
/// antes de devolverse: debe tener esquema `http`/`https` y un host no
/// vacío. Si no cumple, lanza [StateError] de inmediato — nunca se
/// "corrige" nada silenciosamente (sin agregar esquema por defecto, sin
/// recortar ni completar rutas, sin normalizar mayúsculas/minúsculas,
/// etc.).
String resolveBackendBaseUrl(
  AppEnvironment environment, {
  String override = const String.fromEnvironment('BACKEND_BASE_URL_OVERRIDE'),
}) {
  final String trimmedOverride = override.trim();

  if (trimmedOverride.isEmpty) {
    return _validated(
      environment.backendBaseUrl,
      environmentName: environment.name,
    );
  }

  if (!environment.allowsBackendOverride) {
    throw StateError(
      'El entorno "${environment.name}" no admite BACKEND_BASE_URL_OVERRIDE '
      '— política de entorno (AppEnvironment.allowsBackendOverride == '
      'false), no un problema de formato de la URL recibida ("$trimmedOverride"). '
      'Producción nunca acepta un backend distinto al definido en '
      'environment_production.dart, sin excepción. Quita la variable de '
      'entorno/--dart-define para compilar este entorno, o usa un entorno '
      'que sí permita override (Development).',
    );
  }

  return _validated(trimmedOverride, environmentName: environment.name);
}

String _validated(String url, {required String environmentName}) {
  final Uri? parsed = Uri.tryParse(url);
  final bool hasValidScheme =
      parsed != null && (parsed.scheme == 'http' || parsed.scheme == 'https');
  final bool hasHost = parsed != null && parsed.host.isNotEmpty;

  if (url.isEmpty || parsed == null || !hasValidScheme || !hasHost) {
    throw StateError(
      'backendBaseUrl inválida para el entorno "$environmentName": "$url". '
      'Debe ser una URL http/https con host (p. ej. "http://localhost:3000/v1"). '
      'No se aplica ninguna corrección automática — corrige '
      'BACKEND_BASE_URL_OVERRIDE o el valor definido en el archivo de '
      'entorno correspondiente.',
    );
  }
  return url;
}

/// Valor por defecto de `AppEnvironment.backendBaseUrl` mientras un
/// entorno no tenga un backend real desplegado — mismo cálculo
/// platform-aware que ya usaba el antiguo `ApiConfig.backendBaseUrl`
/// (eliminado en este mismo bloque), para no cambiar el comportamiento
/// observable de ningún entry point respecto a lo que ya hacía hoy.
///
/// Deliberadamente NO se hardcodea ninguna URL de un backend real
/// (Cloud Run u otro) en `environment_development.dart`/
/// `environment_production.dart` — verificar y wirear esa URL real es una
/// decisión de infraestructura aparte, fuera del alcance de este bloque
/// de reconciliación de código, y requiere su propia autorización
/// explícita antes de cambiar el valor por defecto de cualquier entorno.
String defaultLocalBackendBaseUrl() {
  if (kIsWeb) return 'http://localhost:3000/v1';
  // El emulador de Android no resuelve "localhost" como la propia
  // máquina host — 10.0.2.2 es el alias especial que sí lo hace.
  if (defaultTargetPlatform == TargetPlatform.android) {
    return 'http://10.0.2.2:3000/v1';
  }
  return 'http://localhost:3000/v1';
}
