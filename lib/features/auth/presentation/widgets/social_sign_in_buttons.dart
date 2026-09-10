import 'package:flutter/material.dart';

/// Botón de "Continuar con Google". Usa `OutlinedButton` (no el color de
/// marca) porque Google exige no alterar su logo ni forzarlo a los colores
/// primarios de la app — mismo criterio aplicado al de Apple.
///
/// Mismo widget en todas las plataformas: en Web, el flujo real es
/// `FirebaseAuth.signInWithPopup` (ver `AuthRemoteDataSourceImpl`), que
/// no necesita ningún botón/HtmlElementView oficial de Google incrustado
/// en la página — el popup lo abre Firebase directamente al llamar
/// `onPressed`.
///
/// KORIXA-SCREEN02-LOGIN-VISUAL-IMPLEMENTATION-20260907: el ícono
/// placeholder (`Icons.g_mobiledata`, un glifo de Material sin relación
/// real con la marca) se reemplaza por el logo oficial multicolor de
/// Google (`assets/icons/google_logo.png`) — colores oficiales
/// (#4285F4/#EA4335/#FBBC05/#34A853 vía las 4 franjas del path SVG
/// estándar de Google, rasterizado localmente, sin fetch remoto), sin
/// recolorear con la paleta Korixa ni aproximar con un ícono de Material.
/// Cambio puramente visual — el contrato del widget (`label`/`onPressed`/
/// `isLoading`) y el flujo `signInWithPopup` de arriba no cambian.
class GoogleSignInButton extends StatelessWidget {
  const GoogleSignInButton({
    required this.label,
    required this.onPressed,
    this.isLoading = false,
    super.key,
  });

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
          : Image.asset('assets/icons/google_logo.png', height: 20, width: 20, semanticLabel: 'Google'),
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
