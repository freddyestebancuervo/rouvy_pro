import 'package:flutter/material.dart';

/// Botón primario que muestra un spinner mientras `isLoading` es true y se
/// deshabilita automáticamente para evitar doble envío del formulario.
/// Se usa en Login, Registro y cualquier otra pantalla con una acción
/// asíncrona principal.
class AppPrimaryButton extends StatelessWidget {
  const AppPrimaryButton({
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
    return ElevatedButton(
      onPressed: isLoading ? null : onPressed,
      child: isLoading
          ? const SizedBox(
              height: 22,
              width: 22,
              child: CircularProgressIndicator(strokeWidth: 2.4, color: Colors.white),
            )
          : Text(label),
    );
  }
}
