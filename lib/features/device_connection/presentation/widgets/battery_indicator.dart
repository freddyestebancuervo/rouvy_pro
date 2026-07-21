import 'package:flutter/material.dart';

/// Ícono de batería + porcentaje. Se oculta a sí mismo (devuelve
/// `SizedBox.shrink`) cuando el dispositivo no expone Battery Service —
/// mostrar "batería desconocida" sería más ruido que información para
/// rodillos conectados a corriente, que a menudo no lo implementan.
class BatteryIndicator extends StatelessWidget {
  const BatteryIndicator({required this.batteryLevel, super.key});

  final int? batteryLevel;

  @override
  Widget build(BuildContext context) {
    if (batteryLevel == null) return const SizedBox.shrink();

    final IconData icon = switch (batteryLevel!) {
      > 80 => Icons.battery_full,
      > 60 => Icons.battery_5_bar,
      > 40 => Icons.battery_3_bar,
      > 20 => Icons.battery_2_bar,
      _ => Icons.battery_alert,
    };

    final Color color = batteryLevel! <= 20 ? Colors.red : Theme.of(context).colorScheme.outline;

    return Row(
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        Icon(icon, size: 18, color: color),
        const SizedBox(width: 2),
        Text('$batteryLevel%', style: Theme.of(context).textTheme.bodySmall?.copyWith(color: color)),
      ],
    );
  }
}
