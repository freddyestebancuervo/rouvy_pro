import 'package:flutter/foundation.dart' show defaultTargetPlatform, kIsWeb, TargetPlatform;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../app/router/app_router.dart';
import '../../../../app/theme/app_colors.dart';
import '../../../../app/theme/app_spacing.dart';
import '../../../../app/theme/app_theme.dart';
import '../../../../core/design_system/dark_tech_buttons.dart';
import '../../../../core/error/failures.dart';
import '../../../../core/responsive/korixa_viewport.dart';
import '../../../../core/utils/validation_l10n.dart';
import '../../../../core/utils/validators.dart';
import '../../../../l10n/generated/app_localizations.dart';
import '../providers/register_controller.dart';
import '../providers/social_auth_controller.dart';
import '../widgets/dark_tech_auth_shell.dart';
import '../widgets/social_sign_in_buttons.dart';

// KORIXA-SCREEN03-WEB-CLEAN-BRANCH-REAPPLICATION-20260913: esta página
// se bifurca en desktop-web (`_buildDesktopWeb`) vs. el comportamiento
// original de `origin/main` (`_buildLegacyShell`, sin cambios) para
// portrait y phone landscape. NO existe aquí ninguna rama mobile-portrait
// dedicada — esa pertenece a otra rama (SCREEN_03 MOBILE) que a la fecha
// de esta reaplicación seguía sin mergear a `origin/main`. Mantener esta
// página libre de esa dependencia es intencional.

class RegisterPage extends ConsumerStatefulWidget {
  const RegisterPage({super.key});

  @override
  ConsumerState<RegisterPage> createState() => _RegisterPageState();
}

class _RegisterPageState extends ConsumerState<RegisterPage> {
  final _formKey = GlobalKey<FormState>();
  final _nameController = TextEditingController();
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();
  final _confirmPasswordController = TextEditingController();
  bool _obscurePassword = true;

  @override
  void dispose() {
    _nameController.dispose();
    _emailController.dispose();
    _passwordController.dispose();
    _confirmPasswordController.dispose();
    super.dispose();
  }

  bool get _isApplePlatform => !kIsWeb && defaultTargetPlatform == TargetPlatform.iOS;

  Future<void> _handleSubmit() async {
    if (!_formKey.currentState!.validate()) return;

    final bool success = await ref.read(registerControllerProvider.notifier).submit(
          email: _emailController.text.trim(),
          password: _passwordController.text,
          displayName: _nameController.text.trim(),
        );

    if (!mounted) return;
    // Tras registrarse, Firebase ya envió el correo de verificación desde
    // el datasource — se redirige a la pantalla de verificación, no
    // directo a Home (ver redirect en app_router.dart, que igualmente lo
    // forzaría si se intentara ir a Home directamente).
    if (success) context.go(AppRoute.emailVerification);
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

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final AsyncValue<void> registerState = ref.watch(registerControllerProvider);
    final AsyncValue<void> socialState = ref.watch(socialAuthControllerProvider);

    ref.listen<AsyncValue<void>>(registerControllerProvider, (previous, next) {
      if (next.hasError && !next.isLoading) _showError(next.error!, l10n);
    });

    // Solo errores: el éxito se maneja awaiteando el `Future<bool>` que
    // devuelve cada acción (`_handleSocialSignIn`) — nunca a partir de la
    // transición loading→data de este `AsyncValue`, que también ocurre al
    // inicializarse el controller sin que el usuario haga nada.
    ref.listen<AsyncValue<void>>(socialAuthControllerProvider, (previous, next) {
      if (next.hasError && !next.isLoading) _showError(next.error!, l10n);
    });

    final bool anyLoading = registerState.isLoading || socialState.isLoading;

    return LayoutBuilder(
      builder: (BuildContext context, BoxConstraints constraints) {
        final KorixaViewportInfo viewport = KorixaViewportInfo(
          width: constraints.maxWidth,
          height: constraints.maxHeight,
        );
        if (viewport.canFitWideLayout()) {
          return _buildDesktopWeb(context, l10n, registerState, socialState, anyLoading);
        }
        return _buildLegacyShell(context, l10n, registerState, socialState, anyLoading);
      },
    );
  }

  /// Comportamiento ORIGINAL de `origin/main`, sin cambios: portrait y
  /// phone landscape (todo lo que no cumpla `canFitWideLayout()`) siguen
  /// pasando exactamente por aquí.
  Widget _buildLegacyShell(
    BuildContext context,
    AppLocalizations l10n,
    AsyncValue<void> registerState,
    AsyncValue<void> socialState,
    bool anyLoading,
  ) {
    return DarkTechAuthShell(
      maxWidth: 420,
      appBar: AppBar(),
      // KORIXA-UI-SCREEN-BATCH-01A: `themeContext`, no el `context` de
      // `build` — ver el docblock de `DarkTechAuthShell`.
      builder: (BuildContext themeContext) => _buildStandardFormContent(
        themeContext,
        l10n,
        registerState,
        socialState,
        anyLoading,
      ),
    );
  }

  // KORIXA-SCREEN03-WEB-MATCH-SCREEN02-DESKTOP-UI-SCALE-20260914: estos 7
  // valores son una copia EXACTA de las constantes ya vigentes en
  // `LoginPage._buildDesktop`/`_desktopContentMaxWidth` etc. (a su vez
  // copiadas de `WelcomePage._DesktopWelcomeContent`) — verificadas
  // contra el código actual antes de usarlas, no asumidas. SCREEN_03
  // consume la MISMA escala aprobada, no inventa una propia.
  static const double _desktopContentMaxWidth = 680;
  static const double _desktopControlWidth = 550;
  static const double _desktopCtaHeight = 64;
  static const double _desktopCtaFontSize = 20;
  static const double _desktopLogoHeight = 188;
  static const double _desktopTitleFontSize = 51;
  static const double _desktopSubtitleFontSize = 24;

  /// SCREEN_03 WEB (desktop) — KORIXA-SCREEN03-WEB-FINAL-LEFT-
  /// COMPOSITION-AND-LOGO-20260914: el owner pidió mover el bloque del
  /// formulario del tercio derecho al tercio izquierdo (deja la ciclista
  /// y el Santuario, que en esta foto quedan más hacia el centro/derecha,
  /// completamente libres) y agregar el logo oficial de Korixa
  /// (`assets/icons/korixa_logo_desktop.png` — el mismo ya aprobado y en
  /// uso por Welcome/Login desktop, sin generar ni modificar ningún
  /// asset nuevo) encima del título. El degradado de contraste se
  /// invierte en el mismo movimiento (nace en el borde izquierdo, se
  /// desvanece antes del centro) — misma técnica de 3 stops sin bordes ni
  /// esquinas que la ronda anterior, solo con los `Alignment` invertidos.
  Widget _buildDesktopWeb(
    BuildContext context,
    AppLocalizations l10n,
    AsyncValue<void> registerState,
    AsyncValue<void> socialState,
    bool anyLoading,
  ) {
    return Theme(
      data: AppTheme.darkTech,
      child: Scaffold(
        backgroundColor: DarkTech.background,
        body: Stack(
          key: const Key('register-desktop-layout'),
          fit: StackFit.expand,
          children: <Widget>[
            const Positioned.fill(
              child: DecoratedBox(decoration: BoxDecoration(color: DarkTech.background)),
            ),
            const Positioned.fill(
              key: Key('register-desktop-hero-image'),
              child: ExcludeSemantics(child: _RegisterWebHeroImage()),
            ),
            const Positioned.fill(
              key: Key('register-desktop-hero-scrim'),
              child: ExcludeSemantics(child: _RegisterHeroContentScrim()),
            ),
            SafeArea(
              // KORIXA-UI-SCREEN-BATCH-01A: `themeContext` desde un
              // `Builder` insertado DEBAJO del `Theme` de arriba — evita
              // que `Theme.of(context)` resuelva el tema ambiente del
              // `MaterialApp` en lugar de `AppTheme.darkTech`.
              child: Builder(
                builder: (BuildContext themeContext) {
                  // KORIXA-SCREEN03-WEB-FINAL-LEFT-COMPOSITION-AND-LOGO-
                  // 20260914: margen izquierdo responsive (40 en
                  // viewports más angostos, 64 desde 1920 en adelante) —
                  // mismo mecanismo que el margen derecho de la ronda
                  // anterior, solo que ahora es el lado izquierdo el que
                  // recibe el valor mayor en pantallas grandes.
                  final double screenWidth = MediaQuery.of(themeContext).size.width;
                  final double leftMargin = screenWidth >= 1920 ? 64 : AppSpacing.xxxl;
                  return Align(
                    alignment: Alignment.centerLeft,
                    child: Padding(
                      padding: EdgeInsets.only(
                        top: AppSpacing.xxxl,
                        bottom: AppSpacing.xxxl,
                        left: leftMargin,
                        right: AppSpacing.xxxl,
                      ),
                      child: ConstrainedBox(
                        key: const Key('register-desktop-content-max-width'),
                        constraints: const BoxConstraints(maxWidth: _desktopContentMaxWidth),
                        child: SingleChildScrollView(
                          child: _buildDesktopFormContent(
                            themeContext,
                            l10n,
                            registerState,
                            socialState,
                            anyLoading,
                          ),
                        ),
                      ),
                    ),
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
  }

  /// Contenido del formulario, idéntico en orden/lógica al original de
  /// `origin/main` — usado ÚNICAMENTE por `_buildLegacyShell` (portrait/
  /// phone landscape). KORIXA-SCREEN03-WEB-MATCH-SCREEN02-DESKTOP-UI-
  /// SCALE-20260914: desktop dejó de reusar este método (ver
  /// `_buildDesktopFormContent`, estructuralmente distinto — agrupa
  /// logo/título/subtítulo/controles en bloques de `_desktopControlWidth`
  /// centrados, algo que este método no necesita) — restaurado a su forma
  /// simple original, sin el parámetro `desktop` que existía en rondas
  /// anteriores.
  Widget _buildStandardFormContent(
    BuildContext themeContext,
    AppLocalizations l10n,
    AsyncValue<void> registerState,
    AsyncValue<void> socialState,
    bool anyLoading,
  ) {
    final TextTheme textTheme = Theme.of(themeContext).textTheme;
    return Form(
          key: _formKey,
          autovalidateMode: AutovalidateMode.onUserInteraction,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              Text(l10n.registerTitle, key: const Key('register-title'), style: textTheme.headlineMedium),
              const SizedBox(height: AppSpacing.sm),
              Text(
                l10n.registerSubtitle,
                key: const Key('register-subtitle'),
                style: textTheme.bodyMedium?.copyWith(color: DarkTech.textSecondary),
              ),
              const SizedBox(height: AppSpacing.xl),
              TextFormField(
                controller: _nameController,
                textInputAction: TextInputAction.next,
                autofillHints: const <String>[AutofillHints.name],
                decoration: InputDecoration(labelText: l10n.nameLabel),
                validator: (String? value) => Validators.name(value).message(l10n),
              ),
              const SizedBox(height: AppSpacing.base),
              TextFormField(
                controller: _emailController,
                keyboardType: TextInputType.emailAddress,
                textInputAction: TextInputAction.next,
                autofillHints: const <String>[AutofillHints.email],
                decoration: InputDecoration(labelText: l10n.emailLabel),
                validator: (String? value) => Validators.email(value).message(l10n),
              ),
              const SizedBox(height: AppSpacing.base),
              TextFormField(
                controller: _passwordController,
                obscureText: _obscurePassword,
                textInputAction: TextInputAction.next,
                autofillHints: const <String>[AutofillHints.newPassword],
                decoration: InputDecoration(
                  labelText: l10n.passwordLabel,
                  suffixIcon: Semantics(
                    key: const Key('register-password-visibility-semantics'),
                    label: _obscurePassword ? l10n.showPasswordAction : l10n.hidePasswordAction,
                    toggled: !_obscurePassword,
                    child: IconButton(
                      tooltip: _obscurePassword ? l10n.showPasswordAction : l10n.hidePasswordAction,
                      icon: Icon(_obscurePassword ? Icons.visibility_outlined : Icons.visibility_off_outlined),
                      onPressed: () => setState(() => _obscurePassword = !_obscurePassword),
                    ),
                  ),
                ),
                validator: (String? value) => Validators.password(value).message(l10n),
              ),
              const SizedBox(height: AppSpacing.base),
              TextFormField(
                controller: _confirmPasswordController,
                obscureText: _obscurePassword,
                textInputAction: TextInputAction.done,
                decoration: InputDecoration(labelText: l10n.confirmPasswordLabel),
                onFieldSubmitted: (_) => _handleSubmit(),
                validator: (String? value) => Validators.confirmPassword(
                  _passwordController.text,
                  value,
                ).message(l10n),
              ),
              const SizedBox(height: AppSpacing.lg),
              PrimaryGradientButton(
                label: l10n.registerButton,
                isLoading: registerState.isLoading,
                onPressed: anyLoading ? null : _handleSubmit,
              ),
              const SizedBox(height: AppSpacing.md),
              Text(
                l10n.termsAcceptText,
                key: const Key('register-terms-text'),
                textAlign: TextAlign.center,
                style: textTheme.bodySmall?.copyWith(color: DarkTech.textSecondary),
              ),
              const SizedBox(height: AppSpacing.lg),
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
              const SizedBox(height: AppSpacing.lg),
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
              const SizedBox(height: AppSpacing.lg),
              Wrap(
                alignment: WrapAlignment.center,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: <Widget>[
                  Text(l10n.hasAccountText),
                  TextButton(
                    onPressed: () => context.go(AppRoute.login),
                    child: Text(l10n.loginLink),
                  ),
                ],
              ),
            ],
          ),
        );
  }

  /// Contenido del formulario para SCREEN_03 WEB (desktop) — KORIXA-
  /// SCREEN03-WEB-MATCH-SCREEN02-DESKTOP-UI-SCALE-20260914: mismo patrón
  /// estructural que `LoginPage._buildFormColumn` cuando recibe
  /// `controlWidth` (escala desktop): logo + título + subtítulo agrupados
  /// dentro de un bloque de `_desktopControlWidth` (550) centrado
  /// internamente, y los controles interactivos (campos, CTA, texto
  /// legal, divisor, Google, footer) dentro de OTRO bloque del mismo
  /// ancho — nunca dentro de una card/panel exterior (sin
  /// `DecoratedBox`/`Container` con relleno envolviendo nada de esto).
  /// Reimplementado de forma autocontenida: no importa nada privado de
  /// `login_page.dart`, no lo modifica.
  Widget _buildDesktopFormContent(
    BuildContext themeContext,
    AppLocalizations l10n,
    AsyncValue<void> registerState,
    AsyncValue<void> socialState,
    bool anyLoading,
  ) {
    final TextTheme textTheme = Theme.of(themeContext).textTheme;
    // El formulario ya no vive dentro de una card opaca (KORIXA-SCREEN03-
    // WEB-FINAL-COMPOSITION-CORRECTION-20260914) — misma sombra de
    // legibilidad que `LoginPage._buildFormColumn` aplica con
    // `floatingOverPhoto: true`.
    final List<Shadow> legibilityShadow = <Shadow>[
      Shadow(color: Colors.black.withValues(alpha: 0.65), blurRadius: 10),
    ];

    final Widget logoWidget = Image.asset(
      'assets/icons/korixa_logo_desktop.png',
      key: const Key('register-desktop-logo'),
      height: _desktopLogoHeight,
      fit: BoxFit.contain,
      filterQuality: FilterQuality.high,
      cacheHeight: (_desktopLogoHeight * MediaQuery.of(themeContext).devicePixelRatio).round(),
      semanticLabel: 'Korixa',
    );

    final Widget titleWidget = Text(
      l10n.registerTitle,
      key: const Key('register-title'),
      textAlign: TextAlign.center,
      style: textTheme.headlineMedium?.copyWith(
        fontSize: _desktopTitleFontSize,
        fontWeight: FontWeight.w800,
        color: DarkTech.textPrimary,
        letterSpacing: -0.5,
        height: 1.08,
        shadows: legibilityShadow,
      ),
    );

    final Widget subtitleWidget = Text(
      l10n.registerSubtitle,
      key: const Key('register-subtitle'),
      textAlign: TextAlign.center,
      style: textTheme.bodyMedium?.copyWith(
        color: DarkTech.textSecondary,
        fontSize: _desktopSubtitleFontSize,
        fontWeight: FontWeight.w500,
        shadows: legibilityShadow,
      ),
    );

    return Form(
      key: _formKey,
      autovalidateMode: AutovalidateMode.onUserInteraction,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.center,
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          SizedBox(
            key: const Key('register-desktop-header-width'),
            width: _desktopControlWidth,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.center,
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                logoWidget,
                const SizedBox(height: AppSpacing.lg),
                titleWidget,
                const SizedBox(height: AppSpacing.sm),
                subtitleWidget,
              ],
            ),
          ),
          const SizedBox(height: AppSpacing.xl),
          SizedBox(
            key: const Key('register-desktop-control-width'),
            width: _desktopControlWidth,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                TextFormField(
                  controller: _nameController,
                  textInputAction: TextInputAction.next,
                  autofillHints: const <String>[AutofillHints.name],
                  decoration: InputDecoration(labelText: l10n.nameLabel),
                  validator: (String? value) => Validators.name(value).message(l10n),
                ),
                const SizedBox(height: AppSpacing.base),
                TextFormField(
                  controller: _emailController,
                  keyboardType: TextInputType.emailAddress,
                  textInputAction: TextInputAction.next,
                  autofillHints: const <String>[AutofillHints.email],
                  decoration: InputDecoration(labelText: l10n.emailLabel),
                  validator: (String? value) => Validators.email(value).message(l10n),
                ),
                const SizedBox(height: AppSpacing.base),
                TextFormField(
                  controller: _passwordController,
                  obscureText: _obscurePassword,
                  textInputAction: TextInputAction.next,
                  autofillHints: const <String>[AutofillHints.newPassword],
                  decoration: InputDecoration(
                    labelText: l10n.passwordLabel,
                    suffixIcon: Semantics(
                      key: const Key('register-password-visibility-semantics'),
                      label: _obscurePassword ? l10n.showPasswordAction : l10n.hidePasswordAction,
                      toggled: !_obscurePassword,
                      child: IconButton(
                        tooltip: _obscurePassword ? l10n.showPasswordAction : l10n.hidePasswordAction,
                        icon: Icon(_obscurePassword ? Icons.visibility_outlined : Icons.visibility_off_outlined),
                        onPressed: () => setState(() => _obscurePassword = !_obscurePassword),
                      ),
                    ),
                  ),
                  validator: (String? value) => Validators.password(value).message(l10n),
                ),
                const SizedBox(height: AppSpacing.base),
                TextFormField(
                  controller: _confirmPasswordController,
                  obscureText: _obscurePassword,
                  textInputAction: TextInputAction.done,
                  decoration: InputDecoration(labelText: l10n.confirmPasswordLabel),
                  onFieldSubmitted: (_) => _handleSubmit(),
                  validator: (String? value) => Validators.confirmPassword(
                    _passwordController.text,
                    value,
                  ).message(l10n),
                ),
                const SizedBox(height: AppSpacing.lg),
                PrimaryGradientButton(
                  label: l10n.registerButton,
                  isLoading: registerState.isLoading,
                  onPressed: anyLoading ? null : _handleSubmit,
                  height: _desktopCtaHeight,
                  fontSize: _desktopCtaFontSize,
                ),
                const SizedBox(height: AppSpacing.md),
                Text(
                  l10n.termsAcceptText,
                  key: const Key('register-terms-text'),
                  textAlign: TextAlign.center,
                  style: textTheme.bodySmall?.copyWith(color: DarkTech.textSecondary, shadows: legibilityShadow),
                ),
                const SizedBox(height: AppSpacing.lg),
                Row(
                  children: <Widget>[
                    const Expanded(child: Divider()),
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md),
                      child: Text(l10n.orDividerText, style: textTheme.bodySmall?.copyWith(shadows: legibilityShadow)),
                    ),
                    const Expanded(child: Divider()),
                  ],
                ),
                const SizedBox(height: AppSpacing.lg),
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
                const SizedBox(height: AppSpacing.lg),
                Wrap(
                  alignment: WrapAlignment.center,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: <Widget>[
                    Text(
                      l10n.hasAccountText,
                      style: textTheme.bodyMedium?.copyWith(color: DarkTech.textSecondary, shadows: legibilityShadow),
                    ),
                    TextButton(
                      onPressed: () => context.go(AppRoute.login),
                      // Sin `color` explícito: el acento cyan/azul de
                      // marca (`DarkTech.interactiveText`, vía
                      // `TextButtonThemeData` ya existente y compartido
                      // con todo el resto de la app) sigue aplicándose
                      // solo — únicamente se agrega sombra para
                      // legibilidad sobre la foto, sin pisar ese color.
                      child: Text(
                        l10n.loginLink,
                        style: TextStyle(fontWeight: FontWeight.w700, shadows: legibilityShadow),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// SCREEN_03 WEB — KORIXA-SCREEN03-WEB-DESKTOP-HERO-PATTERN-ALIGN-WITH-
/// SCREEN01-20260914: mismo patrón técnico ya aprobado en SCREEN_01
/// (`_DesktopHeroImage` en `welcome_page.dart`, NO modificado, solo
/// auditado): asset dedicado de escritorio + `BoxFit.cover` (nunca
/// `contain`, que dejaba franjas negras laterales/horizontales cuando el
/// aspect ratio del viewport no coincidía con el de la foto) + alignment
/// controlado. Asset inmutable — ver
/// `assets/images/korixa_register_hero_desktop.png` (1672×941, mismo
/// SHA-256 que el archivo fuente, copiado byte a byte).
///
/// Alignment(0.35, 0): en esta foto la ciclista (torso/casco/uniforme
/// Korixa) está ubicada centro-derecha del encuadre y el Santuario de
/// Las Lajas centro-izquierda; el lado izquierdo (vegetación/carretera/
/// muro de piedra) es la zona visualmente neutra donde flota el
/// formulario. Un sesgo hacia la derecha en el alignment prioriza qué
/// borde se recorta cuando `BoxFit.cover` necesita cortar por diferencia
/// de aspect ratio: sacrifica margen del lado izquierdo (neutro, ya
/// cubierto por el degradado de contraste) en vez de arriesgar la
/// ciclista o el Santuario — mismo razonamiento que el sesgo horizontal
/// ya aprobado en SCREEN_01 (`Alignment(0.2, 0)`, sujeto también a la
/// derecha del frame original), solo que aquí el sujeto está aún más
/// hacia la derecha, así que el sesgo es mayor.
class _RegisterWebHeroImage extends StatelessWidget {
  const _RegisterWebHeroImage();

  @override
  Widget build(BuildContext context) {
    return Image.asset(
      'assets/images/korixa_register_hero_desktop.png',
      fit: BoxFit.cover,
      alignment: const Alignment(0.35, 0),
    );
  }
}

/// Degradado MUY angosto desde el borde IZQUIERDO — KORIXA-SCREEN03-WEB-
/// FINAL-LEFT-COMPOSITION-AND-LOGO-20260914: el formulario se movió del
/// tercio derecho al tercio izquierdo, así que el degradado de contraste
/// se invierte en el mismo movimiento — mismos 3 stops (0.0 → 0.28 →
/// 0.55) y misma alfa que la ronda anterior (COMPOSITION-CORRECTION-
/// 20260914, que ya lo angostó desde una versión previa que cubría el
/// 55% del viewport y se percibía como card), solo con `begin`/`end`
/// invertidos: nace en el borde izquierdo, se desvanece a transparente
/// bastante antes del centro — deja el Santuario y la ciclista (que en
/// esta foto quedan más hacia el centro/derecha) completamente sin velo.
/// NO es una card/panel: sin `borderRadius`, sin `border`, sin límite
/// rectangular — es exactamente el mismo recurso ya aprobado en SCREEN_02
/// (`LoginPage._LoginHeroContentScrim`), reimplementado aquí de forma
/// autocontenida (no se importa ni se modifica nada de `login_page.dart`).
/// Ningún color nuevo: mismo `DarkTech.background` de siempre, solo con
/// alfa.
class _RegisterHeroContentScrim extends StatelessWidget {
  const _RegisterHeroContentScrim();

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.centerLeft,
          end: Alignment.centerRight,
          colors: <Color>[
            DarkTech.background.withValues(alpha: 0.5),
            DarkTech.background.withValues(alpha: 0.22),
            Colors.transparent,
          ],
          stops: const <double>[0.0, 0.28, 0.55],
        ),
      ),
    );
  }
}
