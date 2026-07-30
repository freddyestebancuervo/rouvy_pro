import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../features/auth/domain/entities/user_entity.dart';
import '../../features/auth/presentation/pages/email_verification_page.dart';
import '../../features/auth/presentation/pages/forgot_password_page.dart';
import '../../features/auth/presentation/pages/login_page.dart';
import '../../features/auth/presentation/pages/register_page.dart';
import '../../features/auth/presentation/pages/splash_page.dart';
import '../../features/auth/presentation/pages/welcome_page.dart';
import '../../features/auth/presentation/providers/auth_providers.dart';
import '../../features/achievements/presentation/pages/achievements_page.dart';
import '../../features/device_connection/presentation/pages/device_management_page.dart';
import '../../features/home/presentation/pages/home_page.dart';
import '../../features/profile/presentation/pages/profile_page.dart';
import '../../features/routes_catalog/presentation/pages/route_detail_page.dart';
import '../../features/routes_catalog/presentation/pages/routes_catalog_page.dart';
import '../../features/settings/presentation/pages/settings_page.dart';
import '../../features/training/presentation/pages/ride_history_page.dart';
import '../../features/training/presentation/pages/session_summary_page.dart';
import '../../features/training/presentation/pages/statistics_page.dart';
import '../../features/training/presentation/pages/training_hud_page.dart';
import '../../features/wearables/presentation/pages/wearables_page.dart';
import '../../features/workouts/presentation/pages/workout_detail_page.dart';
import '../../features/workouts/presentation/pages/workout_form_page.dart';
import '../../features/workouts/presentation/pages/workouts_list_page.dart';

/// Rutas nombradas — usar estas constantes en vez de strings sueltos evita
/// typos al navegar (`context.go(AppRoute.home)` en vez de `context.go('/home')`).
abstract class AppRoute {
  static const String splash = '/';
  static const String welcome = '/welcome';
  static const String login = '/login';
  static const String register = '/register';
  static const String forgotPassword = '/forgot-password';
  static const String emailVerification = '/verify-email';
  static const String home = '/home';
  static const String profile = '/profile';
  static const String devices = '/devices';
  static const String wearables = '/wearables';
  static const String training = '/training';
  static const String trainingSummary = '/training/summary';
  static const String rideHistory = '/history';
  static const String statistics = '/statistics';
  static const String achievements = '/achievements';
  static const String routesCatalog = '/routes';
  static const String workouts = '/workouts';
  static const String settings = '/settings';
}

/// El router se expone como provider para poder reaccionar al estado de
/// autenticación (`authStateProvider`) y redirigir automáticamente sin que
/// cada pantalla tenga que comprobarlo manualmente.
///
/// PROTECCIÓN DE RUTAS — reglas, en orden de evaluación:
/// 1. Mientras `authStateProvider` está cargando → forzar Splash.
/// 2. Sin sesión → solo se permite estar en welcome/login/register/forgot-password;
///    cualquier otra ruta redirige a Welcome.
/// 3. Con sesión pero correo sin verificar (solo aplica a cuentas
///    password — Google/Apple ya vienen verificadas) → forzar
///    EmailVerification; no puede navegar a ninguna otra parte de la app.
/// 4. Con sesión y verificado, si está en una pantalla de auth/splash →
///    redirige a Home.
final routerProvider = Provider<GoRouter>((Ref ref) {
  bool isAuthRoute(String location) => <String>[
        AppRoute.welcome,
        AppRoute.login,
        AppRoute.register,
        AppRoute.forgotPassword,
      ].contains(location);

  // `refreshListenable` (en vez de `ref.watch(authStateProvider)` arriba,
  // que reconstruiría el `GoRouter` entero) es a propósito: si el
  // `GoRouter` se reconstruyera por completo cada vez que cambia
  // `authStateProvider`, se perdería el stack de navegación y se
  // reiniciaría en `initialLocation` — incluyendo navegaciones EN CURSO
  // como `context.go('/login')`, que quedarían deshechas si el auth state
  // cambia (o simplemente se re-emite) en medio de la transición. Con un
  // único `GoRouter` de por vida, el notifier solo le pide reevaluar
  // `redirect` — que lee el estado ACTUAL vía `ref.read` en cada llamada,
  // nunca uno capturado en el momento de construir el router.
  final _RouterRefreshNotifier refresh = _RouterRefreshNotifier();
  ref.listen(authStateProvider, (_, __) => refresh.notify());
  ref.onDispose(refresh.dispose);

  return GoRouter(
    initialLocation: AppRoute.splash,
    debugLogDiagnostics: false,
    refreshListenable: refresh,
    redirect: (BuildContext context, GoRouterState state) {
      final String location = state.matchedLocation;
      final AsyncValue<UserEntity?> authState = ref.read(authStateProvider);

      // 1. Estado inicial aún resolviéndose.
      if (authState.isLoading) {
        return location == AppRoute.splash ? null : AppRoute.splash;
      }

      final UserEntity? user = authState.valueOrNull;

      // 2. Sin sesión.
      if (user == null) {
        return isAuthRoute(location) ? null : AppRoute.welcome;
      }

      // 3. Con sesión, correo pendiente de verificar.
      if (user.requiresEmailVerification) {
        return location == AppRoute.emailVerification ? null : AppRoute.emailVerification;
      }

      // 4. Con sesión y verificado: fuera de pantallas de auth/splash/verify.
      final bool onEntryPoint =
          isAuthRoute(location) || location == AppRoute.splash || location == AppRoute.emailVerification;
      if (onEntryPoint) return AppRoute.home;

      return null; // sin redirección — ruta protegida y accesible
    },
    routes: <RouteBase>[
      GoRoute(
        path: AppRoute.splash,
        builder: (BuildContext context, GoRouterState state) => const SplashPage(),
      ),
      GoRoute(
        path: AppRoute.welcome,
        builder: (BuildContext context, GoRouterState state) => const WelcomePage(),
      ),
      GoRoute(
        path: AppRoute.login,
        builder: (BuildContext context, GoRouterState state) => const LoginPage(),
      ),
      GoRoute(
        path: AppRoute.register,
        builder: (BuildContext context, GoRouterState state) => const RegisterPage(),
      ),
      GoRoute(
        path: AppRoute.forgotPassword,
        builder: (BuildContext context, GoRouterState state) => const ForgotPasswordPage(),
      ),
      GoRoute(
        path: AppRoute.emailVerification,
        builder: (BuildContext context, GoRouterState state) => const EmailVerificationPage(),
      ),
      GoRoute(
        path: AppRoute.home,
        builder: (BuildContext context, GoRouterState state) => const HomePage(),
      ),
      GoRoute(
        path: AppRoute.profile,
        builder: (BuildContext context, GoRouterState state) => const ProfilePage(),
      ),
      GoRoute(
        path: AppRoute.devices,
        builder: (BuildContext context, GoRouterState state) => const DeviceManagementPage(),
      ),
      GoRoute(
        path: AppRoute.wearables,
        builder: (BuildContext context, GoRouterState state) => const WearablesPage(),
      ),
      GoRoute(
        path: AppRoute.training,
        builder: (BuildContext context, GoRouterState state) => const TrainingHudPage(),
      ),
      GoRoute(
        path: AppRoute.trainingSummary,
        builder: (BuildContext context, GoRouterState state) => const SessionSummaryPage(),
      ),
      GoRoute(
        path: AppRoute.rideHistory,
        builder: (BuildContext context, GoRouterState state) => const RideHistoryPage(),
      ),
      GoRoute(
        path: AppRoute.statistics,
        builder: (BuildContext context, GoRouterState state) => const StatisticsPage(),
      ),
      GoRoute(
        path: AppRoute.achievements,
        builder: (BuildContext context, GoRouterState state) => const AchievementsPage(),
      ),
      GoRoute(
        path: AppRoute.routesCatalog,
        builder: (BuildContext context, GoRouterState state) => const RoutesCatalogPage(),
        routes: <RouteBase>[
          GoRoute(
            // Sub-ruta relativa: la URL completa queda `/routes/:routeId`.
            path: ':routeId',
            builder: (BuildContext context, GoRouterState state) {
              final String routeId = state.pathParameters['routeId']!;
              return RouteDetailPage(routeId: routeId);
            },
          ),
        ],
      ),
      GoRoute(
        path: AppRoute.workouts,
        builder: (BuildContext context, GoRouterState state) => const WorkoutsListPage(),
        routes: <RouteBase>[
          GoRoute(
            path: 'new',
            builder: (BuildContext context, GoRouterState state) => const WorkoutFormPage(workoutId: null),
          ),
          GoRoute(
            // Sub-ruta relativa: la URL completa queda `/workouts/:workoutId`.
            path: ':workoutId',
            builder: (BuildContext context, GoRouterState state) {
              final String workoutId = state.pathParameters['workoutId']!;
              return WorkoutDetailPage(workoutId: workoutId);
            },
            routes: <RouteBase>[
              GoRoute(
                path: 'edit',
                builder: (BuildContext context, GoRouterState state) {
                  final String workoutId = state.pathParameters['workoutId']!;
                  return WorkoutFormPage(workoutId: workoutId);
                },
              ),
            ],
          ),
        ],
      ),
      GoRoute(
        path: AppRoute.settings,
        builder: (BuildContext context, GoRouterState state) => const SettingsPage(),
      ),
      // Los siguientes módulos (multijugador, retos, panel admin, etc.)
      // se añadirán aquí como sub-rutas o ShellRoute con una barra de
      // tabs cuando se implementen sus features correspondientes.
    ],
  );
});

/// Le indica a `GoRouter` que reevalúe `redirect` sin reconstruir el
/// router — ver el comentario en `routerProvider`.
class _RouterRefreshNotifier extends ChangeNotifier {
  void notify() => notifyListeners();
}
