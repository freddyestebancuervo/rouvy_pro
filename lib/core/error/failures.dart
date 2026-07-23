import 'package:equatable/equatable.dart';

import '../health/health_permission_status.dart';

/// Clase base de todos los errores de dominio (capa domain).
///
/// A diferencia de las [Exception]s (que pertenecen a la capa data/infra),
/// los [Failure] son el tipo de error que cruza hacia la capa de presentación,
/// siempre a través de un `Either<Failure, T>`. Esto evita que la UI dependa
/// de excepciones específicas de Firebase, Dio, etc.
abstract class Failure extends Equatable {
  const Failure(this.message);

  final String message;

  @override
  List<Object?> get props => [message];
}

/// Error de autenticación (credenciales inválidas, usuario no encontrado, etc.)
class AuthFailure extends Failure {
  const AuthFailure(super.message);
}

/// Error de red (sin conexión, timeout).
class NetworkFailure extends Failure {
  const NetworkFailure([super.message = 'No hay conexión a internet.']);
}

/// Error del servidor (Firestore, Cloud Functions, API propia).
class ServerFailure extends Failure {
  const ServerFailure([super.message = 'Error del servidor. Intenta de nuevo.']);
}

/// Error de caché/almacenamiento local.
class CacheFailure extends Failure {
  const CacheFailure([super.message = 'Error al leer datos locales.']);
}

/// Error de validación de datos de entrada (formularios, etc.)
class ValidationFailure extends Failure {
  const ValidationFailure(super.message);
}

/// El recurso solicitado no existe o no es accesible para el usuario
/// actual (`404` del backend propio — p. ej. `WORKOUT_NOT_FOUND`). El
/// backend usa deliberadamente 404 tanto para "no existe" como para "no es
/// tuyo" (ver `assertOwned`), así que la UI no distingue esos dos casos.
class NotFoundFailure extends Failure {
  const NotFoundFailure([super.message = 'No se encontró el recurso solicitado.']);
}

/// La operación no se puede completar por el estado actual del recurso
/// (`409` del backend propio — p. ej. `WORKOUT_ARCHIVED`: no se puede
/// editar algo ya archivado). Distinto de [ValidationFailure] (datos mal
/// formados) y de [ServerFailure] (fallo genérico).
class ConflictFailure extends Failure {
  const ConflictFailure([super.message = 'La operación no se puede completar en el estado actual.']);
}

/// Error genérico no anticipado — se usa como último recurso en el
/// manejador centralizado de errores, nunca debería mostrarse tal cual al
/// usuario sin pasar antes por un mensaje amigable.
class UnexpectedFailure extends Failure {
  const UnexpectedFailure([super.message = 'Ocurrió un error inesperado.']);
}

/// Error del módulo de wearables (HealthKit/Health Connect) — conserva
/// [status] para que la UI pueda mostrar una acción de recuperación
/// distinta (reintentar / abrir ajustes / instalar Health Connect) en vez
/// de un botón genérico de "reintentar" que no serviría para los casos de
/// "no instalado" o "denegado permanentemente".
class HealthFailure extends Failure {
  const HealthFailure(super.message, {required this.status});

  final HealthPermissionStatus status;
}
