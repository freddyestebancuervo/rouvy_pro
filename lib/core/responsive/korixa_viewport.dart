/// KORIXA RESPONSIVE FOUNDATION v1 —
/// KORIXA-RESPONSIVE-FOUNDATION-V1-SCREEN01-20260907.
///
/// Reemplaza los breakpoints ad hoc duplicados por pantalla (ver el
/// historial de `welcome_page.dart`: `_desktopBreakpoint`/
/// `_desktopMinShortestSide` locales) por una primitiva reusable de
/// CAPACIDAD de viewport — nunca identidad de dispositivo físico
/// ("esto es un iPhone", "esto es un laptop"). Un mismo dispositivo
/// puede exponer viewports muy distintos según el chrome del navegador,
/// la barra de tareas, split-screen, zoom u orientación — por eso todo
/// acá se calcula a partir de `width`/`height` puros, nunca de
/// user-agent ni de un catálogo de modelos.
///
/// Bug real que motiva esta fundación: un laptop real con
/// `width=1365, height=599` (barra de navegador reduciendo el alto
/// disponible) caía en `_isPhoneLandscape` porque la regla anterior
/// exigía `shortestSide > 600` para CUALQUIER ancho — un laptop real
/// nunca deja de ser un laptop solo porque el alto disponible bajó un
/// pixel por debajo de un umbral arbitrario. La solución no es correr
/// ese umbral (p. ej. a 590): es reconocer que un ancho por sí solo ya
/// grande (`>= expandedMinWidth`, 1024 — ningún teléfono real alcanza
/// eso en NINGUNA orientación) es señal suficiente de una composición
/// ancha, sin importar cuánto se reduzca el alto. Ver [canFitWideLayout].
library;

import 'dart:math' as math;

/// Clase de ancho — son clases de LAYOUT, no identidades físicas.
/// Semántica (Material-adjacent, ya usada como convención en el resto
/// del ecosistema Flutter para `compact`/`medium`/`expanded`):
///   - [compact]: `width < 600` — un teléfono en cualquier orientación
///     razonable, o una ventana de escritorio angostada a propósito.
///   - [medium]: `600 <= width < 1024` — teléfono en horizontal grande,
///     tablet portrait, o una ventana de escritorio angosta.
///   - [expanded]: `width >= 1024` — ningún teléfono conocido alcanza
///     este ancho en ninguna orientación; tablet landscape/laptop/monitor.
enum KorixaWidthClass { compact, medium, expanded }

/// Orientación derivada de las dimensiones — nunca de
/// `MediaQueryData.orientation`/sensor físico: dos pantallas con el
/// mismo `width`/`height` deben clasificar igual sin importar de dónde
/// vengan esos números (un `LayoutBuilder` en un panel partido, una
/// ventana redimensionada, un test widget).
enum KorixaOrientation { portrait, landscape }

/// Información de capacidad de un viewport — construir con
/// `KorixaViewportInfo(width: constraints.maxWidth, height: constraints.maxHeight)`
/// dentro de un `LayoutBuilder`, nunca cacheada entre builds distintos.
class KorixaViewportInfo {
  const KorixaViewportInfo({required this.width, required this.height});

  final double width;
  final double height;

  /// Ancho de la clase [KorixaWidthClass.compact] — ver docblock de la
  /// clase. Único lugar en todo el árbol de UI donde este número debe
  /// existir; las pantallas consumen [widthClass], nunca este valor.
  static const double compactMaxWidth = 600;

  /// Ancho mínimo de [KorixaWidthClass.expanded] — ver docblock de la
  /// clase y de [canFitWideLayout]: ningún teléfono real llega acá en
  /// ninguna orientación, así que el ancho SOLO ya es señal suficiente
  /// de una composición ancha, sin importar cuán bajo esté el alto.
  static const double expandedMinWidth = 1024;

  /// Debajo de este alto, una composición de escritorio/tablet-ancha
  /// debe empezar a adaptar SU PROPIO espaciado interno (nunca cambiar
  /// de composición) — ver [isShortHeight].
  static const double shortHeightThreshold = 700;

  /// Umbral más agresivo que [shortHeightThreshold] — para clamps que
  /// solo deben activarse en el extremo más comprimido (ver
  /// [isVeryShortHeight]).
  static const double veryShortHeightThreshold = 500;

  double get shortestSide => math.min(width, height);
  double get longestSide => math.max(width, height);

  /// `width / height`. `height` nunca debería ser 0 en un viewport real
  /// renderizado; no se protege contra división por cero a propósito
  /// (un `LayoutBuilder` con alto 0 ya es un error de composición padre,
  /// no algo que este primitivo deba enmascarar en silencio).
  double get aspectRatio => width / height;

  /// Ancho >= alto cuenta como "landscape" — un viewport cuadrado
  /// (`width == height`) se trata como landscape por convención (no hay
  /// ningún caso requerido que dependa de este empate exacto).
  KorixaOrientation get orientation => width >= height ? KorixaOrientation.landscape : KorixaOrientation.portrait;

  bool get isPortrait => orientation == KorixaOrientation.portrait;
  bool get isLandscape => orientation == KorixaOrientation.landscape;

  KorixaWidthClass get widthClass {
    if (width < compactMaxWidth) return KorixaWidthClass.compact;
    if (width < expandedMinWidth) return KorixaWidthClass.medium;
    return KorixaWidthClass.expanded;
  }

  /// Alto reducido para una composición ancha — señal para adaptar
  /// espaciado/tamaños INTERNOS (ver docblock de la clase), nunca para
  /// cambiar de composición.
  bool get isShortHeight => height < shortHeightThreshold;

  /// Alto MUY reducido — para el extremo de los clamps (p. ej. el piso
  /// mínimo de un logo), no solo "un poco más chico".
  bool get isVeryShortHeight => height < veryShortHeightThreshold;

  /// ¿Este viewport tiene capacidad real para una composición ancha
  /// (escritorio/tablet-landscape), sin importar cuánto se haya
  /// reducido el alto disponible?
  ///
  /// Dos reglas, en orden:
  ///   1. `width >= expandedMinWidth` (1024) ES SUFICIENTE POR SÍ SOLA
  ///      — ningún teléfono real (portrait u horizontal) alcanza este
  ///      ancho en ninguna orientación, así que el alto disponible ya
  ///      no importa (fixea el bug real: 1365×599 sigue siendo
  ///      escritorio aunque el alto caiga a 599). Reducir el alto de un
  ///      laptop real (chrome del navegador, zoom) nunca lo convierte
  ///      en teléfono.
  ///   2. Para anchos MEDIOS (`desktopMinWidth <= width < expandedMinWidth`
  ///      — p. ej. una ventana de escritorio angosta, o el viewport de
  ///      test compartido 800×600), se exige ADEMÁS un alto mínimo
  ///      razonable (`desktopMinShortHeight`, inclusive) — sin este
  ///      segundo requisito, un teléfono horizontal grande (932×430)
  ///      pasaría la regla de ancho igual de fácil que un monitor real.
  ///      Ningún teléfono conocido supera 600px de alto en horizontal.
  ///
  /// Los parámetros son overrides opcionales para pantallas con sus
  /// propias necesidades — los valores por defecto son los ya
  /// aprobados/verificados para SCREEN_01.
  bool canFitWideLayout({double desktopMinWidth = 700, double desktopMinShortHeight = 600}) {
    if (width >= expandedMinWidth) return true;
    return width >= desktopMinWidth && height >= desktopMinShortHeight;
  }

  /// `clamp(minimum, valor derivado del viewport, maximum)` — helper
  /// fino para que las pantallas no repitan `math.min(max, math.max(min, v))`
  /// a mano. `valueOf(this)` recibe esta misma instancia para derivar el
  /// valor fluido (p. ej. `vp.fluid(120, (v) => v.height * 0.28, 188)`).
  double fluid(double minimum, double Function(KorixaViewportInfo viewport) valueOf, double maximum) {
    final double value = valueOf(this);
    return value.clamp(minimum, maximum);
  }

  @override
  String toString() =>
      'KorixaViewportInfo(width: $width, height: $height, orientation: $orientation, widthClass: $widthClass)';
}
