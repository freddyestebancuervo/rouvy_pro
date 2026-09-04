import 'package:flutter/material.dart';

import '../../app/theme/app_colors.dart';
import '../../app/theme/app_radius.dart';
import '../../app/theme/app_spacing.dart';

/// KORIXA-UI-DARK-TECH-DESIGN-SYSTEM-01 — control segmentado / estilo de
/// filter chip. Segmento activo: fondo `brandBlue` + texto blanco;
/// inactivo: transparente + `textSecondary`. Genérico sobre [T] para que
/// una futura pantalla lo use con cualquier enum (p. ej. dificultad de
/// ruta, unidades métricas/imperiales) sin duplicar el widget.
class SegmentedControl<T> extends StatelessWidget {
  const SegmentedControl({required this.segments, required this.selected, required this.onChanged, super.key});

  final List<SegmentedControlOption<T>> segments;
  final T selected;
  final ValueChanged<T> onChanged;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(4),
      decoration: const BoxDecoration(color: DarkTech.surfaceElevated, borderRadius: AppRadius.pillRadius),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: segments.map((SegmentedControlOption<T> option) {
          final bool isSelected = option.value == selected;
          return Padding(
            padding: const EdgeInsets.symmetric(horizontal: 2),
            child: Material(
              color: Colors.transparent,
              child: InkWell(
                onTap: () => onChanged(option.value),
                borderRadius: AppRadius.pillRadius,
                child: AnimatedContainer(
                  duration: const Duration(milliseconds: 150),
                  padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md, vertical: AppSpacing.sm),
                  decoration: BoxDecoration(
                    color: isSelected ? DarkTech.brandBlue : Colors.transparent,
                    borderRadius: AppRadius.pillRadius,
                  ),
                  child: Text(
                    option.label,
                    style: TextStyle(
                      color: isSelected ? Colors.white : DarkTech.textSecondary,
                      fontWeight: FontWeight.w600,
                      fontSize: 13,
                    ),
                  ),
                ),
              ),
            ),
          );
        }).toList(growable: false),
      ),
    );
  }
}

class SegmentedControlOption<T> {
  const SegmentedControlOption({required this.value, required this.label});

  final T value;
  final String label;
}

/// KORIXA-UI-DARK-TECH-DESIGN-SYSTEM-01, Sección 15 — SOLO la
/// especificación de estilo para una futura barra de navegación inferior
/// (Inicio / Rutas / Entrenar / Perfil, per el diseño de Home aprobado).
///
/// Deliberadamente NO es un widget de navegación funcional: el router
/// actual (`lib/app/router/app_router.dart`) es una lista plana de
/// `GoRoute`, sin `ShellRoute` ni ninguna barra inferior — solo un
/// comentario que menciona la posibilidad a futuro (línea ~234). Crear un
/// shell de navegación real es un cambio de arquitectura de navegación,
/// fuera del alcance de esta tarea de fundación ("no inventar rutas que
/// no existen", Sección 15). Cuando esa tarea posterior exista, debe usar
/// estos tokens de color en vez de inventar los suyos.
///
/// KORIXA-UI-DARK-TECH-DESIGN-SYSTEM-01A (auditoría de accesibilidad,
/// defecto #3): la etiqueta seleccionada usaba un único `selectedColor`
/// (`brandBlue`) para ícono Y texto. Como COLOR DE TEXTO de 11px,
/// `brandBlue` da solo 3.50:1 contra `surfaceElevated` — reprueba AA
/// texto normal (4.5:1), aunque SÍ pasa el umbral no-textual de íconos/
/// bordes (≥3.0:1, WCAG 1.4.11). Por eso el ícono y la etiqueta ahora
/// tienen tokens separados: el acento de marca se queda en el ÍCONO
/// (contraste no-textual), la etiqueta usa `textPrimary` (16.86:1).
abstract class DarkTechBottomNavStyle {
  static const Color background = DarkTech.surfaceElevated;

  /// Ícono seleccionado — contraste NO-textual (≥3.0:1): 3.50:1 contra
  /// [background]. NO usar como color de texto, ver [selectedLabelColor].
  static const Color selectedIconColor = DarkTech.brandBlue;
  static const Color unselectedIconColor = DarkTech.textMuted;

  /// Etiqueta seleccionada — DEBE cumplir AA texto normal (≥4.5:1);
  /// `selectedIconColor` no sirve para esto (3.50:1). `textPrimary` da
  /// 16.86:1 contra [background], con margen amplio.
  static const Color selectedLabelColor = DarkTech.textPrimary;
  static const Color unselectedLabelColor = DarkTech.textMuted;

  static const double iconSize = 24;
  static const TextStyle selectedLabelStyle = TextStyle(
    color: selectedLabelColor,
    fontSize: 11,
    fontWeight: FontWeight.w600,
  );
  static const TextStyle unselectedLabelStyle = TextStyle(
    color: unselectedLabelColor,
    fontSize: 11,
    fontWeight: FontWeight.w500,
  );
}
