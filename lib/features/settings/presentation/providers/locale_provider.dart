import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

const String _localePrefsKey = 'locale_override';

/// `null` = seguir el idioma del sistema operativo (comportamiento por
/// defecto). Igual patrón que `ThemeModeNotifier` — se lee directamente
/// de `SharedPreferences.getInstance()` (no vía `sl()`/GetIt), para que
/// funcione igual en modo demo que en producción sin ningún override
/// adicional.
final localeOverrideProvider = NotifierProvider<LocaleOverrideNotifier, Locale?>(LocaleOverrideNotifier.new);

class LocaleOverrideNotifier extends Notifier<Locale?> {
  @override
  Locale? build() {
    _loadFromPrefs();
    return null;
  }

  Future<void> _loadFromPrefs() async {
    final SharedPreferences prefs = await SharedPreferences.getInstance();
    final String? saved = prefs.getString(_localePrefsKey);
    if (saved != null && saved.isNotEmpty) {
      state = Locale(saved);
    }
  }

  Future<void> setLocale(Locale? locale) async {
    state = locale;
    final SharedPreferences prefs = await SharedPreferences.getInstance();
    if (locale == null) {
      await prefs.remove(_localePrefsKey);
    } else {
      await prefs.setString(_localePrefsKey, locale.languageCode);
    }
  }
}
