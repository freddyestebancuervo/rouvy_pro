import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:rouvy_pro/app/theme/theme_provider.dart';
import 'package:rouvy_pro/features/settings/presentation/pages/settings_page.dart';
import 'package:rouvy_pro/features/settings/presentation/providers/locale_provider.dart';
import 'package:rouvy_pro/l10n/generated/app_localizations.dart';

/// Envuelve `SettingsPage` en un `ProviderScope` propio y expone su
/// `ProviderContainer` vía el parámetro de salida `onContainerReady` —
/// así cada test puede leer el estado de los providers después de
/// interactuar con la UI, sin necesitar un `ProviderScope` global
/// compartido entre tests (que arrastraría estado de un test a otro).
Widget _settingsPageHarness({required void Function(ProviderContainer) onContainerReady}) {
  return ProviderScope(
    child: Consumer(
      builder: (BuildContext context, WidgetRef ref, _) {
        onContainerReady(ProviderScope.containerOf(context));
        return const MaterialApp(
          locale: Locale('es'),
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: SettingsPage(),
        );
      },
    ),
  );
}

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues(<String, Object>{});
  });

  testWidgets('muestra las 3 opciones de tema y las 3 de idioma', (WidgetTester tester) async {
    await tester.pumpWidget(_settingsPageHarness(onContainerReady: (_) {}));
    await tester.pumpAndSettle();

    expect(find.text('Claro'), findsOneWidget);
    expect(find.text('Oscuro'), findsOneWidget);
    expect(find.text('Español'), findsOneWidget);
    expect(find.text('English'), findsOneWidget);
  });

  testWidgets('tocar "Oscuro" actualiza themeModeProvider', (WidgetTester tester) async {
    late ProviderContainer container;
    await tester.pumpWidget(_settingsPageHarness(onContainerReady: (ProviderContainer c) => container = c));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Oscuro'));
    await tester.pumpAndSettle();

    expect(container.read(themeModeProvider), ThemeMode.dark);
  });

  testWidgets('tocar "English" actualiza localeOverrideProvider', (WidgetTester tester) async {
    late ProviderContainer container;
    await tester.pumpWidget(_settingsPageHarness(onContainerReady: (ProviderContainer c) => container = c));
    await tester.pumpAndSettle();

    await tester.tap(find.text('English'));
    await tester.pumpAndSettle();

    expect(container.read(localeOverrideProvider), const Locale('en'));
  });

  testWidgets('tocar "Seguir el sistema" (idioma) vuelve el override a null', (WidgetTester tester) async {
    late ProviderContainer container;
    await tester.pumpWidget(_settingsPageHarness(onContainerReady: (ProviderContainer c) => container = c));
    await tester.pumpAndSettle();

    await tester.tap(find.text('English'));
    await tester.pumpAndSettle();
    expect(container.read(localeOverrideProvider), const Locale('en'));

    // Hay dos "Seguir el sistema" en pantalla (tema e idioma) — se toca
    // el segundo, que es el de la sección Idioma.
    await tester.tap(find.text('Seguir el sistema').last);
    await tester.pumpAndSettle();

    expect(container.read(localeOverrideProvider), isNull);
  });
}
