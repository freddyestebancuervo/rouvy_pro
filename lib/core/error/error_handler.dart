import 'package:firebase_auth/firebase_auth.dart';
import 'package:dio/dio.dart';
import 'package:firebase_crashlytics/firebase_crashlytics.dart';
import 'package:flutter/services.dart';
import 'package:sign_in_with_apple/sign_in_with_apple.dart';

import 'exceptions.dart';
import 'failures.dart';

/// Punto único de traducción de errores de infraestructura → [Failure] de
/// dominio.
///
/// Por qué existe: sin esto, cada `repository` tendría su propio switch de
/// `try/catch` con mensajes distintos para el mismo tipo de error, y la UI
/// terminaría mostrando mensajes de Firebase en crudo (en inglés, poco
/// amigables) o crasheando ante excepciones no capturadas.
///
/// Uso típico dentro de un repositorio:
/// ```dart
/// try {
///   final user = await remoteDataSource.login(email, password);
///   return Right(user);
/// } catch (e) {
///   return Left(AppErrorHandler.handle(e));
/// }
/// ```
class AppErrorHandler {
  const AppErrorHandler._();

  /// [stackTrace] es opcional para no obligar a cambiar cada `catch (e)`
  /// existente en los repositorios a `catch (e, stackTrace)` — si no se
  /// provee, se usa `StackTrace.current` (el punto de esta llamada,
  /// suficientemente cercano al `catch` real ya que la conversión ocurre
  /// de forma síncrona). Solo se usa para el registro técnico del branch
  /// no clasificado (ver abajo) — los errores ya clasificados no lo
  /// necesitan, no son bugs, son casos de dominio esperados.
  static Failure handle(Object error, [StackTrace? stackTrace]) {
    if (error is FirebaseAuthException) {
      return AuthFailure(_mapFirebaseAuthMessage(error.code));
    }
    if (error is AuthException) {
      // 'sign-in-cancelled' se usa para que la UI pueda, si quiere,
      // ignorar el mensaje en vez de mostrarlo como error (el usuario
      // simplemente cerró el selector de cuentas).
      return AuthFailure(error.message);
    }
    if (error is HealthException) {
      return HealthFailure(error.message, status: error.status);
    }
    if (error is SignInWithAppleAuthorizationException) {
      return AuthFailure(_mapAppleErrorMessage(error.code));
    }
    if (error is PlatformException) {
      // google_sign_in lanza PlatformException con code 'sign_in_canceled'
      // cuando el usuario cierra el selector de Google sin elegir cuenta.
      if (error.code == 'sign_in_canceled') {
        return const AuthFailure('Inicio de sesión cancelado.');
      }
      return const AuthFailure('No se pudo completar el inicio de sesión.');
    }
    if (error is DioException) {
      return _mapDioError(error);
    }
    if (error is NetworkException) {
      return const NetworkFailure();
    }
    if (error is ServerException) {
      return ServerFailure(error.message);
    }
    if (error is CacheException) {
      return CacheFailure(error.message);
    }

    // Error verdaderamente no clasificado (bug/excepción no anticipada) —
    // el único punto de este manejador que podía perder información
    // técnica al convertir a un `Failure` de dominio (Documento de
    // auditoría "MVP Fase 0.1", saneamiento del fallback). Se registra el
    // error ORIGINAL + stack trace para diagnóstico técnico — nunca se
    // expone al usuario. `core/` no depende de `AppLocalizations` (eso
    // acoplaría esta capa a `presentation`, que no tiene `BuildContext`
    // aquí) — se usa el mensaje seguro que `UnexpectedFailure` ya trae
    // por defecto, no un `error.toString()` crudo.
    try {
      FirebaseCrashlytics.instance.recordError(
        error,
        stackTrace ?? StackTrace.current,
        fatal: false,
      );
    } catch (_) {
      // El registro es best-effort: si Crashlytics no está disponible
      // (p. ej. en pruebas sin Firebase inicializado), el manejo del
      // error original no debe verse afectado ni interrumpirse.
    }
    return const UnexpectedFailure();
  }

  static String _mapAppleErrorMessage(AuthorizationErrorCode code) {
    switch (code) {
      case AuthorizationErrorCode.canceled:
        return 'Inicio de sesión cancelado.';
      case AuthorizationErrorCode.failed:
      case AuthorizationErrorCode.invalidResponse:
      case AuthorizationErrorCode.notHandled:
      case AuthorizationErrorCode.notInteractive:
      case AuthorizationErrorCode.unknown:
        return 'No se pudo iniciar sesión con Apple. Intenta de nuevo.';
    }
  }

  static Failure _mapDioError(DioException error) {
    switch (error.type) {
      case DioExceptionType.connectionTimeout:
      case DioExceptionType.receiveTimeout:
      case DioExceptionType.sendTimeout:
      case DioExceptionType.connectionError:
        return const NetworkFailure();
      default:
        return _mapBackendResponse(error);
    }
  }

  /// El backend propio (NestJS, `ApiExceptionFilter`) responde siempre con
  /// el sobre `{ error: { code, message, requestId, details } }` — distinto
  /// del `{ message }` plano que algunas respuestas de Firebase/Firestore
  /// podían traer. Se lee `error.message` primero y solo se cae a
  /// `data['message']` (formato antiguo, por si alguna llamada no-backend
  /// pasara por acá) o a un texto genérico si no hay nada usable.
  static Failure _mapBackendResponse(DioException error) {
    final dynamic data = error.response?.data;
    final Map<String, dynamic>? envelope = (data is Map && data['error'] is Map)
        ? (data['error'] as Map).cast<String, dynamic>()
        : null;
    final String message = (envelope?['message'] as String?) ??
        (data is Map ? data['message']?.toString() : null) ??
        'Error al comunicarse con el servidor.';

    switch (error.response?.statusCode) {
      case 401:
        return AuthFailure(message);
      case 404:
        return NotFoundFailure(message);
      case 409:
        return ConflictFailure(message);
      case 400:
        return ValidationFailure(message);
      default:
        return ServerFailure(message);
    }
  }

  /// Traduce los códigos de error de Firebase Auth a mensajes en español,
  /// pensados para mostrarse directamente en la UI.
  static String _mapFirebaseAuthMessage(String code) {
    switch (code) {
      case 'user-not-found':
        return 'No existe una cuenta con ese correo.';
      case 'wrong-password':
      case 'invalid-credential':
        return 'Correo o contraseña incorrectos.';
      case 'email-already-in-use':
        return 'Ya existe una cuenta con ese correo.';
      case 'weak-password':
        return 'La contraseña es demasiado débil.';
      case 'invalid-email':
        return 'El correo electrónico no es válido.';
      case 'user-disabled':
        return 'Esta cuenta ha sido deshabilitada.';
      case 'too-many-requests':
        return 'Demasiados intentos. Intenta más tarde.';
      case 'network-request-failed':
        return 'Sin conexión a internet.';
      default:
        return 'No se pudo completar la operación. Intenta de nuevo.';
    }
  }
}
