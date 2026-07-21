import 'package:flutter/material.dart';

/// Botón de "Continuar con Google". Usa `OutlinedButton` (no el color de
/// marca) porque Google exige no alterar su logo ni forzarlo a los colores
/// primarios de la app — mismo criterio aplicado al de Apple.
class GoogleSignInButton extends StatelessWidget {
  const GoogleSignInButton({required this.label, required this.onPressed, this.isLoading = false, super.key});

  final String label;
  final VoidCallback? onPressed;
  final bool isLoading;

  @override
  Widget build(BuildContext context) {
    return OutlinedButton.icon(
      onPressed: isLoading ? null : onPressed,
      icon: isLoading
          ? const SizedBox(
              height: 18,
              width: 18,
              child: CircularProgressIndicator(strokeWidth: 2),
            )
          : const Icon(Icons.g_mobiledata, size: 26), // TODO(design): sustituir por logo oficial de Google
      label: Text(label),
    );
  }
}

/// Botón de "Continuar con Apple" — solo debe mostrarse en iOS/macOS
/// (ver `Platform.isIOS` en la pantalla que lo consume), cumpliendo con
/// las guías de Apple de estilo negro sólido con su logo.
class AppleSignInButton extends StatelessWidget {
  const AppleSignInButton({required this.label, required this.onPressed, this.isLoading = false, super.key});

  final String label;
  final VoidCallback? onPressed;
  final bool isLoading;

  @override
  Widget build(BuildContext context) {
    return FilledButton.icon(
      onPressed: isLoading ? null : onPressed,
      style: FilledButton.styleFrom(backgroundColor: Colors.black, foregroundColor: Colors.white),
      icon: isLoading
          ? const SizedBox(
              height: 18,
              width: 18,
              child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
            )
          : const Icon(Icons.apple, size: 22),
      label: Text(label),
    );
  }
}
