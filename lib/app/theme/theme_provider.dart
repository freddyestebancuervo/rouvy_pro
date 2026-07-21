import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

const String _themePrefsKey = 'theme_mode';

/// Expone el [ThemeMode] actual y permite cambiarlo desde Ajustes.
/// Se persiste localmente para que la elección del usuario sobreviva a
/// reinicios de la app.
final themeModeProvider =
    NotifierProvider<ThemeModeNotifier, ThemeMode>(ThemeModeNotifier.new);

class ThemeModeNotifier extends Notifier<ThemeMode> {
  @override
  ThemeMode build() {
    _loadFromPrefs();
    return ThemeMode.system;
  }

  Future<void> _loadFromPrefs() async {
    final SharedPreferences prefs = await SharedPreferences.getInstance();
    final String? saved = prefs.getString(_themePrefsKey);
    if (saved != null) {
      state = ThemeMode.values.firstWhere(
        (ThemeMode m) => m.name == saved,
        orElse: () => ThemeMode.system,
      );
    }
  }

  Future<void> setThemeMode(ThemeMode mode) async {
    state = mode;
    final SharedPreferences prefs = await SharedPreferences.getInstance();
    await prefs.setString(_themePrefsKey, mode.name);
  }
}
