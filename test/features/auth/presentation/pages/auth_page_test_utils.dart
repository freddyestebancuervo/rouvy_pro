import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:mocktail/mocktail.dart';

import 'package:rouvy_pro/app/router/app_router.dart';
import 'package:rouvy_pro/features/auth/domain/entities/user_entity.dart';
import 'package:rouvy_pro/features/auth/domain/repositories/auth_repository.dart';
import 'package:rouvy_pro/l10n/generated/app_localizations.dart';

/// Utilidades compartidas por las pruebas de widgets de Login/Registro/
/// Recuperación de contraseña. No termina en `_test.dart` a propósito —
/// `flutter test` solo ejecuta archivos con ese sufijo como suites, así
/// que este helper no se corre como test vacío.
class MockAuthRepository extends Mock implements AuthRepository {}

const UserEntity tUser = UserEntity(id: 'u1', email: 'rider@ridepro.com', displayName: 'Rider');

Widget _placeholder(String label) => Scaffold(body: Center(child: Text(label)));

/// Envuelve la página bajo prueba en un `GoRouter` mínimo (solo las rutas
/// de auth + Home) para poder ejercitar `context.go`/`context.push` sin
/// depender de `routerProvider` real (que requiere Firebase inicializado
/// vía GetIt) ni de las reglas de redirección de `redirect:` — esas ya
/// están cubiertas por `test/navigation/demo_navigation_test.dart`.
Widget authPageHarness({
  required String initialLocation,
  Widget? welcomePage,
  Widget? loginPage,
  Widget? registerPage,
  Widget? forgotPasswordPage,
  List<Override> overrides = const <Override>[],
  // KORIXA-UI-SCREEN-BATCH-01A: permite forzar el tema AMBIENTE del
  // `MaterialApp` (el que rodea a la página, no el `AppTheme.darkTech`
  // que `DarkTechAuthShell` inserta localmente) — necesario para probar
  // que la tipografía explícita de Welcome/Login/Register sigue
  // resolviendo Dark Tech incluso cuando el modo global de la app es
  // claro. `null` deja el valor por defecto de `MaterialApp`.
  ThemeData? theme,
}) {
  final GoRouter router = GoRouter(
    initialLocation: initialLocation,
    routes: <RouteBase>[
      GoRoute(path: AppRoute.welcome, builder: (_, __) => welcomePage ?? _placeholder('WELCOME')),
      GoRoute(path: AppRoute.login, builder: (_, __) => loginPage ?? _placeholder('LOGIN')),
      GoRoute(
        path: AppRoute.register,
        builder: (_, __) => registerPage ?? _placeholder('REGISTER'),
      ),
      GoRoute(
        path: AppRoute.forgotPassword,
        builder: (_, __) => forgotPasswordPage ?? _placeholder('FORGOT_PASSWORD'),
      ),
      GoRoute(
        path: AppRoute.emailVerification,
        builder: (_, __) => _placeholder('EMAIL_VERIFICATION'),
      ),
      GoRoute(path: AppRoute.home, builder: (_, __) => _placeholder('HOME')),
    ],
  );

  return ProviderScope(
    overrides: overrides,
    child: MaterialApp.router(
      routerConfig: router,
      theme: theme,
      locale: const Locale('es'),
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      supportedLocales: AppLocalizations.supportedLocales,
    ),
  );
}
