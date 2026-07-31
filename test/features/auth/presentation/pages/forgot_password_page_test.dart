import 'package:dartz/dartz.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'package:rouvy_pro/core/error/failures.dart';
import 'package:rouvy_pro/features/auth/domain/usecases/send_password_reset_usecase.dart';
import 'package:rouvy_pro/features/auth/presentation/pages/forgot_password_page.dart';
import 'package:rouvy_pro/features/auth/presentation/providers/auth_providers.dart';

import 'auth_page_test_utils.dart';

void main() {
  late MockAuthRepository repository;

  setUp(() {
    repository = MockAuthRepository();
  });

  Future<void> pumpForgotPasswordPage(WidgetTester tester, MockAuthRepository repo) async {
    await tester.pumpWidget(
      authPageHarness(
        initialLocation: '/forgot-password',
        forgotPasswordPage: const ForgotPasswordPage(),
        overrides: <Override>[
          sendPasswordResetUseCaseProvider.overrideWithValue(SendPasswordResetUseCase(repo)),
        ],
      ),
    );
    await tester.pumpAndSettle();
  }

  testWidgets('no envía el formulario si el correo está vacío o es inválido',
      (WidgetTester tester) async {
    await pumpForgotPasswordPage(tester, repository);

    await tester.tap(find.text('Enviar enlace'));
    await tester.pumpAndSettle();

    expect(find.text('Ingresa tu correo electrónico'), findsOneWidget);
    verifyNever(() => repository.sendPasswordResetEmail(any()));
  });

  testWidgets('muestra un spinner mientras se envía el correo de recuperación',
      (WidgetTester tester) async {
    when(() => repository.sendPasswordResetEmail(any())).thenAnswer((_) async {
      await Future<void>.delayed(const Duration(milliseconds: 200));
      return const Right<Failure, void>(null);
    });

    await pumpForgotPasswordPage(tester, repository);
    await tester.enterText(find.byType(TextFormField), 'rider@ridepro.com');
    await tester.tap(find.text('Enviar enlace'));
    await tester.pump();

    expect(find.byType(CircularProgressIndicator), findsOneWidget);

    await tester.pumpAndSettle();
  });

  testWidgets('muestra la confirmación de envío cuando la operación es exitosa',
      (WidgetTester tester) async {
    when(() => repository.sendPasswordResetEmail('rider@ridepro.com'))
        .thenAnswer((_) async => const Right<Failure, void>(null));

    await pumpForgotPasswordPage(tester, repository);
    await tester.enterText(find.byType(TextFormField), 'rider@ridepro.com');
    await tester.tap(find.text('Enviar enlace'));
    await tester.pumpAndSettle();

    expect(
      find.text('Revisa tu correo — te enviamos un enlace para restablecer tu contraseña.'),
      findsOneWidget,
    );
    expect(find.byType(TextFormField), findsNothing);
  });

  testWidgets('muestra un SnackBar con el mensaje de error cuando el envío falla',
      (WidgetTester tester) async {
    const AuthFailure failure = AuthFailure('No existe una cuenta con ese correo.');
    when(() => repository.sendPasswordResetEmail(any()))
        .thenAnswer((_) async => const Left(failure));

    await pumpForgotPasswordPage(tester, repository);
    await tester.enterText(find.byType(TextFormField), 'nadie@ridepro.com');
    await tester.tap(find.text('Enviar enlace'));
    await tester.pumpAndSettle();

    expect(find.text('No existe una cuenta con ese correo.'), findsOneWidget);
    // No debe haber avanzado a la pantalla de confirmación.
    expect(find.byType(TextFormField), findsOneWidget);
  });
}
