/// Excepciones de la capa `data`. Se lanzan dentro de los `datasources`
/// (Firebase, APIs REST, base de datos local) y **nunca** deben llegar a la
/// capa `domain` o `presentation` — el `repository` las captura y las
/// traduce a un [Failure] mediante `AppErrorHandler`.
library;

import '../health/health_permission_status.dart';

class ServerException implements Exception {
  const ServerException([this.message = 'Error del servidor.']);
  final String message;
}

class AuthException implements Exception {
  const AuthException(this.message, {this.code});
  final String message;
  final String? code;
}

class CacheException implements Exception {
  const CacheException([this.message = 'Error de almacenamiento local.']);
  final String message;
}

class NetworkException implements Exception {
  const NetworkException([this.message = 'Sin conexión a internet.']);
  final String message;
}

/// Lanzada por los adapters de `features/wearables` (HealthKit/Health
/// Connect) cuando el permiso de salud no está concedido — [status]
/// conserva el motivo exacto para que `AppErrorHandler` y la UI puedan
/// distinguir "denegado, reintentable" de "denegado permanentemente" o
/// "no instalado", en vez de colapsar todo a un mensaje genérico.
class HealthException implements Exception {
  const HealthException(this.message, {required this.status});
  final String message;
  final HealthPermissionStatus status;
}
