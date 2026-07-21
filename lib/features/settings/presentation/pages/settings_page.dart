import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../app/theme/theme_provider.dart';
import '../../../../l10n/generated/app_localizations.dart';
import '../providers/locale_provider.dart';

class SettingsPage extends ConsumerWidget {
  const SettingsPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final ThemeMode themeMode = ref.watch(themeModeProvider);
    final Locale? localeOverride = ref.watch(localeOverrideProvider);

    return Scaffold(
      appBar: AppBar(title: Text(l10n.settingsTitle)),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: <Widget>[
            Text(l10n.appearanceSectionTitle, style: Theme.of(context).textTheme.titleSmall),
            const SizedBox(height: 8),
            Card(
              child: RadioGroup<ThemeMode>(
                groupValue: themeMode,
                onChanged: (ThemeMode? mode) => ref.read(themeModeProvider.notifier).setThemeMode(mode!),
                child: Column(
                  children: <Widget>[
                    RadioListTile<ThemeMode>(
                      title: Text(l10n.themeSystemAction),
                      value: ThemeMode.system,
                    ),
                    RadioListTile<ThemeMode>(
                      title: Text(l10n.themeLightAction),
                      value: ThemeMode.light,
                    ),
                    RadioListTile<ThemeMode>(
                      title: Text(l10n.themeDarkAction),
                      value: ThemeMode.dark,
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 24),
            Text(l10n.languageSectionTitle, style: Theme.of(context).textTheme.titleSmall),
            const SizedBox(height: 8),
            Card(
              child: RadioGroup<String>(
                groupValue: localeOverride?.languageCode ?? 'system',
                onChanged: (String? code) {
                  switch (code) {
                    case 'es':
                      ref.read(localeOverrideProvider.notifier).setLocale(const Locale('es'));
                    case 'en':
                      ref.read(localeOverrideProvider.notifier).setLocale(const Locale('en'));
                    default:
                      ref.read(localeOverrideProvider.notifier).setLocale(null);
                  }
                },
                child: Column(
                  children: <Widget>[
                    RadioListTile<String>(
                      title: Text(l10n.languageSystemAction),
                      value: 'system',
                    ),
                    const RadioListTile<String>(
                      title: Text('Español'),
                      value: 'es',
                    ),
                    const RadioListTile<String>(
                      title: Text('English'),
                      value: 'en',
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 24),
            Text(l10n.otherSectionTitle, style: Theme.of(context).textTheme.titleSmall),
            const SizedBox(height: 8),
            Card(
              child: Column(
                children: <Widget>[
                  ListTile(
                    leading: const Icon(Icons.straighten),
                    title: Text(l10n.unitsLabel),
                    trailing: Text(l10n.unitsMetricValue, style: Theme.of(context).textTheme.bodySmall),
                  ),
                  ListTile(
                    leading: const Icon(Icons.notifications_outlined),
                    title: Text(l10n.notificationsLabel),
                    trailing: Text(l10n.notificationsEnabledValue, style: Theme.of(context).textTheme.bodySmall),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
