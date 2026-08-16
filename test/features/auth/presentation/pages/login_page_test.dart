import 'dart:async';

import 'package:dartz/dartz.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'package:rouvy_pro/core/error/failures.dart';
import 'package:rouvy_pro/features/auth/domain/entities/user_entity.dart';
import 'package:rouvy_pro/features/auth/domain/usecases/login_usecase.dart';
import 'package:rouvy_pro/features/auth/domain/usecases/sign_in_with_apple_usecase.dart';
import 'package:rouvy_pro/features/auth/domain/usecases/sign_in_with_google_usecase.dart';
import 'package:rouvy_pro/features/auth/presentation/pages/login_page.dart';
import 'package:rouvy_pro/features/auth/presentation/providers/auth_providers.dart';

import 'auth_page_test_utils.dart';

void main() {
  late MockAuthRepository repository;

  setUp(() {
    repository = MockAuthRepository();
  });

  List<Override> overridesFor(MockAuthRepository repo) => <Override>[
        loginUseCaseProvider.overrideWithValue(LoginUseCase(repo)),
        signInWithGoogleUseCaseProvider.overrideWithValue(SignInWithGoogleUseCase(repo)),
        signInWithAppleUseCaseProvider.overrideWithValue(SignInWithAppleUseCase(repo)),
      ];

  Future<void> pumpLoginPage(WidgetTester tester, MockAuthRepository repo) async {
    await tester.pumpWidget(
      authPageHarness(
        initialLocation: '/login',
        loginPage: const LoginPage(),
        overrides: overridesFor(repo),
      ),
    );
    await tester.pumpAndSettle();
  }

  testWidgets('no envía el formulario ni llama al repositorio si los campos están vacíos',
      (WidgetTester tester) async {
    await pumpLoginPage(tester, repository);

    await tester.tap(find.text('Iniciar sesión'));
    await tester.pumpAndSettle();

    expect(find.text('Ingresa tu correo electrónico'), findsOneWidget);
    expect(find.text('Ingresa tu contraseña'), findsOneWidget);
    verifyNever(
      () => repository.login(email: any(named: 'email'), password: any(named: 'password')),
    );
  });

  testWidgets('muestra un spinner y deshabilita el botón mientras el login está en curso',
      (WidgetTester tester) async {
    final Completer<Either<Failure, UserEntity>> pending = Completer<Either<Failure, UserEntity>>();
    when(() => repository.login(email: any(named: 'email'), password: any(named: 'password')))
        .thenAnswer((_) => pending.future);

    await pumpLoginPage(tester, repository);

    await tester.enterText(find.byType(TextFormField).at(0), 'rider@ridepro.com');
    await tester.enterText(find.byType(TextFormField).at(1), 'securePass123');
    await tester.tap(find.text('Iniciar sesión'));
    await tester.pump();

    expect(find.byType(CircularProgressIndicator), findsOneWidget);

    final ElevatedButton button = tester.widget(find.byType(ElevatedButton).first);
    expect(button.onPressed, isNull);

    pending.complete(const Left<Failure, UserEntity>(AuthFailure('no importa, se limpia abajo')));
    await tester.pumpAndSettle();
  });

  testWidgets('navega a Home cuando el login es exitoso', (WidgetTester tester) async {
    when(() => repository.login(email: 'rider@ridepro.com', password: 'securePass123'))
        .thenAnswer((_) async => const Right(tUser));

    await pumpLoginPage(tester, repository);

    await tester.enterText(find.byType(TextFormField).at(0), 'rider@ridepro.com');
    await tester.enterText(find.byType(TextFormField).at(1), 'securePass123');
    await tester.tap(find.text('Iniciar sesión'));
    await tester.pumpAndSettle();

    expect(find.text('HOME'), findsOneWidget);
  });

  testWidgets('muestra un SnackBar con el mensaje de error cuando el login falla',
      (WidgetTester tester) async {
    const AuthFailure failure = AuthFailure('Correo o contraseña incorrectos.');
    when(() => repository.login(email: 'rider@ridepro.com', password: 'wrongPass1'))
        .thenAnswer((_) async => const Left(failure));

    await pumpLoginPage(tester, repository);

    await tester.enterText(find.byType(TextFormField).at(0), 'rider@ridepro.com');
    await tester.enterText(find.byType(TextFormField).at(1), 'wrongPass1');
    await tester.tap(find.text('Iniciar sesión'));
    await tester.pumpAndSettle();

    expect(find.text('Correo o contraseña incorrectos.'), findsOneWidget);
    expect(find.text('HOME'), findsNothing);
  });

  testWidgets('el botón de Google Sign-In navega a Home cuando el proveedor social tiene éxito',
      (WidgetTester tester) async {
    when(() => repository.signInWithGoogle()).thenAnswer((_) async => const Right(tUser));

    await pumpLoginPage(tester, repository);

    await tester.tap(find.byType(OutlinedButton).first);
    await tester.pumpAndSettle();

    expect(find.text('HOME'), findsOneWidget);
  });

  testWidgets('muestra un SnackBar cuando Google Sign-In falla', (WidgetTester tester) async {
    const AuthFailure failure = AuthFailure('No se pudo iniciar sesión con Google.');
    when(() => repository.signInWithGoogle()).thenAnswer((_) async => const Left(failure));

    await pumpLoginPage(tester, repository);

    await tester.tap(find.byType(OutlinedButton).first);
    await tester.pumpAndSettle();

    expect(find.text('No se pudo iniciar sesión con Google.'), findsOneWidget);
    expect(find.text('HOME'), findsNothing);
  });
}
