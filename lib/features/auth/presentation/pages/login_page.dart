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
  // MOBILE PORTRAIT — hero de Guatapé arriba, formulario compacto abajo.
  // -------------------------------------------------------------------

  Widget _buildPortrait(
    BuildContext context,
    AppLocalizations l10n,
    AsyncValue<void> loginState,
    AsyncValue<void> socialState,
    bool anyLoading,
  ) {
    return Column(
      key: const Key('login-portrait-layout'),
      children: <Widget>[
        // Altura del hero como fracción de la pantalla (34%) — ni un
        // header gigante que empuje el formulario fuera de vista, ni tan
        // chico que la Piedra/el ciclista se vean irreconocibles.
        SizedBox(
          height: MediaQuery.of(context).size.height * 0.34,
          width: double.infinity,
          child: const Stack(
            fit: StackFit.expand,
            children: <Widget>[
              ExcludeSemantics(
                key: Key('login-hero-image'),
                child: _LoginHeroImage(alignment: Alignment(0.15, -0.05)),
              ),
              // Mismo token que el scrim inferior de Welcome
              // (`AppGradients.imageScrimBottom`) — transición limpia
              // hacia el panel oscuro de abajo, no un gradiente ad hoc.
              Positioned.fill(
                child: DecoratedBox(decoration: BoxDecoration(gradient: AppGradients.imageScrimBottom)),
              ),
            ],
          ),
        ),
        Expanded(
          child: SafeArea(
            top: false,
            child: SingleChildScrollView(
              padding: const EdgeInsets.fromLTRB(AppSpacing.xl, AppSpacing.lg, AppSpacing.xl, AppSpacing.lg),
              child: _buildFormColumn(
                context: context,
                l10n: l10n,
                loginState: loginState,
                socialState: socialState,
                anyLoading: anyLoading,
                logoAsset: 'assets/icons/korixa_logo.png',
                logoHeight: 40,
                compact: false,
              ),
            ),
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
    // hace falta"). `false` en mobile portrait (sin cambios): ahí el
    // formulario sigue sobre un fondo Dark Tech sólido, donde una sombra
    // no tendría ningún efecto visible ni sentido.
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
  }) {
    final TextTheme textTheme = Theme.of(context).textTheme;
    final double sectionGap = compact ? AppSpacing.sm : AppSpacing.xl;
    final double dividerGap = compact ? AppSpacing.sm : AppSpacing.lg;
    final List<Shadow>? legibilityShadow = floatingOverPhoto
        ? <Shadow>[Shadow(color: Colors.black.withValues(alpha: 0.65), blurRadius: 10)]
        : null;

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
      height: logoHeight,
      fit: BoxFit.contain,
      filterQuality: highQualityLogo ? FilterQuality.high : FilterQuality.low,
      cacheHeight: highQualityLogo ? (logoHeight * MediaQuery.of(context).devicePixelRatio).round() : null,
      semanticLabel: 'Korixa',
    );

    final Widget titleWidget = Text(
      l10n.loginTitle,
      style: textTheme.headlineMedium?.copyWith(
        fontSize: titleFontSize ?? (compact ? 22 : null),
        // KORIXA-SCREEN02-LOGIN-MATCH-SCREEN01-DESKTOP-SCALE-20260910:
        // mismo peso/tracking/interlineado que el título de escritorio de
        // Welcome (`_DesktopWelcomeContent`) — solo aplica cuando se pide
        // el tamaño grande de desktop (`titleFontSize` no nulo).
        fontWeight: titleFontSize != null ? FontWeight.w800 : null,
        letterSpacing: titleFontSize != null ? -0.5 : null,
        height: titleFontSize != null ? 1.08 : null,
        shadows: legibilityShadow,
      ),
    );

    final Widget subtitleWidget = Text(
      l10n.loginSubtitle,
      style: textTheme.bodyMedium?.copyWith(
        fontSize: subtitleFontSize,
        color: DarkTech.textSecondary,
        fontWeight: subtitleFontSize != null ? FontWeight.w500 : null,
        shadows: legibilityShadow,
      ),
    );

    final List<Widget> controlChildren = <Widget>[
      TextFormField(
        controller: _emailController,
        keyboardType: TextInputType.emailAddress,
        textInputAction: TextInputAction.next,
        autofillHints: const <String>[AutofillHints.email],
        decoration: InputDecoration(labelText: l10n.emailLabel),
        validator: (String? value) => Validators.email(value).message(l10n),
      ),
      SizedBox(height: compact ? AppSpacing.sm : AppSpacing.base),
      TextFormField(
        controller: _passwordController,
        obscureText: _obscurePassword,
        textInputAction: TextInputAction.done,
        autofillHints: const <String>[AutofillHints.password],
        decoration: InputDecoration(
          labelText: l10n.passwordLabel,
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
      const SizedBox(height: AppSpacing.xs),
      PrimaryGradientButton(
        label: l10n.loginButton,
        isLoading: loginState.isLoading,
        onPressed: anyLoading ? null : _handleSubmit,
        height: ctaHeight ?? 52,
        fontSize: ctaFontSize,
      ),
      SizedBox(height: sectionGap),
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
      SizedBox(height: dividerGap),
      GoogleSignInButton(
        label: l10n.continueWithGoogle,
        isLoading: socialState.isLoading,
        onPressed: anyLoading
            ? null
            : () => _handleSocialSignIn(
                  ref.read(socialAuthControllerProvider.notifier).signInWithGoogle,
                ),
      ),
      if (_isApplePlatform) ...<Widget>[
        const SizedBox(height: AppSpacing.md),
        AppleSignInButton(
          label: l10n.continueWithApple,
          isLoading: socialState.isLoading,
          onPressed: anyLoading
              ? null
              : () => _handleSocialSignIn(
                    ref.read(socialAuthControllerProvider.notifier).signInWithApple,
                  ),
        ),
      ],
      SizedBox(height: sectionGap),
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
            key: const Key('login-desktop-content-group'),
            crossAxisAlignment: CrossAxisAlignment.end,
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              logoWidget,
              SizedBox(height: compact ? AppSpacing.sm : AppSpacing.lg),
              titleWidget,
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
              logoWidget,
              SizedBox(height: compact ? AppSpacing.sm : AppSpacing.lg),
              titleWidget,
              const SizedBox(height: AppSpacing.sm),
              subtitleWidget,
              SizedBox(height: sectionGap),
              ...controlChildren,
            ],
          );

    return Form(key: _formKey, child: content);
  }
}

/// Hero de Guatapé / Piedra del Peñol aprobado por el dueño
/// (`korixa_login_hero_guatape.webp`, 1672×941) — UN solo archivo
/// reusado en las 3 composiciones (portrait/landscape/desktop), cada una
/// con su propio `alignment` según la forma real del contenedor (ver
/// cada composición en `LoginPage`). `BoxFit.cover` en las 3 — nunca se
/// escala/recolorea/redibuja la foto en sí.
class _LoginHeroImage extends StatelessWidget {
  const _LoginHeroImage({required this.alignment});

  final Alignment alignment;

  @override
  Widget build(BuildContext context) {
    return Image.asset(
      'assets/images/korixa_login_hero_guatape.webp',
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

