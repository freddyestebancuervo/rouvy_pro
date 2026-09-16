import 'package:flutter/widgets.dart';

import '../../app/theme/app_spacing.dart';

/// KORIXA-GLOBAL-SCROLL-EDGE-SAFETY-20260916: práctica oficial de Korixa
/// para el manejo seguro de los extremos de cualquier contenido
/// scrolleable (`SingleChildScrollView` o cualquier otro `Scrollable`).
///
/// El problema real: el owner detectó en SCREEN_02 (Login) mobile
/// portrait que, cuando el contenido excede el alto disponible y hace
/// falta scrollear, el título quedaba pegado al borde superior del
/// scroll — el inset superior de esa composición era `0` (bajado a
/// propósito en una tarea anterior, KORIXA-SCREEN02-TRUE-BOTTOM-
/// COMPOSITION-OWNER-CORRECTION-20260911, para acercar el título al
/// centro vertical). El bug no es exclusivo de Login: es la ausencia de
/// un PISO mínimo de espacio seguro en el inset superior/inferior de
/// CUALQUIER contenido scrolleable de la app.
///
/// [ensureMinEdgeGap] sube `top`/`bottom` al mínimo [minEdgeGap] SOLO si
/// estaban por debajo — nunca reduce un inset ya aprobado que sea igual
/// o mayor (auditoría 2026-09-16: Welcome/Login/Register ya usan 8, 20,
/// 24, 32 o 40 en sus otros 8 sitios de scroll; Login mobile portrait
/// era el ÚNICO por debajo del piso). `left`/`right` nunca se tocan —
/// esta garantía es exclusivamente vertical (los 3 extremos de scroll
/// de esta app son todos verticales).
///
/// `minEdgeGap` = `AppSpacing.sm` (8) — no es un número inventado para
/// esta tarea: ya es, textualmente, "el colchón real" que Welcome/Login/
/// Register usan en la mayoría de sus composiciones landscape/portrait
/// existentes (ver comentarios de esas pantallas). Esta clase solo
/// centraliza esa práctica ya vigente en un solo lugar reutilizable, en
/// vez de que cada pantalla nueva vuelva a decidir su propio número.
///
/// El manejo de teclado NO requiere lógica adicional acá: las 3
/// pantallas de auth dejan `Scaffold.resizeToAvoidBottomInset` en su
/// valor por defecto (`true`, sin overrides — ver
/// `RegisterPage._buildMobilePortrait`), así que Flutter ya reduce el
/// alto disponible del `body` cuando el teclado abre, y el
/// `SingleChildScrollView` existente en cada composición ya vuelve
/// alcanzable cualquier campo/botón tapado — sin necesitar leer
/// `MediaQuery.viewInsets` a mano en cada pantalla.
abstract class KorixaScrollEdgeSafety {
  static const double minEdgeGap = AppSpacing.sm;

  static EdgeInsets ensureMinEdgeGap(EdgeInsets padding) {
    return EdgeInsets.fromLTRB(
      padding.left,
      padding.top < minEdgeGap ? minEdgeGap : padding.top,
      padding.right,
      padding.bottom < minEdgeGap ? minEdgeGap : padding.bottom,
    );
  }
}
