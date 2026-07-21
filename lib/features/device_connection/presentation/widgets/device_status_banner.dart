import 'package:flutter/material.dart';

/// Banner de advertencia con un botón de acción — usado tanto para
/// "Bluetooth apagado" (sin acción posible desde la app, solo informa)
/// como para "faltan permisos" (con botón de conceder/abrir ajustes).
class DeviceStatusBanner extends StatelessWidget {
  const DeviceStatusBanner({
    required this.message,
    this.actionLabel,
    this.onAction,
    super.key,
  });

  final String message;
  final String? actionLabel;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    final ColorScheme colors = Theme.of(context).colorScheme;
    return Container(
      margin: const EdgeInsets.only(bottom: 16),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: colors.errorContainer.withValues(alpha: 0.5),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        children: <Widget>[
          Icon(Icons.bluetooth_disabled, color: colors.error),
          const SizedBox(width: 12),
          Expanded(child: Text(message, style: Theme.of(context).textTheme.bodyMedium)),
          if (actionLabel != null && onAction != null) ...<Widget>[
            const SizedBox(width: 8),
            TextButton(onPressed: onAction, child: Text(actionLabel!)),
          ],
        ],
      ),
    );
  }
}
