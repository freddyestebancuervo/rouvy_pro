import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../features/settings/presentation/providers/locale_provider.dart';
import '../l10n/generated/app_localizations.dart';
import 'router/app_router.dart';
import 'theme/app_theme.dart';
import 'theme/theme_provider.dart';
import 'widgets/connectivity_sync_banner.dart';

class RideProApp extends ConsumerWidget {
  const RideProApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final GoRouter router = ref.watch(routerProvider);
    final ThemeMode themeMode = ref.watch(themeModeProvider);
    final Locale? localeOverride = ref.watch(localeOverrideProvider);

    return MaterialApp.router(
      title: 'RidePro',
      debugShowCheckedModeBanner: false,

      // --- Tema claro/oscuro ---
      theme: AppTheme.light,
      darkTheme: AppTheme.dark,
      themeMode: themeMode,

      // --- Internacionalización (es/en) ---
      // `null` = seguir el idioma del sistema operativo (comportamiento
      // por defecto de Flutter); si el usuario forzó un idioma desde
      // Configuración, `localeOverride` lo fija explícitamente.
      locale: localeOverride,
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      supportedLocales: AppLocalizations.supportedLocales,

      // --- Navegación ---
      routerConfig: router,

      // El banner envuelve TODA la navegación (no una pantalla suelta) —
      // aparece/desaparece sin importar en qué ruta esté el usuario,
      // sin que cada pantalla nueva tenga que acordarse de incluirlo.
      builder: (BuildContext context, Widget? child) {
        return ConnectivitySyncBanner(child: child ?? const SizedBox.shrink());
      },
    );
  }
}
