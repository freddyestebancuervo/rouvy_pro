import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:rouvy_pro/app/app.dart';
import 'package:rouvy_pro/demo/demo_injection.dart';
import 'package:rouvy_pro/demo/demo_overrides.dart';
import 'package:rouvy_pro/features/routes_catalog/presentation/pages/routes_catalog_page.dart';

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
        ProviderScope(overrides: buildDemoOverrides(), child: const RideProApp()),
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
      await tester.tap(find.text("Alpe d'Huez"));
      await tester.pumpAndSettle();
      expect(find.text('Entrenar esta ruta'), findsOneWidget);

      // --- Volver al catálogo ---
      await tester.pageBack();
      await tester.pumpAndSettle();
      expect(find.byType(RoutesCatalogPage), findsOneWidget);
    },
  );
}
