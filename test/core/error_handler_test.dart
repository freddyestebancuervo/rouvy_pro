import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:rouvy_pro/core/error/error_handler.dart';
import 'package:rouvy_pro/core/error/exceptions.dart';
import 'package:rouvy_pro/core/error/failures.dart';

void main() {
  group('AppErrorHandler', () {
    test('traduce FirebaseAuthException(wrong-password) a AuthFailure en español', () {
      final FirebaseAuthException exception = FirebaseAuthException(code: 'wrong-password');

      final Failure failure = AppErrorHandler.handle(exception);

      expect(failure, isA<AuthFailure>());
      expect(failure.message, 'Correo o contraseña incorrectos.');
    });

    test('traduce FirebaseAuthException(email-already-in-use) correctamente', () {
      final FirebaseAuthException exception =
          FirebaseAuthException(code: 'email-already-in-use');

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
  });
}
