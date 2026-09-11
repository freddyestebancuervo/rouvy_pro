import 'package:flutter/material.dart';

import '../../app/theme/app_colors.dart';
import '../../app/theme/app_gradients.dart';
import '../../app/theme/app_radius.dart';

/// Indicador de "página activa" de 3 barras — nunca puntos, para que se
/// lea como una barra de progreso minimal en vez de un carrusel real. No
/// hay swipe/navegación real asociada a ninguna instancia de este
/// widget: solo la primera barra (activa) importa semánticamente, las
/// otras dos son puramente decorativas.
///
/// KORIXA-SCREEN02-LOGIN-ALIGNMENT-INDICATOR-POLISH-20260910: extraído
/// desde `WelcomePage` (donde nació como `_ThreeBarIndicator`/`_Bar`,
/// KORIXA-UI-SCREEN01-FINAL-VISUAL-POLISH-20260905 /
/// KORIXA-SCREEN01-MOBILE-ADD-THREE-INDICATOR-LINES-20260906) a este
/// archivo compartido del sistema de diseño, para que SCREEN_02 Login
/// pueda reusar la implementación EXACTA — mismas dimensiones, mismo
/// grosor, mismos gaps, mismo radio de borde, mismos colores
/// activo/inactivo, mismo orden — en vez de aproximarla visualmente.
/// `WelcomePage` sigue siendo el único lugar que decide los 3 tamaños
/// concretos (mobile/desktop/phone-landscape); este widget solo aplica
/// los parámetros que recibe.
///
/// KORIXA-SCREEN02-LOGIN-SUBTITLE-POSITION-CENTER-ACTIVE-INDICATOR-
/// 20260910: [activeIndex] agregado con default `0` — preserva el
/// comportamiento exacto de todo llamador existente (`WelcomePage`, que
/// no lo pasa) sin tocarlo. SCREEN_02 Login desktop es el único llamador
/// que pasa `activeIndex: 1` (la barra CENTRAL activa), pedido
/// explícitamente por el dueño para distinguir visualmente este
/// indicador puramente decorativo del de Welcome — sigue sin
/// representar progreso real de autenticación ni ningún estado.
class ThreeBarIndicator extends StatelessWidget {
  const ThreeBarIndicator({
    required this.barWidth,
    required this.barHeight,
    required this.gap,
    this.activeIndex = 0,
    super.key,
  }) : assert(activeIndex >= 0 && activeIndex <= 2, 'activeIndex debe ser 0, 1 o 2 — solo hay 3 barras');

  final double barWidth;
  final double barHeight;
  final double gap;
  final int activeIndex;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        _IndicatorBar(active: activeIndex == 0, width: barWidth, height: barHeight),
        SizedBox(width: gap),
        _IndicatorBar(active: activeIndex == 1, width: barWidth, height: barHeight),
        SizedBox(width: gap),
        _IndicatorBar(active: activeIndex == 2, width: barWidth, height: barHeight),
      ],
    );
  }
}

class _IndicatorBar extends StatelessWidget {
  const _IndicatorBar({required this.active, required this.width, required this.height});

  final bool active;
  final double width;
  final double height;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: width,
      height: height,
      decoration: BoxDecoration(
        // Activa: mismo gradiente de marca que el CTA. Inactivas:
        // `DarkTech.border` — el tono "gris oscuro" ya existente en el
        // sistema de diseño (no un color nuevo).
        gradient: active ? AppGradients.primaryCta : null,
        color: active ? null : DarkTech.border,
        borderRadius: AppRadius.pillRadius,
      ),
    );
  }
}
