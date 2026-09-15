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
        if (viewport.isPortrait) {
          return _buildMobilePortrait(context, l10n, registerState, socialState, anyLoading);
        }
        // KORIXA-SCREEN03-PHONE-COMPACT-LANDSCAPE-IMPLEMENTATION-20260915:
        // cierra la brecha identificada por KORIXA-LANDSCAPE-FIRST-
        // ARCHITECTURE-AUDIT-20260915 — un teléfono horizontal (844×390,
        // 915×412, 932×430: `isCompactLandscape == true`) ya NO cae en
        // `_buildLegacyShell` (el shell genérico sin foto, previo a todo
        // el rediseño de SCREEN_03). `isCompactLandscape` es el mismo
        // criterio que `WelcomePage`/`LoginPage` ya usan localmente
        // (`isLandscape && !canFitWideLayout()`), ahora promovido a
        // `KorixaViewportInfo` para no duplicarlo por tercera vez.
        if (viewport.isCompactLandscape) {
          return _buildPhoneLandscape(context, l10n, registerState, socialState, anyLoading);
        }
        // Red de seguridad teórica: `KorixaViewportInfo`'s propio test de
        // barrido (`korixa_viewport_test.dart`) prueba que desktop/
        // phone-landscape/portrait son exhaustivos y mutuamente
        // excluyentes — esta rama no debería ser alcanzable nunca, pero
        // se conserva el shell original como fallback explícito en vez
        // de un `throw`, coherente con el resto de la app.
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

  /// SCREEN_03 MOBILE PORTRAIT — KORIXA-SCREEN03-MOBILE-PORTRAIT-NO-LOGO-
  /// IMPLEMENTATION-20260914: mockup aprobado por el owner. Fondo
  /// full-screen con el asset dedicado de mobile (ciclista + Santuario de
  /// Las Lajas, encuadre vertical — distinto archivo del hero de
  /// escritorio, no un recorte automático de este) + `AppGradients.
  /// imageScrimBottom` (mismo scrim compartido ya usado en otras
  /// pantallas emocionales de la app, NO inventado aquí) para legibilidad
  /// — SIN logo, SIN card/panel exterior envolviendo el formulario. Cada
  /// campo conserva su propio fondo oscuro individual (heredado del tema
  /// compartido `AppTheme.darkTech.inputDecorationTheme`), no hay ningún
  /// `DecoratedBox`/`Container` opaco de por medio. `SafeArea` maneja el
  /// notch/status bar real del dispositivo — no se dibuja ninguna barra
  /// de estado falsa (esa franja en el mockup es solo referencia visual
  /// del diseño, no parte de esta implementación).
  Widget _buildMobilePortrait(
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
          key: const Key('register-mobile-layout'),
          fit: StackFit.expand,
          children: <Widget>[
            const Positioned.fill(
              key: Key('register-mobile-hero-image'),
              child: ExcludeSemantics(child: _RegisterMobileHeroImage()),
            ),
            const Positioned.fill(
              key: Key('register-mobile-hero-scrim'),
              child: ExcludeSemantics(
                child: DecoratedBox(decoration: BoxDecoration(gradient: AppGradients.imageScrimBottom)),
              ),
            ),
            SafeArea(
              // KORIXA-UI-SCREEN-BATCH-01A: `themeContext`, no el `context`
              // de `build` — mismo motivo que en `_buildDesktopWeb`.
              child: Builder(
                builder: (BuildContext themeContext) => Padding(
                  padding: const EdgeInsets.fromLTRB(AppSpacing.xl, AppSpacing.lg, AppSpacing.xl, AppSpacing.lg),
                  // Scroll seguro: si el contenido no cabe en pantallas
                  // bajas, se desplaza — nunca se achican campos/botones
                  // silenciosamente para forzar que quepan.
                  child: LayoutBuilder(
                    builder: (BuildContext context, BoxConstraints constraints) => SingleChildScrollView(
                      child: ConstrainedBox(
                        constraints: BoxConstraints(minHeight: constraints.maxHeight),
                        child: Column(
                          mainAxisAlignment: MainAxisAlignment.end,
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: <Widget>[
                            _buildMobileFormContent(
                              themeContext,
                              l10n,
                              registerState,
                              socialState,
                              anyLoading,
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  /// Contenido del formulario para SCREEN_03 MOBILE PORTRAIT — mismos
  /// campos/lógica/orden que el resto de la pantalla, con tratamiento
  /// visual propio del mockup aprobado: título/subtítulo centrados,
  /// íconos a la izquierda dentro de cada campo, sombra de legibilidad
  /// (el formulario flota sobre la foto, sin card detrás).
  /// [compact] (`false` por defecto, preserva EXACTAMENTE el
  /// comportamiento/medidas actuales de mobile portrait — verificado por
  /// `REGISTER_PORTRAIT_UNCHANGED`): KORIXA-SCREEN03-COMPACT-LANDSCAPE-
  /// VISUAL-DENSITY-REFINEMENT-20260915. El owner probó
  /// `_buildPhoneLandscape` en un teléfono físico real y reportó que,
  /// reusando este método TAL CUAL (medidas pensadas para un viewport
  /// portrait alto, ~844px), la UI resultaba demasiado alta para un
  /// viewport landscape corto (~390px): con teclado cerrado solo se veían
  /// Nombre/Correo/parte de Contraseña, y "Registrarme" quedaba muy
  /// abajo. `compact: true` (solo desde `_buildPhoneLandscape`) reduce
  /// densidad vertical (título/subtítulo más chicos, gaps más angostos,
  /// padding interno de campo reducido de 16 a 10) SIN tocar el tamaño
  /// táctil de ningún control (los campos siguen midiendo bien por
  /// encima del mínimo de 44px recomendado; el CTA/Google conservan su
  /// alto de tema por defecto, nunca se redujeron — el problema real
  /// eran los espacios entre elementos, no el tamaño de los controles en
  /// sí).
  Widget _buildMobileFormContent(
    BuildContext themeContext,
    AppLocalizations l10n,
    AsyncValue<void> registerState,
    AsyncValue<void> socialState,
    bool anyLoading, {
    bool compact = false,
  }) {
    final TextTheme textTheme = Theme.of(themeContext).textTheme;
    final List<Shadow> legibilityShadow = <Shadow>[
      Shadow(color: Colors.black.withValues(alpha: 0.65), blurRadius: 10),
    ];
    final EdgeInsetsGeometry? fieldContentPadding =
        compact ? const EdgeInsets.symmetric(horizontal: 16, vertical: 10) : null;
    final double titleSubtitleGap = compact ? AppSpacing.xs : AppSpacing.sm;
    final double subtitleFieldsGap = compact ? AppSpacing.sm : AppSpacing.xl;
    // KORIXA-SCREEN03-COMPACT-LANDSCAPE-FORM-WIDTH-REFINEMENT-20260915:
    // 5.0px EXACTOS entre campos en landscape — decisión explícita del
    // owner, deliberadamente NO uno de los tokens de `AppSpacing`
    // (el más chico, `xs`, es 4 — no sirve; el resto son mayores).
    final double fieldGap = compact ? 5.0 : AppSpacing.base;
    final double ctaGap = compact ? AppSpacing.sm : AppSpacing.lg;
    final double ctaTermsGap = compact ? AppSpacing.xs : AppSpacing.md;
    final double termsDividerGap = compact ? AppSpacing.sm : AppSpacing.lg;
    final double dividerGoogleGap = compact ? AppSpacing.sm : AppSpacing.lg;
    final double googleFooterGap = compact ? AppSpacing.sm : AppSpacing.lg;

    return Form(
      key: _formKey,
      autovalidateMode: AutovalidateMode.onUserInteraction,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Text(
            l10n.registerTitle,
            key: const Key('register-title'),
            // KORIXA-SCREEN03-COMPACT-LANDSCAPE-FORM-WIDTH-REFINEMENT-
            // 20260915: alineado al borde izquierdo del bloque de
            // controles en landscape (ya no centrado) — el owner pidió
            // explícitamente "NO centrar el formulario". Portrait
            // conserva el centrado ya aprobado, sin cambios.
            textAlign: compact ? TextAlign.left : TextAlign.center,
            style: textTheme.headlineMedium?.copyWith(
              fontSize: compact ? 21 : null,
              fontWeight: FontWeight.w800,
              color: DarkTech.textPrimary,
              shadows: legibilityShadow,
            ),
          ),
          SizedBox(height: titleSubtitleGap),
          Text(
            l10n.registerSubtitle,
            key: const Key('register-subtitle'),
            textAlign: compact ? TextAlign.left : TextAlign.center,
            style: textTheme.bodyLarge?.copyWith(
              fontSize: compact ? 13 : null,
              color: DarkTech.textSecondary,
              shadows: legibilityShadow,
            ),
          ),
          SizedBox(height: subtitleFieldsGap),
          TextFormField(
            controller: _nameController,
            textInputAction: TextInputAction.next,
            autofillHints: const <String>[AutofillHints.name],
            decoration: InputDecoration(
              labelText: l10n.nameLabel,
              prefixIcon: const Icon(Icons.person_outline),
              contentPadding: fieldContentPadding,
            ),
            validator: (String? value) => Validators.name(value).message(l10n),
          ),
          SizedBox(height: fieldGap),
          TextFormField(
            controller: _emailController,
            keyboardType: TextInputType.emailAddress,
            textInputAction: TextInputAction.next,
            autofillHints: const <String>[AutofillHints.email],
            decoration: InputDecoration(
              labelText: l10n.emailLabel,
              prefixIcon: const Icon(Icons.mail_outline),
              contentPadding: fieldContentPadding,
            ),
            validator: (String? value) => Validators.email(value).message(l10n),
          ),
          SizedBox(height: fieldGap),
          TextFormField(
            controller: _passwordController,
            obscureText: _obscurePassword,
            textInputAction: TextInputAction.next,
            autofillHints: const <String>[AutofillHints.newPassword],
            decoration: InputDecoration(
              labelText: l10n.passwordLabel,
              prefixIcon: const Icon(Icons.lock_outline),
              contentPadding: fieldContentPadding,
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
          SizedBox(height: fieldGap),
          TextFormField(
            controller: _confirmPasswordController,
            obscureText: _obscurePassword,
            textInputAction: TextInputAction.done,
            decoration: InputDecoration(
              labelText: l10n.confirmPasswordLabel,
              prefixIcon: const Icon(Icons.lock_outline),
              contentPadding: fieldContentPadding,
            ),
            onFieldSubmitted: (_) => _handleSubmit(),
            validator: (String? value) => Validators.confirmPassword(
              _passwordController.text,
              value,
            ).message(l10n),
          ),
          SizedBox(height: ctaGap),
          PrimaryGradientButton(
            label: l10n.registerButton,
            isLoading: registerState.isLoading,
            onPressed: anyLoading ? null : _handleSubmit,
          ),
          SizedBox(height: ctaTermsGap),
          Text(
            l10n.termsAcceptText,
            key: const Key('register-terms-text'),
            textAlign: TextAlign.center,
            style: textTheme.bodySmall?.copyWith(color: DarkTech.textSecondary, shadows: legibilityShadow),
          ),
          SizedBox(height: termsDividerGap),
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
          SizedBox(height: dividerGoogleGap),
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
          SizedBox(height: googleFooterGap),
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
                // Sin `color` explícito: el acento cyan/azul de marca
                // (`DarkTech.interactiveText`, vía `TextButtonThemeData`)
                // sigue aplicándose solo — únicamente se agrega sombra
                // para legibilidad sobre la foto.
                child: Text(
                  l10n.loginLink,
                  style: TextStyle(fontWeight: FontWeight.w700, shadows: legibilityShadow),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  /// SCREEN_03 PHONE COMPACT LANDSCAPE — KORIXA-SCREEN03-PHONE-COMPACT-
  /// LANDSCAPE-IMPLEMENTATION-20260915: cierra la brecha identificada por
  /// la auditoría KORIXA-LANDSCAPE-FIRST-ARCHITECTURE-AUDIT-20260915 —
  /// hasta ahora, un teléfono horizontal (844×390, 915×412, 932×430,
  /// `isCompactLandscape == true`) caía en `_buildLegacyShell` (el shell
  /// genérico sin foto, previo a todo el rediseño de SCREEN_03).
  ///
  /// Patrón arquitectónico reutilizado de `WelcomePage`/`LoginPage`
  /// (auditadas READ-ONLY, sin modificar ninguna de las dos):
  /// `StackFit.expand` + hero fullscreen + scrim + panel de contenido
  /// alineado a un lado con ancho PROPORCIONAL al viewport (nunca un
  /// número fijo de escritorio) — igual que `LoginPage._buildPhoneLandscape`
  /// (`panelWidth = (width * 0.56).clamp(260, 380)`).
  ///
  /// Hero: reusa el MISMO asset ya aprobado de escritorio
  /// (`_RegisterWebHeroImage`, `korixa_register_hero_desktop.png`, sin
  /// modificar ni un byte) — mismo precedente que
  /// `LoginPage._LoginHeroImage`, que también reusa su asset de
  /// escritorio (`korixa_login_hero_guatape_web.png`) para su propio
  /// `_buildPhoneLandscape`, solo cambiando el `alignment`. El aspect
  /// ratio del asset (1672×941 ≈ 1.78) frente a los aspect ratios de los
  /// viewports landscape requeridos (≈2.05–2.22) bajo `BoxFit.cover`
  /// produce un recorte vertical calculado de ~6–10% (matemática directa:
  /// p. ej. a 932×430, escala por ancho = 0.5575, alto escalado = 524.6,
  /// recorte total = 94.6px ≈ 47px por lado sobre 941px de alto original)
  /// — un recorte menor, no destructivo, así que NO se solicita un asset
  /// nuevo (Sección 6 de la tarea: "usar únicamente un asset existente si
  /// visualmente funciona correctamente"). El mismo `Alignment(0.35, 0)`
  /// ya aprobado para desktop (protege a la ciclista) se mantiene sin
  /// cambios — no hay razón para otro alignment dado que el recorte ya es
  /// mínimo.
  ///
  /// Panel alineado a la IZQUIERDA (`centerLeft`), reusando el MISMO
  /// scrim de escritorio (`_RegisterHeroContentScrim`, sin modificar) —
  /// continuidad visual exacta con la versión WEB ya aprobada, tal como
  /// pide la Sección 5 de la tarea ("que se perciba como la versión WEB
  /// de Korixa"). Contenido: reusa `_buildMobileFormContent` completo
  /// (mismos textos/orden/lógica/íconos/sombra de legibilidad ya
  /// aprobados en mobile portrait) — sin inventar un tercer tratamiento
  /// visual para los mismos campos.
  ///
  /// Teclado (Sección 7 de la tarea): NINGÚN mecanismo manual de
  /// `FocusNode`/`ensureVisible` — innecesario. `Scaffold.
  /// resizeToAvoidBottomInset` (default `true`, sin override en ningún
  /// Scaffold de esta pantalla) ya reduce el alto disponible cuando el
  /// teclado aparece, y `EditableText` internamente invoca
  /// `Scrollable.ensureVisible` al enfocar un campo SIEMPRE que exista un
  /// `Scrollable` ancestro — que este `SingleChildScrollView` ya provee.
  /// Es el mecanismo mínimo correcto: agregar código manual encima sería
  /// redundante con este comportamiento ya incorporado de Flutter.
  Widget _buildPhoneLandscape(
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
          key: const Key('register-landscape-layout'),
          fit: StackFit.expand,
          children: <Widget>[
            const Positioned.fill(
              key: Key('register-landscape-hero-image'),
              child: ExcludeSemantics(child: _RegisterWebHeroImage()),
            ),
            const Positioned.fill(
              key: Key('register-landscape-hero-scrim'),
              child: ExcludeSemantics(child: _RegisterHeroContentScrim()),
            ),
            SafeArea(
              // KORIXA-UI-SCREEN-BATCH-01A: `themeContext`, no el
              // `context` de `build` — mismo motivo que en las demás
              // composiciones.
              child: Builder(
                builder: (BuildContext themeContext) {
                  // Ancho proporcional al viewport — mismo mecanismo que
                  // `LoginPage._buildPhoneLandscape`, nunca un número fijo
                  // de escritorio. KORIXA-SCREEN03-COMPACT-LANDSCAPE-FORM-
                  // WIDTH-REFINEMENT-20260915 (ronda 1: 0.46→0.42,
                  // clamp(280,400)→clamp(300,390)) + ajuste posterior del
                  // owner (ronda 2, -12% adicional exacto sobre la ronda
                  // 1: 0.42×0.88=0.3696, 300×0.88=264≈270 (redondeado a un
                  // número más limpio), 390×0.88=343.2) — el owner, ya con
                  // el preview en mano, siguió percibiendo los controles
                  // demasiado anchos. Título/subtítulo/campos/CTA/
                  // términos/divisor/Google/footer comparten este MISMO
                  // ancho (un solo `Column` con `crossAxisAlignment.
                  // stretch` dentro de este `ConstrainedBox`) — nunca
                  // anchos distintos entre elementos.
                  final double panelWidth = (MediaQuery.of(themeContext).size.width * 0.3696).clamp(270.0, 343.2);
                  return Align(
                    alignment: Alignment.centerLeft,
                    child: Padding(
                      padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md, vertical: AppSpacing.sm),
                      child: ConstrainedBox(
                        key: const Key('register-landscape-panel-width'),
                        constraints: BoxConstraints(maxWidth: panelWidth),
                        child: SingleChildScrollView(
                          child: _buildMobileFormContent(
                            themeContext,
                            l10n,
                            registerState,
                            socialState,
                            anyLoading,
                            compact: true,
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
  /// `origin/main` — usado ÚNICAMENTE por `_buildLegacyShell` (red de
  /// seguridad teórica, no alcanzable en la práctica — ver `build()`).
  /// KORIXA-SCREEN03-WEB-MATCH-SCREEN02-DESKTOP-UI-SCALE-20260914:
  /// desktop dejó de reusar este método (ver `_buildDesktopFormContent`,
  /// estructuralmente distinto — agrupa logo/título/subtítulo/controles
  /// en bloques de `_desktopControlWidth` centrados, algo que este método
  /// no necesita) — restaurado a su forma simple original, sin el
  /// parámetro `desktop` que existía en rondas anteriores.
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

/// SCREEN_03 MOBILE PORTRAIT — KORIXA-SCREEN03-MOBILE-PORTRAIT-NO-LOGO-
/// IMPLEMENTATION-20260914: asset DEDICADO de encuadre vertical (937×1678)
/// — no es un recorte automático del hero de escritorio
/// (`korixa_register_hero_desktop.png`, 1672×941, 16:9): un `BoxFit.cover`
/// de esa foto panorámica sobre un viewport móvil angosto solo dejaría
/// visible una franja de ~26% de su ancho, mostrando la ciclista O el
/// Santuario, nunca ambos — el owner aprobó un mockup que muestra los dos
/// juntos, por lo que se generó/copió un archivo dedicado para este
/// encuadre. `BoxFit.cover` + `Alignment.center`: el aspect ratio del
/// asset (≈0.558) ya es muy cercano al de los 6 tamaños de validación
/// requeridos (0.45–0.56), así que el recorte real que introduce `cover`
/// es mínimo en cualquiera de ellos.
class _RegisterMobileHeroImage extends StatelessWidget {
  const _RegisterMobileHeroImage();

  @override
  Widget build(BuildContext context) {
    return Image.asset(
      'assets/images/korixa_register_hero_mobile.png',
      fit: BoxFit.cover,
      alignment: Alignment.center,
    );
  }
}
