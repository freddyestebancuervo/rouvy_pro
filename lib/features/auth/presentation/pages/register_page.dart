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

  static const double _desktopContentMaxWidth = 420;

  /// SCREEN_03 WEB (desktop) — KORIXA-SCREEN03-WEB-FINAL-COMPOSITION-
  /// CORRECTION-20260914: la ronda anterior (REFINEMENT) seguía leyendo
  /// visualmente como una card — el scrim cubría el 55% derecho del
  /// viewport con una transición abrupta (`stops: [0.45, 1.0]`) y alfa
  /// uniforme en toda la altura, lo que se percibía como un rectángulo
  /// oscuro sólido pese a no tener `borderRadius`/`border` propios. Esta
  /// corrección angosta el degradado para que nazca y termine cerca del
  /// borde derecho (`_RegisterHeroContentScrim` con 3 stops, transparente
  /// bastante antes del centro) y reduce el ancho del bloque de contenido
  /// (420, dentro del rango 400–430 pedido) — la fotografía completa
  /// (Santuario de Las Lajas, `BoxFit.contain`, sin cambios de asset)
  /// sigue siendo la protagonista.
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
                  // KORIXA-SCREEN03-WEB-FINAL-COMPOSITION-CORRECTION-
                  // 20260914: margen derecho responsive (40 en viewports
                  // más angostos, 64 desde 1920 en adelante) — pedido
                  // explícito de la tarea, sin introducir ningún token de
                  // espaciado nuevo fuera de los ya existentes.
                  final double screenWidth = MediaQuery.of(themeContext).size.width;
                  final double rightMargin = screenWidth >= 1920 ? 64 : AppSpacing.xxxl;
                  return Align(
                    alignment: Alignment.centerRight,
                    child: Padding(
                      padding: EdgeInsets.only(
                        top: AppSpacing.xxxl,
                        bottom: AppSpacing.xxxl,
                        right: rightMargin,
                        left: AppSpacing.xxxl,
                      ),
                      child: ConstrainedBox(
                        key: const Key('register-desktop-content-max-width'),
                        constraints: const BoxConstraints(maxWidth: _desktopContentMaxWidth),
                        child: SingleChildScrollView(
                          child: _buildStandardFormContent(
                            themeContext,
                            l10n,
                            registerState,
                            socialState,
                            anyLoading,
                            desktop: true,
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
  /// `origin/main` — extraído a un método para poder reusarlo desde
  /// `_buildLegacyShell` y `_buildDesktopWeb` sin duplicar código.
  ///
  /// [desktop] (`false` por defecto): preserva el comportamiento EXACTO
  /// de siempre para `_buildLegacyShell` (portrait/phone landscape, sin
  /// cambios) — KORIXA-SCREEN03-WEB-UI-COMPOSITION-REFINEMENT-20260914
  /// solo pidió refinar la composición WEB (desktop), nunca tocar mobile/
  /// phone landscape. `true` (solo desde `_buildDesktopWeb`) da al
  /// título/subtítulo/texto-secundario mayor jerarquía y una sombra de
  /// legibilidad — el formulario ya no vive dentro de una card opaca, así
  /// que necesita ese recurso para leerse sobre la foto, igual que ya
  /// hace `LoginPage._buildFormColumn` con `floatingOverPhoto: true`.
  /// Campos, botón, textos y lógica siguen siendo exactamente los mismos
  /// widgets en el mismo orden — no hay ninguna rama de comportamiento
  /// funcional aquí, solo de estilo tipográfico.
  Widget _buildStandardFormContent(
    BuildContext themeContext,
    AppLocalizations l10n,
    AsyncValue<void> registerState,
    AsyncValue<void> socialState,
    bool anyLoading, {
    bool desktop = false,
  }) {
    final TextTheme textTheme = Theme.of(themeContext).textTheme;
    final List<Shadow>? legibilityShadow = desktop
        ? <Shadow>[Shadow(color: Colors.black.withValues(alpha: 0.65), blurRadius: 10)]
        : null;
    return Form(
          key: _formKey,
          autovalidateMode: AutovalidateMode.onUserInteraction,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              Text(
                l10n.registerTitle,
                key: const Key('register-title'),
                style: textTheme.headlineMedium?.copyWith(
                  fontSize: desktop ? 40 : null,
                  fontWeight: desktop ? FontWeight.w800 : null,
                  color: desktop ? DarkTech.textPrimary : null,
                  letterSpacing: desktop ? -0.5 : null,
                  height: desktop ? 1.08 : null,
                  shadows: legibilityShadow,
                ),
              ),
              const SizedBox(height: AppSpacing.sm),
              Text(
                l10n.registerSubtitle,
                key: const Key('register-subtitle'),
                style: textTheme.bodyMedium?.copyWith(
                  color: DarkTech.textSecondary,
                  fontSize: desktop ? 17 : null,
                  shadows: legibilityShadow,
                ),
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
                style: textTheme.bodySmall?.copyWith(
                  color: DarkTech.textSecondary,
                  shadows: legibilityShadow,
                ),
              ),
              const SizedBox(height: AppSpacing.lg),
              Row(
                children: <Widget>[
                  const Expanded(child: Divider()),
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md),
                    child: Text(
                      l10n.orDividerText,
                      style: textTheme.bodySmall?.copyWith(
                        shadows: legibilityShadow,
                      ),
                    ),
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
                    style: desktop
                        ? textTheme.bodyMedium?.copyWith(color: DarkTech.textSecondary, shadows: legibilityShadow)
                        : null,
                  ),
                  TextButton(
                    onPressed: () => context.go(AppRoute.login),
                    // Sin `color` explícito: el acento cyan/azul de marca
                    // (`DarkTech.interactiveText`, vía `TextButtonThemeData`
                    // ya existente y compartido con todo el resto de la
                    // app) sigue aplicándose solo; en desktop se agrega
                    // únicamente `fontWeight`/sombra para legibilidad
                    // sobre la foto, sin pisar ese color de marca.
                    child: Text(
                      l10n.loginLink,
                      style: desktop
                          ? TextStyle(fontWeight: FontWeight.w700, shadows: legibilityShadow)
                          : null,
                    ),
                  ),
                ],
              ),
            ],
          ),
        );
  }
}

/// SCREEN_03 WEB: imagen de fondo completa, sin recorte (`BoxFit.contain`)
/// — asset inmutable, ver `assets/images/korixa_register_hero_laslajas_web.png`.
class _RegisterWebHeroImage extends StatelessWidget {
  const _RegisterWebHeroImage();

  @override
  Widget build(BuildContext context) {
    return Image.asset(
      'assets/images/korixa_register_hero_laslajas_web.png',
      fit: BoxFit.contain,
      alignment: Alignment.center,
    );
  }
}

/// Degradado MUY angosto desde el borde derecho — KORIXA-SCREEN03-WEB-
/// FINAL-COMPOSITION-CORRECTION-20260914. La versión anterior
/// (REFINEMENT-20260914) cubría el 55% derecho del viewport con una
/// transición abrupta en un único salto (`stops: [0.45, 1.0]`) y alfa
/// uniforme en toda la altura — el owner reportó que eso seguía leyéndose
/// como una card/rectángulo oscuro pese a no tener `borderRadius` ni
/// `border` propios. Esta versión nace en el borde derecho mismo
/// (`begin/end` invertidos) y se desvanece a transparente con 3 stops
/// (0.0 → 0.28 → 0.55), sin ningún salto duro perceptible, terminando
/// bastante antes del centro del viewport — deja el Santuario y la
/// ciclista completamente sin velo. NO es una card/panel: sin
/// `borderRadius`, sin `border`, sin límite rectangular — es exactamente
/// el mismo recurso ya aprobado en SCREEN_02
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
          begin: Alignment.centerRight,
          end: Alignment.centerLeft,
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
