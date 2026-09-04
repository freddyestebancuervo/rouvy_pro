import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:rouvy_pro/app/app.dart';
import 'package:rouvy_pro/demo/demo_injection.dart';
import 'package:rouvy_pro/demo/demo_overrides.dart';
import 'package:rouvy_pro/features/routes_catalog/presentation/pages/routes_catalog_page.dart';
import 'package:rouvy_pro/features/settings/presentation/providers/locale_provider.dart';

/// Test de navegación de extremo a extremo: arranca la app REAL
/// (`RideProApp`, el mismo widget de producción, con el mismo
/// `GoRouter`) pero con TODOS los repositorios que tocan
/// Firebase/BLE/Postgres reemplazados por los fakes de modo demo — ver
/// `lib/demo/demo_overrides.dart`. Si este test pasa, confirma que el
/// modo demo es realmente navegable de punta a punta, no solo que cada
/// pantalla individual renderiza en aislamiento.
void main() {
  setUp(() async {
    SharedPreferences.setMockInitialValues(<String, Object>{});
    await initDemoDependencyInjection();
  });

  testWidgets(
    'Bienvenida → Login (simulado) → Home → Catálogo de rutas → Detalle → volver',
    (WidgetTester tester) async {
      await tester.pumpWidget(
        ProviderScope(
          overrides: <Override>[
            ...buildDemoOverrides(),
            // Fuerza español para que las aserciones del test no dependan
            // del locale del sistema operativo donde corre `flutter test`.
            localeOverrideProvider.overrideWith(() => _FixedLocaleNotifier(const Locale('es'))),
          ],
          child: const RideProApp(),
        ),
      );

      // Splash → redirige a Welcome en cuanto authStateChanges emite
      // `null` (sin sesión) — ver el fix de `FakeAuthRepository` para que
      // esto no se quede colgado.
      await tester.pumpAndSettle();
      expect(find.text('Ya tengo cuenta'), findsOneWidget);

      // --- Welcome → Login ---
      await tester.tap(find.text('Ya tengo cuenta'));
      await tester.pumpAndSettle();
      expect(find.text('Bienvenido de nuevo'), findsOneWidget); // loginTitle

      // --- Login simulado ---
      final Finder textFields = find.byType(TextFormField);
      expect(textFields, findsNWidgets(2));
      await tester.enterText(textFields.at(0), 'demo@ridepro.app');
      await tester.enterText(textFields.at(1), 'cualquier-cosa');

      await tester.tap(find.text('Iniciar sesión'));
      // El fake simula latencia de red (`Future.delayed`) — `pumpAndSettle`
      // espera automáticamente a que se resuelva antes de continuar.
      await tester.pumpAndSettle();

      // --- Debe aterrizar en Home ---
      expect(find.text('Ya tengo cuenta'), findsNothing); // ya no está en Welcome/Login
      expect(find.textContaining('Ciclista Demo'), findsWidgets); // displayName del fixture

      // --- Home → Catálogo de rutas ---
      await tester.tap(find.text('Rutas recomendadas'));
      await tester.pumpAndSettle();
      expect(find.byType(RoutesCatalogPage), findsOneWidget);

      // --- Catálogo → Detalle de una ruta ---
      // KORIXA-MVP-VERTICAL-SLICE-01A — "Alpe d'Huez" es
      // `RouteContentType.video` (sin contenido de video real detrás) y,
      // desde este fix, ya NO expone un botón de inicio activo (aviso
      // "Próximamente" en su lugar — ver `RouteDetailPage`). Se navega en
      // su lugar a la ruta MVP local (`RouteContentType.staticRoute`),
      // la única realmente entrenable hoy, para seguir probando el flujo
      // completo de punta a punta con un botón real y activo.
      // Es la 7ª (última) entrada del catálogo — `GridView.builder` no la
      // construye hasta que entra en viewport, así que hay que
      // desplazarse hasta ella antes de poder tocarla.
      await tester.scrollUntilVisible(
        find.text('Vuelta de prueba MVP'),
        200,
        scrollable: find.byType(Scrollable).first,
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('Vuelta de prueba MVP'));
      await tester.pumpAndSettle();
      expect(find.text('Entrenar esta ruta'), findsOneWidget);

      // --- Volver al catálogo ---
      // `tester.pageBack()` busca el botón por su tooltip en inglés
      // hardcodeado ("Back"), incompatible con el locale forzado a
      // español de este test — se busca por tipo de widget en su lugar,
      // agnóstico al idioma.
      await tester.tap(find.byType(BackButton));
      await tester.pumpAndSettle();
      expect(find.byType(RoutesCatalogPage), findsOneWidget);
    },
  );
}

/// Notifier de prueba que fija un locale constante sin tocar
/// `SharedPreferences` — evita que `LocaleOverrideNotifier._loadFromPrefs()`
/// (async, fuera del control del test) pise el locale forzado a mitad de
/// `pumpAndSettle()`.
class _FixedLocaleNotifier extends LocaleOverrideNotifier {
  _FixedLocaleNotifier(this._locale);

  final Locale _locale;

  @override
  Locale? build() => _locale;
}
