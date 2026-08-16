import 'package:dio/dio.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:rouvy_pro/core/error/error_handler.dart';
import 'package:rouvy_pro/core/error/exceptions.dart';
import 'package:rouvy_pro/core/error/failures.dart';

/// Excepción de prueba cuyo `toString()` revela deliberadamente detalles
/// internos — simula el tipo de excepción no clasificada que, antes de la
/// corrección de `AppErrorHandler`, terminaba filtrándose como mensaje de
/// usuario vía `UnexpectedFailure(error.toString())`.
class _RevealingTestException implements Exception {
  @override
  String toString() => 'Exception: secreto-interno-no-mostrar (RevealingTestException)';
}

DioException _dioErrorWithEnvelope(int statusCode, Map<String, dynamic> errorEnvelope) {
  final RequestOptions requestOptions = RequestOptions(path: '/workouts');
  return DioException(
    requestOptions: requestOptions,
    type: DioExceptionType.badResponse,
    response: Response<dynamic>(
      requestOptions: requestOptions,
      statusCode: statusCode,
      data: <String, dynamic>{'error': errorEnvelope},
    ),
  );
}

void main() {
  group('AppErrorHandler', () {
    test('traduce FirebaseAuthException(wrong-password) a AuthFailure en español', () {
      final FirebaseAuthException exception = FirebaseAuthException(code: 'wrong-password');

      final Failure failure = AppErrorHandler.handle(exception);

      expect(failure, isA<AuthFailure>());
      expect(failure.message, 'Correo o contraseña incorrectos.');
    });

    test('traduce FirebaseAuthException(email-already-in-use) correctamente', () {
      final FirebaseAuthException exception = FirebaseAuthException(code: 'email-already-in-use');

      final Failure failure = AppErrorHandler.handle(exception);

      expect(failure, isA<AuthFailure>());
      expect(failure.message, 'Ya existe una cuenta con ese correo.');
    });

    test('traduce NetworkException a NetworkFailure', () {
      const NetworkException exception = NetworkException();

      final Failure failure = AppErrorHandler.handle(exception);

      expect(failure, isA<NetworkFailure>());
    });

    test('traduce un error desconocido a UnexpectedFailure sin lanzar excepción', () {
      final Object error = Exception('boom');

      final Failure failure = AppErrorHandler.handle(error);

      expect(failure, isA<UnexpectedFailure>());
    });

    test(
      'un error desconocido nunca expone su texto original ni detalles técnicos en el mensaje',
      () {
        // Excepción deliberadamente "reveladora" en su toString() — simula
        // exactamente el caso que originaba "minified:DJ" en Web release.
        final Object revealingError = _RevealingTestException();

        final Failure failure = AppErrorHandler.handle(revealingError);

        expect(failure, isA<UnexpectedFailure>());
        expect(failure.message, 'Ocurrió un error inesperado.');
        expect(failure.message, isNot(contains('RevealingTestException')));
        expect(failure.message, isNot(contains('secreto-interno-no-mostrar')));
        expect(failure.message, isNot(contains('Exception')));
        expect(failure.message, isNot(contains('Instance of')));
        expect(failure.message, isNot(contains('minified')));
      },
    );

    test(
      'no lanza excepción aunque el registro técnico (Crashlytics) no esté disponible '
      '— el sistema sigue funcionando (VM de pruebas, sin Firebase inicializado)',
      () {
        expect(
          () => AppErrorHandler.handle(Exception('boom sin Firebase inicializado')),
          returnsNormally,
        );
      },
    );

    test('acepta un StackTrace explícito para el registro técnico sin cambiar el resultado', () {
      final Failure failure = AppErrorHandler.handle(Exception('boom'), StackTrace.current);

      expect(failure, isA<UnexpectedFailure>());
      expect(failure.message, 'Ocurrió un error inesperado.');
    });

    // --- Sobre de error del backend propio (NestJS, ApiExceptionFilter):
    // `{ error: { code, message, requestId, details } }` — usado por
    // Equipment (D1) y Workouts (D2).

    test('traduce un 404 con el sobre del backend a NotFoundFailure con el mensaje real', () {
      final DioException exception = _dioErrorWithEnvelope(404, <String, dynamic>{
        'code': 'WORKOUT_NOT_FOUND',
        'message': 'El entrenamiento solicitado no existe.',
      });

      final Failure failure = AppErrorHandler.handle(exception);

      expect(failure, isA<NotFoundFailure>());
      expect(failure.message, 'El entrenamiento solicitado no existe.');
    });

    test('traduce un 409 con el sobre del backend a ConflictFailure con el mensaje real', () {
      final DioException exception = _dioErrorWithEnvelope(409, <String, dynamic>{
        'code': 'WORKOUT_ARCHIVED',
        'message': 'Este entrenamiento está archivado y no se puede editar.',
      });

      final Failure failure = AppErrorHandler.handle(exception);

      expect(failure, isA<ConflictFailure>());
      expect(failure.message, 'Este entrenamiento está archivado y no se puede editar.');
    });

    test('traduce un 401 con el sobre del backend a AuthFailure', () {
      final DioException exception = _dioErrorWithEnvelope(401, <String, dynamic>{
        'code': 'AUTH_TOKEN_MISSING_OR_INVALID',
        'message': 'Token inválido o ausente.',
      });

      final Failure failure = AppErrorHandler.handle(exception);

      expect(failure, isA<AuthFailure>());
      expect(failure.message, 'Token inválido o ausente.');
    });

    test('traduce un 400 con el sobre del backend a ValidationFailure', () {
      final DioException exception = _dioErrorWithEnvelope(400, <String, dynamic>{
        'code': 'WORKOUT_INVALID_INTERVALS',
        'message': 'targetLow no puede ser mayor que targetHigh.',
      });

      final Failure failure = AppErrorHandler.handle(exception);

      expect(failure, isA<ValidationFailure>());
      expect(failure.message, 'targetLow no puede ser mayor que targetHigh.');
    });

    test('traduce un 500 sin sobre reconocible a ServerFailure con mensaje genérico', () {
      final RequestOptions requestOptions = RequestOptions(path: '/workouts');
      final DioException exception = DioException(
        requestOptions: requestOptions,
        type: DioExceptionType.badResponse,
        response: Response<dynamic>(requestOptions: requestOptions, statusCode: 500, data: null),
      );

      final Failure failure = AppErrorHandler.handle(exception);

      expect(failure, isA<ServerFailure>());
      expect(failure.message, 'Error al comunicarse con el servidor.');
    });

    test('traduce un DioException de connectionTimeout a NetworkFailure', () {
      final DioException exception = DioException(
        requestOptions: RequestOptions(path: '/workouts'),
        type: DioExceptionType.connectionTimeout,
      );

      final Failure failure = AppErrorHandler.handle(exception);

      expect(failure, isA<NetworkFailure>());
    });
  });
}
