import 'package:firebase_auth/firebase_auth.dart';
import 'package:dio/dio.dart';
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

  static Failure handle(Object error) {
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
    return UnexpectedFailure(error.toString());
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
        return ServerFailure(
          error.response?.data?['message']?.toString() ??
              'Error al comunicarse con el servidor.',
        );
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
