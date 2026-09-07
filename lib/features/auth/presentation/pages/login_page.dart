import 'dart:math' as math;

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
  // Clasificación responsiva — mismo criterio que `WelcomePage`
  // (KORIXA-SCREEN01-MOBILE-LANDSCAPE-FIX-20260906 /
  // KORIXA-SCREEN01-PHONE-LANDSCAPE-COMPOSITION-20260906), reimplementado
  // acá en vez de compartido: cada pantalla ya tenía su propio breakpoint
  // local antes de esta tarea (ver `home_page.dart`/`workouts_list_page.dart`),
  // y `WelcomePage` no se toca en esta tarea (SCREEN_01 congelado).
  // -------------------------------------------------------------------

  static const double _desktopBreakpoint = 700;
  static const double _desktopMinShortestSide = 600;

  static bool _isDesktop(BoxConstraints constraints) {
    final double shortestSide = math.min(constraints.maxWidth, constraints.maxHeight);
    return constraints.maxWidth > _desktopBreakpoint && shortestSide > _desktopMinShortestSide;
  }

  static bool _isPhoneLandscape(BoxConstraints constraints) {
    return !_isDesktop(constraints) && constraints.maxWidth > constraints.maxHeight;
  }

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
            if (_isDesktop(constraints)) {
              return _buildDesktop(context, l10n, loginState, socialState, anyLoading);
            }
            if (_isPhoneLandscape(constraints)) {
              return _buildPhoneLandscape(context, l10n, loginState, socialState, anyLoading);
            }
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
  // PHONE LANDSCAPE — hero a la izquierda (~44%), formulario compacto y
  // desplazable a la derecha (~56%). El problema de la base (Google/
  // Crear cuenta fuera de vista sin scroll) se resuelve acá con el mismo
  // patrón que ya usa `WelcomePage` para su propio landscape: scroll SOLO
  // del lado del formulario, nunca un layout de escritorio forzado.
  // -------------------------------------------------------------------

  Widget _buildPhoneLandscape(
    BuildContext context,
    AppLocalizations l10n,
    AsyncValue<void> loginState,
    AsyncValue<void> socialState,
    bool anyLoading,
  ) {
    return Row(
      key: const Key('login-landscape-layout'),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        const Expanded(
          flex: 44,
          child: ExcludeSemantics(
            key: Key('login-hero-image'),
            child: _LoginHeroImage(alignment: Alignment(0.35, 0)),
          ),
        ),
        Expanded(
          flex: 56,
          child: ColoredBox(
            color: DarkTech.background,
            child: SafeArea(
              child: SingleChildScrollView(
                padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg, vertical: AppSpacing.sm),
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
      ],
    );
  }

  // -------------------------------------------------------------------
  // DESKTOP — hero inmersivo a la izquierda (~57%), panel Dark Tech
  // calmo a la derecha (~43%) con el formulario centrado. Sin logo
  // flotante sobre la foto (a diferencia de Welcome, que SÍ superpone
  // contenido sobre el hero): acá el hero es puramente visual, todo el
  // contenido real vive en el panel oscuro — "premium pero calmo", no
  // una tarjeta flotante con glow excesivo.
  // -------------------------------------------------------------------

  Widget _buildDesktop(
    BuildContext context,
    AppLocalizations l10n,
    AsyncValue<void> loginState,
    AsyncValue<void> socialState,
    bool anyLoading,
  ) {
    return Row(
      key: const Key('login-desktop-layout'),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        const Expanded(
          flex: 57,
          child: Stack(
            fit: StackFit.expand,
            children: <Widget>[
              ExcludeSemantics(
                key: Key('login-hero-image'),
                child: _LoginHeroImage(alignment: Alignment(0.3, 0)),
              ),
              // Transición sutil hacia el panel oscuro — solo el borde
              // derecho del hero, nunca oscurece la foto completa.
              Positioned.fill(child: _LoginHeroEdgeScrim()),
            ],
          ),
        ),
        Expanded(
          flex: 43,
          child: DecoratedBox(
            // KORIXA-SCREEN02-LOGIN-DESKTOP-POLISH-LOGO-PANEL-20260907:
            // antes era un `ColoredBox(color: DarkTech.background)` plano
            // — ahora usa la propia escala de elevación Dark Tech como
            // degradado horizontal (más claro junto al hero, oscureciendo
            // progresivamente), para que el panel se sienta como una
            // superficie de vidrio integrada con la foto en vez de un
            // bloque negro sólido pegado a ella. Composición/flex/hero
            // sin cambios.
            decoration: const BoxDecoration(gradient: AppGradients.loginDesktopPanel),
            child: Center(
              child: SingleChildScrollView(
                padding: const EdgeInsets.symmetric(horizontal: AppSpacing.xxxl, vertical: AppSpacing.xl),
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 400),
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

/// Transición sutil entre el hero de escritorio y el panel oscuro de la
/// derecha — un degradado horizontal angosto pegado al borde derecho del
/// hero (colores ya existentes: `DarkTech.background` a transparente,
/// no un color nuevo), para que el corte entre foto y panel no se sienta
/// como un borde duro. Nunca oscurece el resto de la foto.
class _LoginHeroEdgeScrim extends StatelessWidget {
  const _LoginHeroEdgeScrim();

  @override
  Widget build(BuildContext context) {
    return const IgnorePointer(
      child: DecoratedBox(
        decoration: BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.centerRight,
            end: Alignment.centerLeft,
            colors: <Color>[DarkTech.background, Colors.transparent],
            stops: <double>[0.0, 0.18],
          ),
        ),
      ),
    );
  }
}
