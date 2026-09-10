import 'dart:ui' show ImageFilter;

import 'package:flutter/foundation.dart' show defaultTargetPlatform, kIsWeb, TargetPlatform;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../app/router/app_router.dart';
import '../../../../app/theme/app_colors.dart';
import '../../../../app/theme/app_gradients.dart';
import '../../../../app/theme/app_radius.dart';
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
  // PHONE LANDSCAPE — KORIXA-SCREEN02-LOGIN-FULL-LANDSCAPE-VISUAL-
  // 20260910: mismo tratamiento que desktop (ver [_buildDesktop] más
  // abajo para el porqué completo). Antes un `Row` 44/56 con un
  // `ColoredBox(color: DarkTech.background)` totalmente opaco ocupando
  // el 56% derecho — el mismo "bloque negro" reportado por el dueño,
  // solo que sin degradado. Ahora el hero cubre la pantalla completa y
  // el formulario compacto flota en el mismo panel de vidrio
  // (`_GlassFormPanel`) anclado a la derecha; su ancho es un porcentaje
  // real del viewport (mismo criterio ya usado por `WelcomePage` en su
  // propio landscape) en vez del flex fijo anterior.
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
              padding: const EdgeInsets.all(AppSpacing.sm),
              child: ConstrainedBox(
                constraints: BoxConstraints(maxWidth: panelWidth),
                child: _GlassFormPanel(
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md, vertical: AppSpacing.sm),
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
                      ),
                    ),
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
  // DESKTOP — KORIXA-SCREEN02-LOGIN-FULL-LANDSCAPE-VISUAL-20260910: el
  // dueño reportó el panel derecho anterior (`Expanded(flex: 43)` con un
  // `DecoratedBox(gradient: AppGradients.loginDesktopPanel)` —  un
  // degradado SIN alfa, por lo tanto totalmente opaco) como "un bloque
  // negro grande" tapando casi la mitad del paisaje de Guatapé: "que se
  // vea todo el paisaje". El hero ahora cubre la pantalla COMPLETA
  // (antes solo el 57% izquierdo) y el formulario flota sobre él dentro
  // de un panel de vidrio esmerilado (`_GlassFormPanel` — blur real vía
  // `BackdropFilter` + superficie translúcida, no un color sólido)
  // anclado a la derecha, con un ancho acotado (420) en vez de ocupar el
  // 43% del viewport como un rectángulo fijo. El paisaje se sigue
  // viendo, difuminado, alrededor y detrás del panel — nunca queda
  // oculto tras un bloque opaco.
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
        // Degradado sutil CON alfa (a diferencia del panel opaco
        // anterior): transparente en el centro/izquierda, donde el
        // paisaje debe verse sin ningún velo, oscureciendo solo
        // gradualmente hacia el borde derecho, detrás de donde vive el
        // panel de vidrio — refuerza el contraste del panel sin tapar
        // el resto de la foto.
        const Positioned.fill(child: _LoginHeroContentScrim()),
        SafeArea(
          child: Align(
            alignment: Alignment.centerRight,
            child: Padding(
              padding: const EdgeInsets.all(AppSpacing.xxxl),
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 420),
                child: _GlassFormPanel(
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: AppSpacing.xl, vertical: AppSpacing.xl),
                    child: SingleChildScrollView(
                      child: _buildFormColumn(
                        context: context,
                        l10n: l10n,
                        loginState: loginState,
                        socialState: socialState,
                        anyLoading: anyLoading,
                        logoAsset: 'assets/icons/korixa_logo_desktop.png',
                        logoHeight: 56,
                        compact: false,
                        highQualityLogo: true,
                      ),
                    ),
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
  }) {
    final TextTheme textTheme = Theme.of(context).textTheme;
    final double sectionGap = compact ? AppSpacing.sm : AppSpacing.xl;
    final double dividerGap = compact ? AppSpacing.sm : AppSpacing.lg;

    return Form(
      key: _formKey,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          // KORIXA-SCREEN02-LOGIN-VISUAL-IMPLEMENTATION-20260907: branding
          // Korixa — antes esta pantalla no tenía NINGÚN logo (auditoría
          // KORIXA-SCREEN02-LOGIN-BASELINE-AUDIT-20260906, hallazgo P0).
          // Mismos archivos ya aprobados que usa/usaba Welcome
          // (`korixa_logo.png` mobile/landscape, `korixa_logo_desktop.png`
          // desktop) — ningún logo nuevo.
          // KORIXA-SCREEN02-LOGIN-DESKTOP-POLISH-LOGO-PANEL-20260907: en
          // desktop el logo se decodificaba al tamaño lógico completo del
          // asset (927px de alto) y se reducía a solo 56px vía el filtro
          // de baja calidad por defecto de `Image` — visible como bordes
          // dentados en el texto al hacer zoom sobre la captura. Decodificar
          // directo al tamaño físico real (`cacheHeight` según
          // devicePixelRatio) + `FilterQuality.high` da un resample nítido
          // en vez de ese downscale en vivo. Solo aplica en desktop
          // (`highQualityLogo`) — portrait/landscape quedan bit-a-bit
          // iguales a como estaban (mismo asset, mismo tamaño, sin cambio).
          Image.asset(
            logoAsset,
            height: logoHeight,
            fit: BoxFit.contain,
            filterQuality: highQualityLogo ? FilterQuality.high : FilterQuality.low,
            cacheHeight: highQualityLogo
                ? (logoHeight * MediaQuery.of(context).devicePixelRatio).round()
                : null,
            semanticLabel: 'Korixa',
          ),
          SizedBox(height: compact ? AppSpacing.sm : AppSpacing.lg),
          Text(l10n.loginTitle, style: textTheme.headlineMedium?.copyWith(fontSize: compact ? 22 : null)),
          const SizedBox(height: AppSpacing.sm),
          Text(
            l10n.loginSubtitle,
            style: textTheme.bodyMedium?.copyWith(color: DarkTech.textSecondary),
          ),
          SizedBox(height: sectionGap),
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
                // `toggled` anuncia al lector de pantalla el estado
                // actual (mostrando/ocultando), no solo "botón" — sin
                // esto, VoiceOver/TalkBack solo dirían "botón, doble
                // toque para activar", sin que la persona sepa qué hace
                // ni en qué estado está.
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
            // En login (a diferencia de registro) solo se exige que no
            // esté vacío — no se re-valida la política de complejidad de
            // una contraseña ya creada.
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
              Text(l10n.noAccountText),
              TextButton(
                onPressed: () => context.go(AppRoute.register),
                child: Text(l10n.createAccountLink),
              ),
            ],
          ),
        ],
      ),
    );
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

/// Panel de vidrio esmerilado — KORIXA-SCREEN02-LOGIN-FULL-LANDSCAPE-
/// VISUAL-20260910. Reemplaza el bloque opaco sólido anterior (un
/// `DecoratedBox`/`ColoredBox` de ancho fijo tapando por completo el
/// hero detrás): el formulario ahora flota sobre el hero a pantalla
/// completa dentro de esta tarjeta translúcida con blur real
/// (`BackdropFilter`) — el paisaje se sigue viendo, difuminado,
/// alrededor y detrás del panel, nunca oculto tras un rectángulo negro
/// sólido. Colores/radio ya existentes en el sistema de diseño
/// (`DarkTech.surface`/`DarkTech.border`, `AppRadius.xlRadius`) — solo
/// se les agrega alfa, ningún token nuevo.
class _GlassFormPanel extends StatelessWidget {
  const _GlassFormPanel({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: AppRadius.xlRadius,
      child: BackdropFilter(
        filter: ImageFilter.blur(sigmaX: 24, sigmaY: 24),
        child: DecoratedBox(
          decoration: BoxDecoration(
            color: DarkTech.surface.withValues(alpha: 0.55),
            borderRadius: AppRadius.xlRadius,
            border: Border.all(color: DarkTech.border.withValues(alpha: 0.6)),
          ),
          child: child,
        ),
      ),
    );
  }
}
