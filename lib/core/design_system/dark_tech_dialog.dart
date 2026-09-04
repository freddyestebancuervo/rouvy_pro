import 'package:flutter/material.dart';

import '../../app/theme/app_colors.dart';
import '../../app/theme/app_radius.dart';

/// KORIXA-UI-DARK-TECH-DESIGN-SYSTEM-01 — fundación de diálogo/bottom
/// sheet. Envuelve el contenido en un `Theme` local con los tokens Dark
/// Tech, para que se vea correcto incluso antes de que `AppTheme.darkTech`
/// esté conectado a `MaterialApp` (igual que `AppTextField`/
/// `PrimaryGradientButton`) — una vez migrada la app, esta envoltura deja
/// de ser necesaria porque el tema ambiente ya trae los mismos valores.
Future<T?> showDarkTechDialog<T>({required BuildContext context, required WidgetBuilder builder}) {
  return showDialog<T>(
    context: context,
    builder: (BuildContext dialogContext) => _DarkTechThemeOverride(child: Builder(builder: builder)),
  );
}

Future<T?> showDarkTechBottomSheet<T>({required BuildContext context, required WidgetBuilder builder}) {
  return showModalBottomSheet<T>(
    context: context,
    backgroundColor: Colors.transparent,
    isScrollControlled: true,
    builder: (BuildContext sheetContext) => _DarkTechThemeOverride(
      child: Container(
        decoration: const BoxDecoration(
          color: DarkTech.surfaceElevated,
          borderRadius: BorderRadius.vertical(top: Radius.circular(AppRadius.xl)),
        ),
        child: Builder(builder: builder),
      ),
    ),
  );
}

class _DarkTechThemeOverride extends StatelessWidget {
  const _DarkTechThemeOverride({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Theme(
      data: Theme.of(context).copyWith(
        dialogTheme: const DialogThemeData(
          backgroundColor: DarkTech.surfaceElevated,
          shape: RoundedRectangleBorder(borderRadius: AppRadius.lgRadius),
        ),
      ),
      child: DefaultTextStyle(
        style: const TextStyle(color: DarkTech.textPrimary),
        child: child,
      ),
    );
  }
}
