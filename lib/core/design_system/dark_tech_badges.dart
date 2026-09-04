import 'package:flutter/material.dart';

import '../../app/theme/app_colors.dart';
import '../../app/theme/app_radius.dart';
import '../../app/theme/app_spacing.dart';

/// KORIXA-UI-DARK-TECH-DESIGN-SYSTEM-01 — insignia de estado base.
///
/// [icon] es OBLIGATORIO a propósito (Sección 19 — accesibilidad: nunca
/// depender solo del color para comunicar seleccionado/conectado/error/no
/// disponible). Cada variante con nombre (`ComingSoonBadge`,
/// `AvailableBadge`, `ConnectedBadge`) fija su propio ícono/color/texto —
/// así ningún llamador puede, por accidente, crear una insignia "roja"
/// sin ícono ni texto que la acompañe.
class StatusBadge extends StatelessWidget {
  const StatusBadge({required this.label, required this.color, required this.icon, super.key});

  final String label;
  final Color color;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: AppSpacing.sm, vertical: 4),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.15),
        borderRadius: AppRadius.pillRadius,
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Icon(icon, size: 14, color: color),
          const SizedBox(width: 4),
          Text(
            label,
            style: TextStyle(color: color, fontSize: 12, fontWeight: FontWeight.w600),
          ),
        ],
      ),
    );
  }
}

/// Para contenido/rutas que existen pero todavía no son entrenables (p. ej.
/// rutas `video`/`terrain3d` sin contenido real detrás — ver
/// `RouteContentTypeCapability.isRunnable`). Deliberadamente NEUTRAL
/// (`textMuted`), no de advertencia/error — no es un problema, es una
/// promesa a futuro.
class ComingSoonBadge extends StatelessWidget {
  const ComingSoonBadge({this.label = 'Coming soon', super.key});

  final String label;

  @override
  Widget build(BuildContext context) {
    return StatusBadge(label: label, color: DarkTech.textMuted, icon: Icons.schedule);
  }
}

/// Contenido/ruta genuinamente disponible/entrenable hoy.
class AvailableBadge extends StatelessWidget {
  const AvailableBadge({this.label = 'Available', super.key});

  final String label;

  @override
  Widget build(BuildContext context) {
    return StatusBadge(label: label, color: DarkTech.success, icon: Icons.check_circle);
  }
}

/// Dispositivo BLE conectado — Sección 11: verde = conectado/disponible/éxito.
class ConnectedBadge extends StatelessWidget {
  const ConnectedBadge({this.label = 'Connected', super.key});

  final String label;

  @override
  Widget build(BuildContext context) {
    return StatusBadge(label: label, color: DarkTech.success, icon: Icons.bluetooth_connected);
  }
}
