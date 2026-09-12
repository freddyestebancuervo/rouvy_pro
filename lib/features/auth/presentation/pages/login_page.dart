import 'package:flutter/foundation.dart' show defaultTargetPlatform, kIsWeb, TargetPlatform;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../app/router/app_router.dart';
import '../../../../app/theme/app_colors.dart';
import '../../../../app/theme/app_gradients.dart';
import '../../../../app/theme/app_spacing.dart';
import '../../../../app/theme/app_theme.dart';
import '../../../../core/design_system/dark_tech_buttons.dart';
import '../../../../core/design_system/dark_tech_indicators.dart';
import '../../../../core/error/failures.dart';
import '../../../../core/responsive/korixa_viewport.dart';
import '../../../../core/utils/validation_l10n.dart';
import '../../../../core/utils/validators.dart';
import '../../../../l10n/generated/app_localizations.dart';
import '../providers/login_controller.dart';
import '../providers/social_auth_controller.dart';
import '../widgets/social_sign_in_buttons.dart';

/// SCREEN_02 = LOGIN — KORIXA-SCREEN02-LOGIN-VISUAL-IMPLEMENTATION-20260907.
///
/// Deliberadamente NO reusa `DarkTechAuthShell` (compartido con Register):
/// ese shell da un formulario centrado de ancho fijo sin hero — esta
/// pantalla necesita 3 composiciones responsivas propias con foto de
/// fondo (portrait/landscape/desktop), igual que ya se hizo para Welcome
/// (`WelcomePage`, KORIXA-UI-SCREEN-01-APPROVED-WELCOME). Register NO se
/// toca en absoluto en esta tarea — sigue usando `DarkTechAuthShell` sin
/// cambios.
///
/// Auth freeze: toda la lógica de autenticación (validación, loading,
/// error, navegación de éxito vía `Future<bool>` awaited — nunca desde
/// la transición loading→data de un `AsyncValue`, que ya causó una
/// navegación fantasma a Home antes de que existiera este patrón —
/// Google/Apple, rutas) es EXACTAMENTE la misma que ya existía. Esta
/// tarea es visual/responsiva: agrega el hero de Guatapé aprobado,
/// branding Korixa, y reemplaza el placeholder de Google
/// (`Icons.g_mobiledata`) por el logo oficial — nada más.
class LoginPage extends ConsumerStatefulWidget {
  const LoginPage({super.key});

  @override
  ConsumerState<LoginPage> createState() => _LoginPageState();
}

class _LoginPageState extends ConsumerState<LoginPage> {
  final _formKey = GlobalKey<FormState>();
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();
  bool _obscurePassword = true;

  // KORIXA-SCREEN02-FIXED-BLOCK-NO-MOVEMENT-20260911: el dueño pidió
  // explícitamente que la decisión de habilitar scroll en mobile
  // portrait NO se base en preservar espacio escénico ni en un piso de
  // altura artificial (el `_minPortraitCompositionHeight` de la ronda
  // anterior) — debe basarse ÚNICAMENTE en si el contenido FUNCIONAL
  // realmente entra o no en el alto útil real. Eso exige conocer la
  // altura NATURAL real del grupo (título→crear cuenta), que depende de
  // fuentes/escalado de accesibilidad del dispositivo — no un número
  // fijo confiable de antemano. `_portraitContentKey` mide esa altura
  // real después de cada layout (`_schedulePortraitScrollFitMeasurement`,
  // ver `_buildPortrait`); `_portraitScrollNeeded` guarda el resultado.
  //
  // Default `true` (asumir que hace falta scroll) hasta la primera
  // medición real — es la opción SEGURA: nunca recorta contenido antes
  // de medir. La única diferencia observable entre "scrolleable pero
  // sin scrollear" y "no scrolleable" es la respuesta a un gesto de
  // arrastre real — imposible dentro del primer frame (~16ms) antes de
  // que la medición se complete y corrija el estado si hace falta, así
  // que no hay parpadeo visual perceptible.
  final GlobalKey _portraitContentKey = GlobalKey();
  bool _portraitScrollNeeded = true;

  void _schedulePortraitScrollFitMeasurement(double availableHeight) {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      final RenderBox? contentBox = _portraitContentKey.currentContext?.findRenderObject() as RenderBox?;
      if (contentBox == null || !contentBox.hasSize) return;
      // KORIXA-SCREEN02-FIXED-BLOCK-NO-MOVEMENT-20260911: `contentBox`
      // es el `Padding` que envuelve el grupo REAL de Login — mide su
      // alto NATURAL (nunca inflado por ningún `ConstrainedBox` padre,
      // las restricciones solo fluyen hacia abajo) y lo compara contra
      // el alto REAL disponible medido en esta misma pasada de layout.
      final bool needsScroll = contentBox.size.height > availableHeight;
      if (needsScroll != _portraitScrollNeeded) {
        setState(() => _portraitScrollNeeded = needsScroll);
      }
    });
  }

  @override
  void dispose() {
    _emailController.dispose();
    _passwordController.dispose();
    super.dispose();
  }

  bool get _isApplePlatform => !kIsWeb && defaultTargetPlatform == TargetPlatform.iOS;

  Future<void> _handleSubmit() async {
    if (!_formKey.currentState!.validate()) return;

    final bool success = await ref.read(loginControllerProvider.notifier).submit(
          email: _emailController.text.trim(),
          password: _passwordController.text,
        );

    if (!mounted) return;
    if (success) context.go(AppRoute.home);
  }

  /// Mismo patrón que `_handleSubmit`: navega solo si la propia acción
  /// devuelve éxito, nunca a partir de transiciones genéricas de
  /// `AsyncValue` (loading → data) — esas también ocurren cuando
  /// `SocialAuthController.build()` termina de inicializarse SIN que el
  /// usuario haya tocado nada, lo que antes disparaba una navegación a
  /// Home fantasma apenas se abría esta pantalla.
  Future<void> _handleSocialSignIn(Future<bool> Function() signIn) async {
    final bool success = await signIn();
    if (!mounted) return;
    if (success) context.go(AppRoute.home);
  }

  void _showError(Object error, AppLocalizations l10n) {
    final String message = error is Failure ? error.message : l10n.genericErrorMessage;
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(message)));
  }

  // -------------------------------------------------------------------
  // Clasificación responsiva — KORIXA-SCREEN02-ADOPT-RESPONSIVE-
  // FOUNDATION-PR127-20260907: ya NO reimplementa su propio breakpoint
  // local (el `_desktopBreakpoint`/`_desktopMinShortestSide` original de
  // esta pantalla era exactamente la misma clase de lógica que causó el
  // bug real de SCREEN_01 — un laptop con `1365×599` cayendo en
  // phone-landscape porque `shortestSide > 600` fallaba sin importar el
  // ancho — ver `KorixaViewportInfo.canFitWideLayout` en
  // `core/responsive/korixa_viewport.dart`, KORIXA-RESPONSIVE-
  // FOUNDATION-V1-SCREEN01-20260907). La clasificación compartida vive
  // en la fundación; acá solo se consume.
  // -------------------------------------------------------------------

  static bool _isDesktop(KorixaViewportInfo viewport) => viewport.isLandscape && viewport.canFitWideLayout();

  static bool _isPhoneLandscape(KorixaViewportInfo viewport) => viewport.isLandscape && !viewport.canFitWideLayout();

  // -------------------------------------------------------------------
  // KORIXA-SCREEN02-LOGIN-MATCH-SCREEN01-DESKTOP-SCALE-20260910: el dueño
  // reportó que, tras quitar el panel de vidrio, el contenido de Login se
  // veía "como un formulario chico flotando en la esquina de un paisaje
  // enorme" — pidió explícitamente igualar la escala visual ya aprobada
  // de SCREEN_01 Welcome en desktop, no una escala nueva inventada. Estos
  // 6 valores son una copia EXACTA de las constantes/literales ya
  // vigentes en `WelcomePage._DesktopWelcomeContent`
  // (`_contentMaxWidth`/`_ctaWidth`/altura de `welcome-desktop-cta`/altura
  // de `welcome-desktop-logo`/`fontSize` de título y subtítulo de
  // escritorio) — ver ese archivo para el razonamiento original de cada
  // número. Solo aplican a `_buildDesktop`; phone landscape y mobile
  // portrait no cambian.
  static const double _desktopContentMaxWidth = 680;
  static const double _desktopControlWidth = 550;
  static const double _desktopCtaHeight = 64;
  static const double _desktopCtaFontSize = 20;
  static const double _desktopLogoHeight = 188;
  static const double _desktopTitleFontSize = 51;
  static const double _desktopSubtitleFontSize = 24;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final AsyncValue<void> loginState = ref.watch(loginControllerProvider);
    final AsyncValue<void> socialState = ref.watch(socialAuthControllerProvider);

    ref.listen<AsyncValue<void>>(loginControllerProvider, (previous, next) {
      if (next.hasError && !next.isLoading) _showError(next.error!, l10n);
    });

    // Solo errores: el éxito se maneja awaiteando el `Future<bool>` que
    // devuelve cada acción (`_handleSocialSignIn`) — nunca a partir de la
    // transición loading→data de este `AsyncValue`, que también ocurre al
    // inicializarse el controller sin que el usuario haga nada.
    ref.listen<AsyncValue<void>>(socialAuthControllerProvider, (previous, next) {
      if (next.hasError && !next.isLoading) _showError(next.error!, l10n);
    });

    final bool anyLoading = loginState.isLoading || socialState.isLoading;

    return Theme(
      data: AppTheme.darkTech,
      child: Scaffold(
        backgroundColor: DarkTech.background,
        body: LayoutBuilder(
          builder: (BuildContext context, BoxConstraints constraints) {
            final KorixaViewportInfo viewport = KorixaViewportInfo(
              width: constraints.maxWidth,
              height: constraints.maxHeight,
            );
            if (_isDesktop(viewport)) {
              return _buildDesktop(context, l10n, loginState, socialState, anyLoading);
            }
            if (_isPhoneLandscape(viewport)) {
              return _buildPhoneLandscape(context, l10n, loginState, socialState, anyLoading);
            }
            // Portrait — cubre tanto mobile portrait como tablet
            // portrait (768×1024): un viewport orientado en vertical
            // nunca encaja en el split de escritorio (pensado para un
            // hero landscape), sin importar cuán ancho/alto sea en
            // términos absolutos — mismo criterio que `WelcomePage`.
            return _buildPortrait(context, l10n, loginState, socialState, anyLoading);
          },
        ),
      ),
    );
  }

  // -------------------------------------------------------------------
  // MOBILE PORTRAIT — KORIXA-SCREEN02-LOGIN-MOBILE-PORTRAIT-NO-LOGO-
  // 20260910: el dueño pidió el mismo tratamiento full-bleed que ya
  // tienen desktop/phone landscape — antes el hero solo ocupaba el 34%
  // superior de la pantalla, con el formulario debajo sobre un bloque
  // sólido `DarkTech.background` (no un panel/tarjeta, pero sí una
  // franja opaca inferior grande). Ahora el hero de Guatapé cubre la
  // pantalla COMPLETA, sin ningún bloque inferior opaco; el formulario
  // flota directamente sobre la foto, anclado abajo (mismo patrón ya
  // usado por `WelcomePage._MobileWelcomeContent`: `Align(bottomCenter)`
  // + `SingleChildScrollView(reverse: true)`, así el CTA sigue visible
  // primero si el contenido no entra completo en pantallas muy chicas).
  // Sin logo Korixa en esta composición (`showLogo: false`, pedido
  // explícito del dueño) — desktop y phone landscape SÍ lo conservan,
  // sin tocar sus llamadores.
  // -------------------------------------------------------------------

  Widget _buildPortrait(
    BuildContext context,
    AppLocalizations l10n,
    AsyncValue<void> loginState,
    AsyncValue<void> socialState,
    bool anyLoading,
  ) {
    return Stack(
      key: const Key('login-portrait-layout'),
      fit: StackFit.expand,
      children: <Widget>[
        const ExcludeSemantics(
          key: Key('login-hero-image'),
          // KORIXA-SCREEN02-MOBILE-BACKGROUND-ASSET-SWAP-20260911: el
          // dueño reemplazó el asset de fondo por una foto YA compuesta/
          // recortada para mobile portrait (`korixa_login_hero_guatape_
          // mobile.png`, 941×1672 — relación de aspecto ≈0.563, mucho
          // más cercana a un teléfono en vertical que el panorámico
          // 1672×941 que usaban desktop/landscape/mobile hasta esta
          // ronda), con el ciclista y el logo del jersey ya encuadrados
          // en la posición correcta — reemplaza por completo el ajuste
          // en tiempo de renderizado (`_LoginHeroCyclistFocus`,
          // `Transform.scale` + recorte, KORIXA-SCREEN02-FINAL-HERO-
          // LOGO-VISIBILITY-ONLY-20260911) que existía SOLO porque el
          // asset panorámico anterior no dejaba margen vertical para
          // reencuadrar con `alignment`. Con este archivo ya adaptado,
          // ese ajuste ya no hace falta — `BoxFit.cover` con
          // `Alignment.center` (sin zoom/transform adicional, pedido
          // explícito del encargo) ya deja el ciclista/logo/montaña
          // correctamente encuadrados de forma nativa. Desktop y phone
          // landscape NO se tocan — siguen usando el archivo panorámico
          // original (`korixa_login_hero_guatape.webp`) vía
          // [_LoginHeroImage], sin cambios.
          //
          // KORIXA-SCREEN02-USE-APPROVED-MOBILE-HERO-ASSET-20260911: el
          // dueño reemplazó el CONTENIDO del archivo (mismo nombre, mismas
          // dimensiones 941×1672, copiado byte a byte desde el archivo
          // aprobado que envió — sin recompresión ni edición) por una
          // versión con cielo cálido/dorado de extremo a extremo (sin la
          // franja de cielo azul del round anterior, KORIXA-SCREEN02-
          // SUBTITLE-CONTRAST-AND-SKY-REFINEMENT-20260911). Cero cambios
          // de código en este bloque — `imageAsset`/`alignment`/`fit` ya
          // eran exactamente lo pedido ("sin zoom/transform adicional,
          // asset directo"), así que esta ronda es puramente un
          // reemplazo de archivo.
          child: _LoginHeroImage(
            imageAsset: 'assets/images/korixa_login_hero_guatape_mobile.png',
            alignment: Alignment.center,
          ),
        ),
        // Mismo scrim vertical ya aprobado en Welcome mobile
        // (`AppGradients.imageScrimBottom`) — transparente arriba,
        // oscurece progresivamente hacia abajo, donde vive todo el
        // contenido ahora. Degradado general sin silueta de rectángulo
        // — permitido explícitamente ("overlay general/sombra de texto
        // sí, bloque opaco/tarjeta no").
        const Positioned.fill(
          child: DecoratedBox(decoration: BoxDecoration(gradient: AppGradients.imageScrimBottom)),
        ),
        SafeArea(
          // KORIXA-SCREEN02-FIXED-BLOCK-NO-MOVEMENT-20260911: corrección
          // sobre la ronda anterior (KORIXA-SCREEN02-MOBILE-VISUAL-
          // VIEWPORT-BOTTOM-ANCHOR-FIX-20260911) — el dueño grabó video
          // en dispositivo real mostrando que el grupo de contenido
          // TODAVÍA se desplazaba en un viewport normal, y pidió
          // explícitamente que la decisión de scroll NO se base en
          // preservar espacio escénico ni en un piso de altura artificial
          // (el `_minPortraitCompositionHeight` = 750 de esa ronda), sino
          // ÚNICAMENTE en si el contenido FUNCIONAL realmente entra o no
          // en el alto útil real — "sacrificar paisaje visible arriba
          // primero; solo si aun así no entra, habilitar scroll".
          //
          // Ya NO hay ningún piso de altura: `ConstrainedBox` más abajo
          // usa `minHeight: actualViewportHeight` (el alto real, sin
          // inflar) — el grupo se ancla al fondo de ESE alto real
          // siempre, así que el espacio escénico se reduce libremente
          // junto con el viewport (nunca se fuerza scroll solo para
          // "proteger" espacio escénico). El scroll se activa
          // ÚNICAMENTE cuando el alto NATURAL medido del grupo (título→
          // crear cuenta, `_portraitContentKey`) excede el alto real
          // disponible — medición real vía
          // `_schedulePortraitScrollFitMeasurement`, no una estimación:
          // el alto natural depende de la fuente/escala de accesibilidad
          // del dispositivo, no es un número fijo confiable de antemano.
          //
          // `SingleChildScrollView` sigue sin `reverse: true` — cuando SÍ
          // hace falta scroll, arranca mostrando el INICIO (foto+título),
          // así que Google/Crear cuenta quedan alcanzables scrolleando
          // hacia abajo, nunca ocultos scrolleando hacia arriba.
          child: LayoutBuilder(
            builder: (BuildContext context, BoxConstraints safeAreaConstraints) {
              final double actualViewportHeight = safeAreaConstraints.maxHeight;
              _schedulePortraitScrollFitMeasurement(actualViewportHeight);

              return Align(
                alignment: Alignment.topCenter,
                // KORIXA-SCREEN02-MATCH-SCREEN01-VISUAL-SYSTEM-20260910: mismo
                // tope de ancho (480) que ya usa `WelcomePage._MobileWelcomeContent`
                // (`welcome-content-max-width`) — sin esto, a 768×1024 (tablet
                // portrait) el bloque de contenido se estiraba a lo ancho
                // completo del viewport (720px útiles tras el padding),
                // mucho más ancho que cualquier formulario de Login legible;
                // SCREEN_01 ya resuelve exactamente este mismo caso acotando
                // a 480 y centrando, en vez de "estirar ciegamente las
                // dimensiones de teléfono" (pedido explícito del encargo).
                child: ConstrainedBox(
                  key: const Key('login-portrait-content-max-width'),
                  constraints: const BoxConstraints(maxWidth: 480),
                  // KORIXA-SCREEN02-MOBILE-VISUAL-VIEWPORT-BOTTOM-ANCHOR-
                  // FIX-20260911: fuerza al `SingleChildScrollView` de abajo
                  // a tener exactamente el alto REAL disponible (no el alto
                  // piso) — sin esto, restricciones sueltas dejarían al
                  // scrollview encogerse a su propio contenido en vez de
                  // establecer una ventana de scroll real del tamaño de la
                  // pantalla.
                  child: SizedBox(
                    height: actualViewportHeight,
                    child: SingleChildScrollView(
                      // KORIXA-SCREEN02-FIXED-BLOCK-NO-MOVEMENT-20260911:
                      // `NeverScrollableScrollPhysics` cuando
                      // `!_portraitScrollNeeded` (medido, ver
                      // `_schedulePortraitScrollFitMeasurement`) —
                      // desactiva por completo el reconocedor de gestos de
                      // arrastre/rebote/overscroll del `Scrollable` (no
                      // solo "clampea la posición a 0"; el widget deja de
                      // responder al gesto), así el grupo de contenido
                      // queda tan estático como si no hubiera ningún
                      // `ScrollView` — sin necesitar dos árboles de
                      // widgets distintos para cada caso. Cuando el
                      // contenido natural SÍ excede el alto real
                      // disponible, usa la física por defecto de la
                      // plataforma para permitir scrollear hacia Google/
                      // Crear cuenta.
                      physics: _portraitScrollNeeded ? null : const NeverScrollableScrollPhysics(),
                      child: ConstrainedBox(
                        // KORIXA-SCREEN02-FIXED-BLOCK-NO-MOVEMENT-20260911:
                        // `minHeight: actualViewportHeight` — SIN ningún
                        // piso artificial por encima del alto real (la
                        // ronda anterior usaba un piso fijo de 750 para
                        // "proteger" espacio escénico; el dueño pidió
                        // explícitamente eliminar ese razonamiento). Esto
                        // ancla el grupo al fondo del alto REAL cuando
                        // entra (sacrificando espacio escénico libremente
                        // según encoja el viewport, nunca forzando scroll
                        // solo para preservarlo) — y cuando el contenido
                        // NATURAL es más alto que esto, el propio `Column`
                        // de abajo crece más allá de este mínimo sin
                        // problema (las restricciones son un PISO, nunca
                        // un techo), habilitando el scroll real.
                        constraints: BoxConstraints(minHeight: actualViewportHeight),
                        child: Padding(
                          key: _portraitContentKey,
                          // KORIXA-SCREEN02-TRUE-BOTTOM-COMPOSITION-OWNER-CORRECTION-
                          // 20260911: el dueño corrigió explícitamente que el ajuste
                          // anterior (inset superior a `AppSpacing.xs` = 4, inferior
                          // sin tocar en 32) era "otro recorte incremental", no el
                          // cambio de composición MATERIAL pedido — a 390×844 el
                          // título seguía en y≈264, muy por debajo del objetivo
                          // (y>=340). Este inset superior baja a 0 (ya no hay más
                          // margen que recortar ahí sin volverse negativo) y el
                          // INFERIOR baja de 32 a `AppSpacing.sm` (8) — sigue habiendo
                          // un colchón real (más el propio `SafeArea`) entre "Crear
                          // cuenta" y el borde del dispositivo, solo que ya no
                          // reproduce el inset de 32 de `_MobileWelcomeContent`
                          // (Welcome no tiene el problema de "grupo demasiado alto"
                          // que motiva esta tarea, así que copiar su inset ahí ya no
                          // es el objetivo). Combinado con los otros ajustes de este
                          // método (`contentSectionGap`/`indicatorToCtaGap`/
                          // `fieldSpacingGap`/`titleToSubtitleGap`/`fieldContentPadding`/
                          // `ctaHeight`/`socialButtonHeight`/`tightenBottomActions`
                          // más abajo), el título pasa de y=264 a y>=340 — medido,
                          // no estimado (ver `login_page_test.dart`).
                          padding: const EdgeInsets.fromLTRB(AppSpacing.xl, 0, AppSpacing.xl, AppSpacing.sm),
                          child: Column(
                            // KORIXA-SCREEN02-FIXED-BLOCK-NO-MOVEMENT-
                            // 20260911: `mainAxisSize.min` (el `Column`
                            // reporta el alto natural de su único hijo) +
                            // `mainAxisAlignment.end` — cuando el
                            // `ConstrainedBox` de arriba fuerza un alto
                            // mayor al natural (viewport real > contenido
                            // real, el caso normal), este `Column` queda
                            // con ESE alto real (las restricciones del
                            // padre siempre ganan sobre la preferencia
                            // `min`) y `mainAxisAlignment.end` ancla su
                            // único hijo (el grupo real de Login) al fondo
                            // de ese espacio extra — el mismo patrón que
                            // un `Align(bottomCenter)`, pero definido en
                            // términos del alto REAL del viewport, sin
                            // ningún piso artificial de por medio. Cuando
                            // el contenido natural excede el alto real
                            // (viewport corto), este `Column` simplemente
                            // crece más allá — las restricciones son un
                            // piso, nunca un techo — habilitando el
                            // scroll real que la física de arriba permite
                            // en ese caso.
                            mainAxisSize: MainAxisSize.min,
                            mainAxisAlignment: MainAxisAlignment.end,
                            children: <Widget>[
                              _buildFormColumn(
                    context: context,
                    l10n: l10n,
                    loginState: loginState,
                    socialState: socialState,
                    anyLoading: anyLoading,
                    logoAsset: 'assets/icons/korixa_logo.png',
                    logoHeight: 40,
                    compact: false,
                    showLogo: false,
                    // KORIXA-SCREEN02-MATCH-SCREEN01-VISUAL-SYSTEM-20260910:
                    // `false` — SCREEN_01 nunca aplica sombra de texto a
                    // título/subtítulo, ni siquiera flotando directamente
                    // sobre la foto (confía solo en el mismo scrim
                    // `imageScrimBottom` que esta composición ya usa,
                    // idéntico al de Welcome mobile). `matchScreen01Typography`
                    // (abajo) cubre el resto del tratamiento tipográfico
                    // canónico.
                    floatingOverPhoto: false,
                    showIndicator: true,
                    indicatorKey: 'login-portrait-indicator-row',
                    indicatorBarWidth: 18,
                    indicatorBarHeight: 4,
                    indicatorBarGap: 5,
                    // KORIXA-SCREEN02-TRUE-BOTTOM-COMPOSITION-OWNER-
                    // CORRECTION-20260911: `AppSpacing.xs` (4, antes
                    // `AppSpacing.sm` = 8, que a su vez había reemplazado
                    // `AppSpacing.lg` = 20 del round anterior a este). Cada
                    // reducción adicional de este único gap se multiplica
                    // por las 2 veces que `contentSectionGap` lo usa más
                    // abajo — el dueño pidió un cambio MATERIAL, así que
                    // esta ronda lleva TODOS los gaps internos del grupo al
                    // valor más chico ya existente en el sistema de diseño
                    // (`AppSpacing.xs`), no solo el siguiente escalón.
                    indicatorToCtaGap: AppSpacing.xs,
                    // KORIXA-SCREEN02-TRUE-BOTTOM-COMPOSITION-OWNER-
                    // CORRECTION-20260911: `AppSpacing.xs` (4, antes
                    // `AppSpacing.sm` = 8) — mismo razonamiento que
                    // `indicatorToCtaGap` arriba; gobierna subtítulo→campos
                    // Y "olvidé mi contraseña"→indicador a la vez.
                    contentSectionGap: AppSpacing.xs,
                    // KORIXA-SCREEN02-TRUE-BOTTOM-COMPOSITION-OWNER-
                    // CORRECTION-20260911: nuevo — antes este gap
                    // (correo→contraseña) usaba el valor compartido
                    // `compact ? sm : base` (16 en mobile, igual que
                    // desktop/landscape) sin ningún override específico de
                    // mobile portrait. `AppSpacing.sm` (8) lo reduce a la
                    // mitad SOLO acá.
                    fieldSpacingGap: AppSpacing.sm,
                    // KORIXA-SCREEN02-TRUE-BOTTOM-COMPOSITION-OWNER-
                    // CORRECTION-20260911: nuevo — reduce el alto propio de
                    // cada campo (antes 56, `contentPadding` de 16 vertical
                    // heredado del `InputDecorationTheme` global) a ~48 sin
                    // tocar ese tema compartido — el piso táctil de 48
                    // pedido explícitamente por el encargo ("not smaller
                    // than approximately 48 logical px").
                    fieldContentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                    // KORIXA-SCREEN02-TRUE-BOTTOM-COMPOSITION-OWNER-
                    // CORRECTION-20260911: nuevo — mismo peso/gradiente/
                    // radio del CTA (`PrimaryGradientButton`, sin cambios),
                    // solo el alto baja de 52 (default) a 48 — el piso
                    // táctil pedido, no más abajo.
                    ctaHeight: 48,
                    // KORIXA-SCREEN02-TRUE-BOTTOM-COMPOSITION-OWNER-
                    // CORRECTION-20260911: nuevo — mismo widget/estilo de
                    // Google (`GoogleSignInButton`, sin cambios), envuelto
                    // en un `SizedBox` de 48 (ver `_maybeSizedBox`) en vez
                    // del alto de tema compartido (52) que Register/otras
                    // pantallas siguen usando sin cambios.
                    socialButtonHeight: 48,
                    // KORIXA-SCREEN02-TRUE-BOTTOM-COMPOSITION-OWNER-
                    // CORRECTION-20260911: nuevo — título→subtítulo baja de
                    // `AppSpacing.sm` (8, el valor fijo que este gap
                    // siempre tuvo en las 3 composiciones) a `AppSpacing.xs`
                    // (4), exclusivo de mobile portrait.
                    titleToSubtitleGap: AppSpacing.xs,
                    showFieldIcons: true,
                    // KORIXA-SCREEN02-MATCH-SCREEN01-VISUAL-SYSTEM-20260910:
                    // reemplaza `enhancedSubtitleContrast` (contraste ad
                    // hoc de la tarea anterior) por el tratamiento
                    // tipográfico CANÓNICO de SCREEN_01 — título en
                    // negrita (w800) centrado y subtítulo `bodyLarge`
                    // (16px) en `DarkTech.textSecondary`, ambos sin
                    // sombra, igual que "Conecta tu energía" en Welcome.
                    matchScreen01Typography: true,
                    // KORIXA-SCREEN02-SUBTITLE-CONTRAST-AND-SKY-
                    // REFINEMENT-20260911: el dueño pidió subir un poco
                    // la legibilidad del subtítulo específicamente en
                    // Login (no en Welcome) — ver el parámetro para el
                    // detalle exacto del ajuste (mezcla hacia blanco +
                    // sombra suave, sin cambiar tipografía/tamaño/
                    // posición).
                    subtitleContrastBoost: true,
                    // KORIXA-SCREEN02-FINAL-APPROVED-VISUAL-LOCK-20260911:
                    // el dueño fijó el diseño final aprobado y pidió
                    // explícitamente quitar la flecha decorativa del CTA
                    // (agregada en KORIXA-PR127-LOGIN-MOBILE-VISUAL-
                    // POLISH-20260910) — el botón principal debe quedar
                    // solo con el texto "Iniciar sesión", sin ícono. No se
                    // pasan `ctaIcon`/`ctaIconTrailing` — ambos vuelven a
                    // sus defaults (`null`/`false`), igual que desktop y
                    // phone landscape ya tenían siempre.
                    tightenBottomActions: true,
                  ),
                            ],
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
              );
            },
          ),
        ),
      ],
    );
  }

  // -------------------------------------------------------------------
  // PHONE LANDSCAPE — KORIXA-SCREEN02-LOGIN-NO-OUTER-CARD-20260910: el
  // dueño pidió eliminar por completo el panel de vidrio que envolvía el
  // formulario (`_GlassFormPanel`, KORIXA-SCREEN02-LOGIN-FULL-LANDSCAPE-
  // VISUAL-20260910) — "que se vea todo el paisaje... sin caja
  // contenedora visible". El formulario ahora vive directamente sobre el
  // hero, sin ningún `DecoratedBox`/`ClipRRect`/`BackdropFilter`
  // envolvente; el ancho sigue siendo un porcentaje real del viewport
  // (mismo criterio ya usado por `WelcomePage` en su propio landscape)
  // solo para acotar el largo de línea del texto, no para dibujar un
  // panel. Legibilidad vía `_LoginHeroContentScrim` (scrim general, sin
  // bordes duros) + sombra de texto en título/subtítulo
  // (`floatingOverPhoto: true` en [_buildFormColumn]) — cada campo/botón
  // conserva su propio estilo (relleno, borde, gradiente), tal como
  // pidió el encargo.
  // -------------------------------------------------------------------

  Widget _buildPhoneLandscape(
    BuildContext context,
    AppLocalizations l10n,
    AsyncValue<void> loginState,
    AsyncValue<void> socialState,
    bool anyLoading,
  ) {
    final double panelWidth = (MediaQuery.of(context).size.width * 0.56).clamp(260.0, 380.0);

    return Stack(
      key: const Key('login-landscape-layout'),
      fit: StackFit.expand,
      children: <Widget>[
        const ExcludeSemantics(
          key: Key('login-hero-image'),
          child: _LoginHeroImage(alignment: Alignment(0.35, 0)),
        ),
        const Positioned.fill(child: _LoginHeroContentScrim()),
        SafeArea(
          child: Align(
            alignment: Alignment.centerRight,
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md, vertical: AppSpacing.sm),
              child: ConstrainedBox(
                constraints: BoxConstraints(maxWidth: panelWidth),
                child: SingleChildScrollView(
                  child: _buildFormColumn(
                    context: context,
                    l10n: l10n,
                    loginState: loginState,
                    socialState: socialState,
                    anyLoading: anyLoading,
                    logoAsset: 'assets/icons/korixa_logo.png',
                    logoHeight: 32,
                    compact: true,
                    floatingOverPhoto: true,
                  ),
                ),
              ),
            ),
          ),
        ),
      ],
    );
  }

  // -------------------------------------------------------------------
  // DESKTOP — KORIXA-SCREEN02-LOGIN-NO-OUTER-CARD-20260910: el dueño
  // pidió eliminar por completo el panel de vidrio que envolvía el
  // formulario (`_GlassFormPanel`, KORIXA-SCREEN02-LOGIN-FULL-LANDSCAPE-
  // VISUAL-20260910 — blur + superficie translúcida + borde, todavía
  // leído como "una tarjeta grande envolviendo todo") — "que se vea
  // todo el paisaje... sin caja contenedora visible". El formulario
  // ahora vive DIRECTAMENTE sobre el hero: sin `ClipRRect`, sin
  // `BackdropFilter`, sin `DecoratedBox`/`ColoredBox` envolvente, sin
  // fondo rectangular translúcido de ningún tipo. El `ConstrainedBox`
  // que queda solo acota el ancho de línea del texto (420) — no dibuja
  // nada, es puramente de layout. Legibilidad vía `_LoginHeroContentScrim`
  // (overlay general, sin bordes duros) + sombra de texto en
  // título/subtítulo (`floatingOverPhoto: true` en [_buildFormColumn]);
  // cada campo/botón (email, contraseña, CTA, Google) conserva su propio
  // relleno/borde/gradiente ya existente en el sistema de diseño, tal
  // como pidió el encargo — eso NO es la "caja envolvente" que se quitó.
  // -------------------------------------------------------------------

  Widget _buildDesktop(
    BuildContext context,
    AppLocalizations l10n,
    AsyncValue<void> loginState,
    AsyncValue<void> socialState,
    bool anyLoading,
  ) {
    return Stack(
      key: const Key('login-desktop-layout'),
      fit: StackFit.expand,
      children: <Widget>[
        const ExcludeSemantics(
          key: Key('login-hero-image'),
          child: _LoginHeroImage(alignment: Alignment(0.15, 0)),
        ),
        // Overlay general y sutil (sin bordes duros, sin forma de
        // rectángulo aislado) — transparente en el centro/izquierda,
        // donde el paisaje debe verse sin ningún velo, oscureciendo solo
        // gradualmente hacia el borde derecho para reforzar el contraste
        // del texto que flota ahí. Nunca tapa el resto de la foto.
        const Positioned.fill(child: _LoginHeroContentScrim()),
        SafeArea(
          child: Align(
            alignment: Alignment.centerRight,
            child: Padding(
              padding: const EdgeInsets.all(AppSpacing.xxxl),
              child: ConstrainedBox(
                key: const Key('login-desktop-content-max-width'),
                constraints: const BoxConstraints(maxWidth: _desktopContentMaxWidth),
                child: SingleChildScrollView(
                  child: _buildFormColumn(
                    context: context,
                    l10n: l10n,
                    loginState: loginState,
                    socialState: socialState,
                    anyLoading: anyLoading,
                    logoAsset: 'assets/icons/korixa_logo_desktop.png',
                    logoHeight: _desktopLogoHeight,
                    compact: false,
                    highQualityLogo: true,
                    floatingOverPhoto: true,
                    controlWidth: _desktopControlWidth,
                    titleFontSize: _desktopTitleFontSize,
                    subtitleFontSize: _desktopSubtitleFontSize,
                    ctaHeight: _desktopCtaHeight,
                    ctaFontSize: _desktopCtaFontSize,
                    showIndicator: true,
                  ),
                ),
              ),
            ),
          ),
        ),
      ],
    );
  }

  // KORIXA-SCREEN02-TRUE-BOTTOM-COMPOSITION-OWNER-CORRECTION-20260911: fija
  // el alto de UN botón (Google/Apple) sin tocar `OutlinedButtonThemeData`/
  // `FilledButtonThemeData` (compartidos por toda la app) — `SizedBox` con
  // un alto explícito impone una restricción tight que gana sobre el
  // `minimumSize` más grande del tema (técnica estándar de Flutter, no un
  // hack). `height == null` devuelve el widget sin envolver, preservando
  // el alto de tema de siempre para todo llamador que no pase este
  // parámetro.
  Widget _maybeSizedBox(double? height, Widget child) {
    if (height == null) return child;
    return SizedBox(height: height, child: child);
  }

  // -------------------------------------------------------------------
  // Formulario compartido — idéntico contenido/orden/comportamiento en
  // las 3 composiciones, solo cambia el logo/tamaños vía [compact]. Toda
  // la lógica de auth (validación, loading, error, Future<bool>,
  // navegación) es la misma que ya existía antes de esta tarea.
  // -------------------------------------------------------------------

  Widget _buildFormColumn({
    required BuildContext context,
    required AppLocalizations l10n,
    required AsyncValue<void> loginState,
    required AsyncValue<void> socialState,
    required bool anyLoading,
    required String logoAsset,
    required double logoHeight,
    required bool compact,
    bool highQualityLogo = false,
    // KORIXA-SCREEN02-LOGIN-NO-OUTER-CARD-20260910: `true` en desktop y
    // phone landscape, donde el formulario ya no vive dentro de ningún
    // panel/tarjeta — el título/subtítulo quedan directamente sobre la
    // foto, así que reciben una sombra de texto suave para legibilidad
    // (permitida explícitamente por el encargo: "sombras suaves ... si
    // hace falta").
    //
    // KORIXA-SCREEN02-MATCH-SCREEN01-VISUAL-SYSTEM-20260910: `false` en
    // mobile portrait (antes `true`, KORIXA-PR127-LOGIN-MOBILE-VISUAL-
    // POLISH-20260910) — SCREEN_01 nunca usa sombra de texto, ni siquiera
    // flotando directamente sobre su propia foto, porque ya confía en el
    // mismo scrim `imageScrimBottom` que mobile portrait usa desde el
    // full-bleed de KORIXA-SCREEN02-LOGIN-MOBILE-PORTRAIT-NO-LOGO-
    // 20260910. Desktop/phone landscape usan `_LoginHeroContentScrim`
    // (un scrim horizontal más angosto, sin la misma cobertura vertical),
    // así que conservan su sombra existente sin cambios.
    bool floatingOverPhoto = false,
    // KORIXA-SCREEN02-LOGIN-MATCH-SCREEN01-DESKTOP-SCALE-20260910: `null`
    // (portrait/landscape, sin cambios) conserva el único `Column` con
    // `crossAxisAlignment.stretch` de siempre — logo/título/subtítulo y
    // los controles comparten el mismo ancho completo, exactamente como
    // antes de esta tarea. Cuando no es `null` (solo desktop, 550).
    // logo/título/subtítulo dejan de estirarse al ancho completo del
    // bloque exterior (`crossAxisAlignment.end`, igual que
    // `WelcomePage._DesktopWelcomeContent`) y los controles interactivos
    // (campos, CTA, divisor, Google/Apple, enlaces) quedan envueltos en
    // un `SizedBox` de este ancho — la misma jerarquía "región exterior
    // ancha / control angosto" ya aprobada en SCREEN_01.
    double? controlWidth,
    double? titleFontSize,
    double? subtitleFontSize,
    double? ctaHeight,
    double? ctaFontSize,
    // KORIXA-SCREEN02-LOGIN-ALIGNMENT-INDICATOR-POLISH-20260910: `true`
    // en desktop y (desde KORIXA-SCREEN02-LOGIN-MOBILE-PORTRAIT-NO-LOGO-
    // 20260910) también en mobile portrait — el mismo indicador de 3
    // barras de SCREEN_01, con su propio tamaño por composición vía
    // [indicatorBarWidth]/[indicatorBarHeight]/[indicatorBarGap]. Phone
    // landscape no lo recibe (sin cambio visual, fuera de alcance).
    bool showIndicator = false,
    String indicatorKey = 'login-desktop-indicator-row',
    double indicatorBarWidth = 24,
    double indicatorBarHeight = 4,
    double indicatorBarGap = 6,
    // KORIXA-SCREEN02-MATCH-SCREEN01-VISUAL-SYSTEM-20260910: `null`
    // preserva `sectionGap` (comportamiento exacto de todo llamador
    // existente) como separación indicador→CTA.
    //
    // KORIXA-SCREEN02-BOTTOM-ANCHORED-COMPOSITION-20260910: mobile
    // portrait ahora pasa `AppSpacing.sm` (8, antes `AppSpacing.lg` = 20)
    // — el dueño pidió explícitamente que el título/subtítulo/campos/
    // indicador/CTA/Google/crear-cuenta se comporten como UN SOLO grupo
    // compacto anclado abajo, no que el indicador quede "flotando" con
    // el mismo respiro amplio que tenía en SCREEN_01 (donde es el ÚNICO
    // elemento entre el subtítulo y el CTA). Login tiene 6 elementos más
    // que Welcome entre el subtítulo y el CTA — cada gap generoso ahí
    // empuja todo el grupo más arriba, dejando menos foto visible
    // arriba (justo lo que el dueño reportó como incorrecto).
    double? indicatorToCtaGap,
    // KORIXA-SCREEN02-BOTTOM-ANCHORED-COMPOSITION-20260910: `null`
    // preserva `sectionGap` en los 2 lugares que lo usan directamente
    // (subtítulo→controles en la rama compartida portrait/landscape, y
    // "olvidé mi contraseña"→indicador, compartida con desktop) — cero
    // cambio para desktop/phone landscape. Mobile portrait pasa
    // `AppSpacing.sm` (8, antes 24) en ambos — reduce la altura TOTAL
    // del grupo de contenido (ya anclado al fondo vía `Align(bottomCenter)`
    // desde `_buildPortrait`), lo que dado el anclaje inferior visualmente
    // BAJA el borde superior del grupo (más foto de Guatapé visible
    // arriba) sin tocar el estilo de ningún elemento individual (título/
    // subtítulo/campos/CTA/Google quedan pixel-a-pixel iguales, solo se
    // acercan entre sí).
    double? contentSectionGap,
    // KORIXA-SCREEN02-TRUE-BOTTOM-COMPOSITION-OWNER-CORRECTION-20260911:
    // 4 parámetros nuevos, todos EXCLUSIVOS de mobile portrait (`null`/
    // default preserva el comportamiento exacto de todo otro llamador) —
    // el dueño pidió un cambio de composición MATERIAL, no otro recorte
    // incremental de separaciones: además de achicar gaps, esta vez
    // también se reduce la altura propia de campos/CTA/Google (siempre
    // >= 48px, el piso táctil pedido explícitamente por el encargo).
    //
    // `titleToSubtitleGap`: `null` preserva `AppSpacing.sm` (el valor fijo
    // que este gap siempre tuvo, en las 3 composiciones).
    double? titleToSubtitleGap,
    // `fieldSpacingGap`: `null` preserva `compact ? sm : base` (el
    // comportamiento exacto de siempre entre el campo de correo y el de
    // contraseña).
    double? fieldSpacingGap,
    // `fieldContentPadding`: `null` deja que `TextFormField` herede el
    // `contentPadding` del `InputDecorationTheme` global de la app (16
    // vertical, compartido por TODA la app — nunca se toca acá). Mobile
    // portrait pasa un valor más chico (12 vertical) SOLO en su propia
    // instancia de `InputDecoration`, reduciendo el alto total de cada
    // campo de 56 a ~48 sin afectar Register/otros formularios que usan
    // el mismo tema.
    EdgeInsetsGeometry? fieldContentPadding,
    // `socialButtonHeight`: `null` deja que Google/Apple usen su alto de
    // tema de siempre (52, `OutlinedButtonThemeData`/`FilledButtonThemeData`
    // compartidos — NO se tocan). Mobile portrait envuelve la instancia en
    // un `SizedBox` de este alto (48) — técnica estándar de Flutter para
    // fijar el alto de UN botón sin tocar el tema global que usan otras
    // pantallas.
    double? socialButtonHeight,
    // KORIXA-SCREEN02-LOGIN-MOBILE-PORTRAIT-NO-LOGO-20260910: el dueño
    // pidió que mobile portrait NO muestre el logo Korixa — sin dejar el
    // espacio en blanco donde iría (`showLogo: false` omite tanto el
    // `Image.asset` como su `SizedBox` de separación siguiente, no solo
    // lo oculta visualmente). Desktop y phone landscape conservan el
    // logo (`showLogo` default `true`, sin tocar sus llamadores).
    bool showLogo = true,
    // KORIXA-PR127-LOGIN-MOBILE-VISUAL-POLISH-20260910: los siguientes 5
    // parámetros son EXCLUSIVOS de mobile portrait — todos con default
    // que preserva el comportamiento actual de desktop/phone landscape
    // sin tocar sus llamadores.
    //
    // Íconos mail/lock a la izquierda de los campos (Material, ya
    // incluidos en el SDK — cero dependencias nuevas).
    bool showFieldIcons = false,
    // KORIXA-SCREEN02-MATCH-SCREEN01-VISUAL-SYSTEM-20260910: reemplaza al
    // anterior `enhancedSubtitleContrast` (contraste ad hoc de blanco +
    // sombra fuerte, KORIXA-PR127-LOGIN-MOBILE-VISUAL-POLISH-20260910).
    // El dueño pidió que SCREEN_02 herede el sistema tipográfico EXACTO
    // ya aprobado en SCREEN_01 ("Conecta tu energía."), no una variante
    // propia — con `true`: título en `headlineMedium` w800 centrado
    // (igual que el título mobile de Welcome) y subtítulo en `bodyLarge`
    // (16px, en vez del `bodyMedium` de 14px anterior) en
    // `DarkTech.textSecondary`, ambos SIN sombra de texto — Welcome nunca
    // usa sombra en título/subtítulo, ni flotando directamente sobre la
    // foto, porque ya confía en el mismo scrim `imageScrimBottom` que
    // esta composición usa. Solo mobile portrait pasa `true`; desktop y
    // phone landscape quedan con su tratamiento actual sin cambios.
    bool matchScreen01Typography = false,
    // KORIXA-SCREEN02-SUBTITLE-CONTRAST-AND-SKY-REFINEMENT-20260911:
    // `false` preserva el subtítulo canónico de SCREEN_01 (sin sombra,
    // `DarkTech.textSecondary` puro) para todo llamador existente.
    // Mobile portrait pasa `true` — el dueño pidió específicamente MÁS
    // legibilidad que SCREEN_01 en esta pantalla (Login vive sobre un
    // encuadre distinto del hero, con zonas más claras del cielo detrás
    // del subtítulo), vía un ajuste sutil: un poco más de blanco (mezcla
    // 45% hacia `Colors.white`, no blanco puro — sigue leyéndose
    // "secundario", más tenue que el título, por peso de fuente) + UNA
    // sombra suave (alpha 0.45, blur 6 — perceptible solo como
    // contraste extra, no como un halo). No cambia tipografía, tamaño
    // ni posición del subtítulo.
    bool subtitleContrastBoost = false,
    // Ícono decorativo dentro del CTA — `iconTrailing: true` lo ubica a
    // la derecha del texto (mockup aprobado por el dueño). Nunca cambia
    // `onPressed`/semántica del botón (ver `PrimaryGradientButton`).
    IconData? ctaIcon,
    bool ctaIconTrailing = false,
    // Reduce los gaps ENTRE CTA→divisor→Google→Crear-cuenta
    // específicamente (no toca el gap logo→título→subtítulo→campos) —
    // el dueño pidió que este grupo se sienta "más junto", sin tocar
    // `sectionGap`/`dividerGap` en el resto del formulario.
    bool tightenBottomActions = false,
  }) {
    final TextTheme textTheme = Theme.of(context).textTheme;
    final double sectionGap = compact ? AppSpacing.sm : AppSpacing.xl;
    final double dividerGap = compact ? AppSpacing.sm : AppSpacing.lg;
    // KORIXA-PR127-LOGIN-MOBILE-VISUAL-POLISH-20260910: el dueño pidió
    // que el grupo CTA→Google→Crear-cuenta se sienta "más junto" en
    // mobile portrait — gaps más chicos SOLO entre esos 3 elementos,
    // sin tocar `sectionGap`/`dividerGap` (siguen gobernando el resto
    // del formulario, incluida la separación logo→título→subtítulo→
    // campos, que el encargo no pidió tocar).
    // KORIXA-SCREEN02-TRUE-BOTTOM-COMPOSITION-OWNER-CORRECTION-20260911:
    // `AppSpacing.xs` (4, antes `AppSpacing.sm` = 8) — el dueño pidió un
    // cambio de composición MATERIAL, no otro recorte cosmético; este
    // gap gobierna 2 de las separaciones del grupo inferior (CTA→divisor
    // y Google→"¿No tienes cuenta?"), así que reducirlo aporta el doble
    // de altura ahorrada. `tightenBottomActions` sigue siendo exclusivo
    // de mobile portrait (desktop/landscape nunca lo activan).
    final double bottomActionGap = tightenBottomActions ? AppSpacing.xs : sectionGap;
    final double bottomDividerGap = tightenBottomActions ? AppSpacing.xs : dividerGap;
    // KORIXA-SCREEN02-BOTTOM-ANCHORED-COMPOSITION-20260910: override SOLO
    // para las 2 separaciones "sueltas" que quedaban entre subtítulo y
    // controles, y entre "olvidé mi contraseña" e indicador — ver
    // [contentSectionGap] más arriba. `bottomActionGap` (arriba) ya tiene
    // su propio mecanismo de ajuste (`tightenBottomActions`) y no se toca
    // acá.
    final double effectiveSectionGap = contentSectionGap ?? sectionGap;
    final List<Shadow>? legibilityShadow = floatingOverPhoto
        ? <Shadow>[Shadow(color: Colors.black.withValues(alpha: 0.65), blurRadius: 10)]
        : null;
    // KORIXA-SCREEN02-LOGIN-ALIGNMENT-INDICATOR-POLISH-20260910: cuando
    // el bloque tiene un ancho de control fijo (solo desktop), el dueño
    // pidió que logo/título/subtítulo queden centrados sobre ese mismo
    // ancho en vez de alineados a la derecha — ver [content] más abajo.
    final bool isDesktopScale = controlWidth != null;

    // KORIXA-SCREEN02-LOGIN-VISUAL-IMPLEMENTATION-20260907: branding
    // Korixa — antes esta pantalla no tenía NINGÚN logo (auditoría
    // KORIXA-SCREEN02-LOGIN-BASELINE-AUDIT-20260906, hallazgo P0). Mismos
    // archivos ya aprobados que usa/usaba Welcome (`korixa_logo.png`
    // mobile/landscape, `korixa_logo_desktop.png` desktop) — ningún logo
    // nuevo.
    // KORIXA-SCREEN02-LOGIN-DESKTOP-POLISH-LOGO-PANEL-20260907: en
    // desktop el logo se decodificaba al tamaño lógico completo del
    // asset (927px de alto) y se reducía a solo 56px vía el filtro de
    // baja calidad por defecto de `Image` — visible como bordes dentados
    // en el texto al hacer zoom sobre la captura. Decodificar directo al
    // tamaño físico real (`cacheHeight` según devicePixelRatio) +
    // `FilterQuality.high` da un resample nítido en vez de ese downscale
    // en vivo. Solo aplica en desktop (`highQualityLogo`) —
    // portrait/landscape quedan bit-a-bit iguales a como estaban (mismo
    // asset, mismo tamaño, sin cambio).
    final Widget logoWidget = Image.asset(
      logoAsset,
      key: const Key('login-logo'),
      height: logoHeight,
      fit: BoxFit.contain,
      filterQuality: highQualityLogo ? FilterQuality.high : FilterQuality.low,
      cacheHeight: highQualityLogo ? (logoHeight * MediaQuery.of(context).devicePixelRatio).round() : null,
      semanticLabel: 'Korixa',
    );

    final Widget titleWidget = Text(
      l10n.loginTitle,
      key: const Key('login-title'),
      // KORIXA-SCREEN02-LOGIN-ALIGNMENT-INDICATOR-POLISH-20260910: el
      // dueño reportó el título/subtítulo "alineados a la derecha
      // respecto al formulario" — `textAlign: center` centra el/los
      // renglones DENTRO de su propia caja (necesario en particular si
      // algún día el texto ocupa 2 líneas de distinto largo); el
      // centrado de la caja en sí respecto a la columna de 550 lo da
      // `crossAxisAlignment.center` en [content] más abajo.
      textAlign: (isDesktopScale || matchScreen01Typography) ? TextAlign.center : null,
      style: textTheme.headlineMedium?.copyWith(
        fontSize: titleFontSize ?? (compact ? 22 : null),
        // KORIXA-SCREEN02-LOGIN-MATCH-SCREEN01-DESKTOP-SCALE-20260910:
        // mismo peso/tracking/interlineado que el título de escritorio de
        // Welcome (`_DesktopWelcomeContent`) — solo aplica cuando se pide
        // el tamaño grande de desktop (`titleFontSize` no nulo).
        // KORIXA-SCREEN02-MATCH-SCREEN01-VISUAL-SYSTEM-20260910: mobile
        // portrait (`matchScreen01Typography`) también fuerza `w800` —
        // el mismo peso de "Conecta tu energía." en Welcome mobile
        // (`headlineMedium` con `fontWeight: FontWeight.w800`); sin este
        // override el título de Login quedaba en el `w700` por defecto
        // de `headlineMedium`, un peso visualmente más liviano que el ya
        // aprobado en SCREEN_01.
        fontWeight: (titleFontSize != null || matchScreen01Typography) ? FontWeight.w800 : null,
        letterSpacing: titleFontSize != null ? -0.5 : null,
        height: titleFontSize != null ? 1.08 : null,
        shadows: legibilityShadow,
      ),
    );

    final Widget subtitleWidget = Text(
      l10n.loginSubtitle,
      key: const Key('login-subtitle'),
      // KORIXA-SCREEN02-LOGIN-SUBTITLE-POSITION-CENTER-ACTIVE-INDICATOR-
      // 20260910: sin `textAlign` por defecto (`null`) fuera de mobile
      // portrait — el dueño pidió deshacer específicamente la posición
      // horizontal del subtítulo de desktop; combinado con que este
      // widget ya no vive dentro del `SizedBox` de 550 (ver [content] más
      // abajo), esto reproduce exactamente su posición/alineación
      // anterior en desktop/phone landscape, sin cambios.
      //
      // KORIXA-SCREEN02-MATCH-SCREEN01-VISUAL-SYSTEM-20260910: mobile
      // portrait (`matchScreen01Typography`) SÍ centra — igual que el
      // subtítulo de Welcome mobile (`textAlign: TextAlign.center`).
      textAlign: matchScreen01Typography ? TextAlign.center : null,
      // KORIXA-SCREEN02-MATCH-SCREEN01-VISUAL-SYSTEM-20260910:
      // `matchScreen01Typography` usa `bodyLarge` (16px) — el mismo
      // tamaño base del subtítulo de Welcome mobile — en vez del
      // `bodyMedium` (14px) que este subtítulo usaba antes. El color
      // sigue siendo `DarkTech.textSecondary` en ambos casos (ya era el
      // color por defecto de `bodyMedium`, ahora explícito porque
      // `bodyLarge` por defecto usa el color de texto PRIMARIO). Sin
      // sombra cuando se pide el estilo canónico: Welcome nunca aplica
      // sombra a su subtítulo, ni flotando directamente sobre la foto —
      // confía en el mismo scrim `imageScrimBottom` que esta composición
      // ya usa (reemplaza el contraste ad hoc de blanco+sombra fuerte de
      // KORIXA-PR127-LOGIN-MOBILE-VISUAL-POLISH-20260910).
      style: (matchScreen01Typography ? textTheme.bodyLarge : textTheme.bodyMedium)?.copyWith(
        fontSize: subtitleFontSize,
        color: subtitleContrastBoost
            ? Color.lerp(DarkTech.textSecondary, Colors.white, 0.45)
            : DarkTech.textSecondary,
        fontWeight: subtitleFontSize != null ? FontWeight.w500 : null,
        shadows: subtitleContrastBoost
            ? <Shadow>[Shadow(color: Colors.black.withValues(alpha: 0.45), blurRadius: 6)]
            : (matchScreen01Typography ? null : legibilityShadow),
      ),
    );

    final List<Widget> controlChildren = <Widget>[
      TextFormField(
        controller: _emailController,
        keyboardType: TextInputType.emailAddress,
        textInputAction: TextInputAction.next,
        autofillHints: const <String>[AutofillHints.email],
        decoration: InputDecoration(
          labelText: l10n.emailLabel,
          prefixIcon: showFieldIcons ? const Icon(Icons.mail_outline) : null,
          contentPadding: fieldContentPadding,
        ),
        validator: (String? value) => Validators.email(value).message(l10n),
      ),
      SizedBox(height: fieldSpacingGap ?? (compact ? AppSpacing.sm : AppSpacing.base)),
      TextFormField(
        controller: _passwordController,
        obscureText: _obscurePassword,
        textInputAction: TextInputAction.done,
        autofillHints: const <String>[AutofillHints.password],
        decoration: InputDecoration(
          labelText: l10n.passwordLabel,
          prefixIcon: showFieldIcons ? const Icon(Icons.lock_outline) : null,
          contentPadding: fieldContentPadding,
          suffixIcon: Semantics(
            // `toggled` anuncia al lector de pantalla el estado actual
            // (mostrando/ocultando), no solo "botón" — sin esto,
            // VoiceOver/TalkBack solo dirían "botón, doble toque para
            // activar", sin que la persona sepa qué hace ni en qué
            // estado está.
            key: const Key('login-password-visibility-semantics'),
            label: _obscurePassword ? l10n.showPasswordAction : l10n.hidePasswordAction,
            toggled: !_obscurePassword,
            child: IconButton(
              tooltip: _obscurePassword ? l10n.showPasswordAction : l10n.hidePasswordAction,
              icon: Icon(_obscurePassword ? Icons.visibility_outlined : Icons.visibility_off_outlined),
              onPressed: () => setState(() => _obscurePassword = !_obscurePassword),
            ),
          ),
        ),
        onFieldSubmitted: (_) => _handleSubmit(),
        // En login (a diferencia de registro) solo se exige que no esté
        // vacío — no se re-valida la política de complejidad de una
        // contraseña ya creada.
        validator: (String? value) {
          if (value == null || value.isEmpty) {
            return ValidationError.passwordRequired.message(l10n);
          }
          return null;
        },
      ),
      Align(
        alignment: Alignment.centerRight,
        child: TextButton(
          onPressed: () => context.push(AppRoute.forgotPassword),
          child: Text(l10n.forgotPasswordLink),
        ),
      ),
      if (showIndicator) ...<Widget>[
        SizedBox(height: effectiveSectionGap),
        // KORIXA-SCREEN02-LOGIN-ALIGNMENT-INDICATOR-POLISH-20260910: el
        // dueño pidió explícitamente "las 3 líneas de la pantalla 1" —
        // reusa `ThreeBarIndicator` (extraído desde `WelcomePage` a
        // `core/design_system/dark_tech_indicators.dart`, ver ese
        // archivo) con los MISMOS parámetros que
        // `_DesktopOnboardingIndicator` de Welcome (24×4, separación 6),
        // no una aproximación visual. Puramente decorativo: sin
        // swipe/navegación/estado. `Center` lo alinea al centro de esta
        // columna de 550 — la misma columna que fields/CTA/Google.
        //
        // KORIXA-SCREEN02-LOGIN-SUBTITLE-POSITION-CENTER-ACTIVE-
        // INDICATOR-20260910: `activeIndex: 1` — el dueño pidió que la
        // barra CENTRAL (no la primera, como en Welcome) sea la activa
        // en Login específicamente, para distinguir visualmente los dos
        // indicadores. Welcome sigue con el default (`activeIndex: 0`,
        // sin tocar su propio llamador) — sigue sin representar ningún
        // progreso de autenticación real en ninguna de las 2 pantallas.
        Center(
          child: ThreeBarIndicator(
            key: Key(indicatorKey),
            barWidth: indicatorBarWidth,
            barHeight: indicatorBarHeight,
            gap: indicatorBarGap,
            activeIndex: 1,
          ),
        ),
      ],
      // KORIXA-SCREEN02-LOGIN-ALIGNMENT-INDICATOR-POLISH-20260910: el
      // dueño marcó una separación intencional entre el indicador y el
      // CTA en su captura anotada — `sectionGap` (24 en desktop) en vez
      // del `AppSpacing.xs` (4) anterior, que dejaba el CTA pegado
      // directamente al enlace de "Olvidé mi contraseña".
      SizedBox(height: showIndicator ? (indicatorToCtaGap ?? sectionGap) : AppSpacing.xs),
      PrimaryGradientButton(
        label: l10n.loginButton,
        isLoading: loginState.isLoading,
        onPressed: anyLoading ? null : _handleSubmit,
        height: ctaHeight ?? 52,
        fontSize: ctaFontSize,
        icon: ctaIcon,
        iconTrailing: ctaIconTrailing,
      ),
      SizedBox(height: bottomActionGap),
      Row(
        children: <Widget>[
          const Expanded(child: Divider()),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md),
            child: Text(l10n.orDividerText, style: textTheme.bodySmall),
          ),
          const Expanded(child: Divider()),
        ],
      ),
      SizedBox(height: bottomDividerGap),
      _maybeSizedBox(
        socialButtonHeight,
        GoogleSignInButton(
          label: l10n.continueWithGoogle,
          isLoading: socialState.isLoading,
          onPressed: anyLoading
              ? null
              : () => _handleSocialSignIn(
                    ref.read(socialAuthControllerProvider.notifier).signInWithGoogle,
                  ),
        ),
      ),
      if (_isApplePlatform) ...<Widget>[
        const SizedBox(height: AppSpacing.md),
        _maybeSizedBox(
          socialButtonHeight,
          AppleSignInButton(
            label: l10n.continueWithApple,
            isLoading: socialState.isLoading,
            onPressed: anyLoading
                ? null
                : () => _handleSocialSignIn(
                      ref.read(socialAuthControllerProvider.notifier).signInWithApple,
                    ),
          ),
        ),
      ],
      SizedBox(height: bottomActionGap),
      Wrap(
        alignment: WrapAlignment.center,
        crossAxisAlignment: WrapCrossAlignment.center,
        children: <Widget>[
          Text(l10n.noAccountText, style: TextStyle(shadows: legibilityShadow)),
          TextButton(
            onPressed: () => context.go(AppRoute.register),
            child: Text(l10n.createAccountLink),
          ),
        ],
      ),
    ];

    final Widget content = controlWidth != null
        ? Column(
            // KORIXA-SCREEN02-LOGIN-SUBTITLE-POSITION-CENTER-ACTIVE-
            // INDICATOR-20260910: el dueño pidió deshacer SOLO la
            // posición horizontal del subtítulo (volver a la posición
            // previa a KORIXA-SCREEN02-LOGIN-ALIGNMENT-INDICATOR-POLISH-
            // 20260910), manteniendo logo/título centrados sobre la
            // columna de 550 exactamente como quedaron en esa tarea. El
            // subtítulo ahora es HERMANO de los dos `SizedBox(width:
            // controlWidth)` (logo+título, y controles), no su hijo —
            // como texto sin ancho propio fijo, su caja reportada sigue
            // el ancho MÁXIMO disponible (comportamiento de `Text`, ver
            // `textWidthBasis`), que es más ancho que 550 — por eso este
            // `Column` exterior usa `crossAxisAlignment.end`: cada hijo
            // queda con su borde derecho pegado al mismo borde (el de
            // este `Column`, anclado a la derecha por el `Align` de
            // `_buildDesktop`), sin importar su propio ancho. Los dos
            // `SizedBox` de 550 (con el mismo ancho exacto que antes)
            // terminan en la MISMA posición final que ya tenían — medido
            // y verificado, no adivinado — mientras que el subtítulo,
            // más ancho, se extiende más hacia la izquierda,
            // reproduciendo EXACTAMENTE la posición horizontal medida en
            // el commit de referencia `0d748ec723bd96d1260cddfdec8ff8944cc867c5`
            // (antes de KORIXA-SCREEN02-LOGIN-ALIGNMENT-INDICATOR-POLISH-
            // 20260910).
            crossAxisAlignment: CrossAxisAlignment.end,
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              SizedBox(
                key: const Key('login-desktop-header-width'),
                width: controlWidth,
                child: Column(
                  key: const Key('login-desktop-content-group'),
                  crossAxisAlignment: CrossAxisAlignment.center,
                  mainAxisSize: MainAxisSize.min,
                  children: <Widget>[
                    if (showLogo) ...<Widget>[
                      logoWidget,
                      SizedBox(height: compact ? AppSpacing.sm : AppSpacing.lg),
                    ],
                    titleWidget,
                  ],
                ),
              ),
              const SizedBox(height: AppSpacing.sm),
              subtitleWidget,
              SizedBox(height: sectionGap),
              SizedBox(
                key: const Key('login-desktop-control-width'),
                width: controlWidth,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  mainAxisSize: MainAxisSize.min,
                  children: controlChildren,
                ),
              ),
            ],
          )
        : Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              if (showLogo) ...<Widget>[
                logoWidget,
                SizedBox(height: compact ? AppSpacing.sm : AppSpacing.lg),
              ],
              titleWidget,
              SizedBox(height: titleToSubtitleGap ?? AppSpacing.sm),
              subtitleWidget,
              SizedBox(height: effectiveSectionGap),
              ...controlChildren,
            ],
          );

    return Form(key: _formKey, child: content);
  }
}

/// Hero de Guatapé / Piedra del Peñol aprobado por el dueño — reusado
/// en las 3 composiciones (portrait/landscape/desktop), cada una con su
/// propio `alignment` según la forma real del contenedor (ver cada
/// composición en `LoginPage`). `BoxFit.cover` en las 3 — nunca se
/// escala/recolorea/redibuja la foto en sí.
///
/// KORIXA-SCREEN02-MOBILE-BACKGROUND-ASSET-SWAP-20260911: [imageAsset]
/// agregado con default `korixa_login_hero_guatape.webp` (el panorámico
/// original, 1672×941) — preserva el comportamiento exacto de desktop y
/// phone landscape, que no lo pasan y siguen sin cambios. Mobile
/// portrait pasa el nuevo archivo dedicado, ya compuesto/recortado para
/// formato teléfono por el dueño (`korixa_login_hero_guatape_mobile.png`,
/// 941×1672) — ya NO necesita el ajuste de zoom en tiempo de
/// renderizado que existía antes (`_LoginHeroCyclistFocus`,
/// `Transform.scale`, KORIXA-SCREEN02-FINAL-HERO-LOGO-VISIBILITY-ONLY-
/// 20260911), retirado esta ronda: ese ajuste solo hacía falta porque
/// el archivo panorámico no dejaba margen vertical para reencuadrar sin
/// distorsionar — este archivo ya viene encuadrado.
class _LoginHeroImage extends StatelessWidget {
  const _LoginHeroImage({
    required this.alignment,
    this.imageAsset = 'assets/images/korixa_login_hero_guatape.webp',
  });

  final Alignment alignment;
  final String imageAsset;

  @override
  Widget build(BuildContext context) {
    return Image.asset(
      imageAsset,
      fit: BoxFit.cover,
      alignment: alignment,
    );
  }
}

/// Scrim horizontal detrás del panel de vidrio — KORIXA-SCREEN02-LOGIN-
/// FULL-LANDSCAPE-VISUAL-20260910. A diferencia del panel opaco anterior
/// (`AppGradients.loginDesktopPanel`, un degradado SIN alfa que cubría
/// el 43%/56% derecho como un bloque sólido), este degradado SÍ lleva
/// alfa: transparente en el centro/izquierda —  donde el paisaje debe
/// verse sin ningún velo — y oscurece solo gradualmente hacia el borde
/// derecho, reforzando el contraste detrás del `_GlassFormPanel` sin
/// tapar el resto de la foto. Mismos colores ya existentes
/// (`DarkTech.background`), solo con alfa — ningún color nuevo.
class _LoginHeroContentScrim extends StatelessWidget {
  const _LoginHeroContentScrim();

  @override
  Widget build(BuildContext context) {
    return IgnorePointer(
      child: DecoratedBox(
        decoration: BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.centerLeft,
            end: Alignment.centerRight,
            colors: <Color>[Colors.transparent, DarkTech.background.withValues(alpha: 0.55)],
            stops: const <double>[0.45, 1.0],
          ),
        ),
      ),
    );
  }
}

