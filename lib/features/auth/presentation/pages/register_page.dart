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
import '../providers/register_controller.dart';
import '../providers/social_auth_controller.dart';
import '../widgets/dark_tech_auth_shell.dart';
import '../widgets/social_sign_in_buttons.dart';

/// KORIXA-SCREEN03-REGISTER-MOBILE-VISUAL-IMPLEMENTATION-20260913: solo
/// mobile portrait recibe la composición nueva alineada con SCREEN_02
/// (hero fotográfico + bloque bottom-anchored). Deliberadamente NO reusa
/// ningún widget privado de `login_page.dart` (`_LoginHeroImage` etc.) —
/// SCREEN_02 está LOCKED y no se toca ni se refactoriza para compartir
/// código con esta pantalla; el hero/scrim de acá son una implementación
/// mínima propia de este archivo.
///
/// KORIXA-SCREEN03-WEB-FINAL-BACKGROUND-ASSET-INTEGRATION-20260913:
/// desktop web (`canFitWideLayout()`, mismo criterio que Login) recibe su
/// propio hero fotográfico (Santuario de Las Lajas,
/// `korixa_register_hero_laslajas_web.png`) con `BoxFit.contain` — la
/// foto se ve COMPLETA, sin crop, aunque queden franjas de
/// `DarkTech.background` sólido a los lados/arriba/abajo. Phone landscape
/// (landscape angosto) sigue exactamente con `DarkTechAuthShell`, sin
/// cambios — fuera de alcance.
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

  // KORIXA-SCREEN03-REGISTER-MOBILE-VISUAL-IMPLEMENTATION-20260913: mismo
  // mecanismo de "medir-y-decidir" ya probado en SCREEN_02 Login (ver
  // `login_page.dart`, `_schedulePortraitScrollFitMeasurement`) —
  // reimplementado acá de forma independiente, no importado, para no
  // acoplar esta pantalla a SCREEN_02. Register tiene más contenido que
  // Login (2 campos más + texto de términos), así que el encargo pide
  // explícitamente NO forzar "sin scroll a toda costa": este `GlobalKey`
  // mide el alto NATURAL real del grupo tras cada layout y compara contra
  // el alto real disponible — si cabe, el bloque queda fijo
  // (`NeverScrollableScrollPhysics`); si no cabe, se permite scroll real
  // en vez de recortar contenido o forzar overflow. `true` por defecto
  // (scrolleable) es la opción segura de antemano — visualmente
  // indistinguible de un bloque fijo durante el primer frame, antes de
  // que el post-frame callback resuelva el valor real.
  final GlobalKey _portraitContentKey = GlobalKey();
  bool _portraitScrollNeeded = true;

  void _schedulePortraitScrollFitMeasurement(double availableHeight) {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      final RenderBox? contentBox = _portraitContentKey.currentContext?.findRenderObject() as RenderBox?;
      if (contentBox == null || !contentBox.hasSize) return;
      final bool needsScroll = contentBox.size.height > availableHeight;
      if (needsScroll != _portraitScrollNeeded) {
        setState(() => _portraitScrollNeeded = needsScroll);
      }
    });
  }

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

    // KORIXA-SCREEN03-REGISTER-MOBILE-VISUAL-IMPLEMENTATION-20260913:
    // clasificación de viewport vía la misma fundación compartida que ya
    // usan Welcome/Login (`KorixaViewportInfo`, sin estado, sin efectos
    // secundarios — reusarla acá no puede regresionar SCREEN_01/02).
    // Portrait (mobile Y tablet portrait, mismo criterio que Login) recibe
    // la composición mobile; un viewport landscape ANCHO (mismo criterio
    // `canFitWideLayout()` que Login desktop) recibe la composición WEB
    // nueva de esta ronda; phone landscape (landscape angosto) sigue
    // exactamente con `DarkTechAuthShell`, sin cambios — fuera de alcance.
    return LayoutBuilder(
      builder: (BuildContext context, BoxConstraints constraints) {
        final KorixaViewportInfo viewport = KorixaViewportInfo(width: constraints.maxWidth, height: constraints.maxHeight);
        if (viewport.isPortrait) {
          return _buildMobilePortrait(context, l10n, registerState, socialState, anyLoading);
        }
        if (viewport.canFitWideLayout()) {
          return _buildDesktopWeb(context, l10n, registerState, socialState, anyLoading);
        }
        return _buildLegacyShell(context, l10n, registerState, socialState, anyLoading);
      },
    );
  }

  /// Composición EXACTA que ya tenía `RegisterPage` antes de esta tarea —
  /// sin ningún cambio — ahora exclusiva de phone landscape (landscape
  /// angosto), fuera de alcance esta ronda.
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
      builder: (BuildContext themeContext) =>
          _buildStandardFormContent(themeContext, l10n, registerState, socialState, anyLoading),
    );
  }

  /// KORIXA-SCREEN03-WEB-FINAL-BACKGROUND-ASSET-INTEGRATION-20260913:
  /// composición WEB nueva — hero fotográfico aprobado (Santuario de Las
  /// Lajas) detrás del MISMO contenido de formulario que ya tenía Register
  /// (extraído sin cambios a `_buildStandardFormContent`, reusado también
  /// por `_buildLegacyShell`). El asset se muestra con `BoxFit.contain`:
  /// prioridad absoluta a mostrar la foto COMPLETA, sin crop/zoom/
  /// deformación — el espacio residual (letterbox) se resuelve con el
  /// mismo `DarkTech.background` sólido de siempre, nunca recortando la
  /// imagen para "llenar" el viewport.
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
            // `DecoratedBox` sólido primero — el espacio que el hero deja
            // libre (letterbox, inevitable cuando el aspect ratio del
            // asset no coincide con el del viewport) queda en este mismo
            // fondo oscuro ya aprobado, nunca en negro "por defecto" sin
            // relación con el resto del sistema visual.
            const Positioned.fill(
              child: DecoratedBox(decoration: BoxDecoration(color: DarkTech.background)),
            ),
            const Positioned.fill(
              key: Key('register-desktop-hero-image'),
              child: ExcludeSemantics(child: _RegisterWebHeroImage()),
            ),
            SafeArea(
              // KORIXA-UI-SCREEN-BATCH-01A (mismo defecto ya documentado en
              // `DarkTechAuthShell`): el `context` recibido como parámetro
              // de este método viene del `LayoutBuilder` de `build()`, POR
              // ENCIMA del `Theme(data: AppTheme.darkTech)` de arriba —
              // cualquier `Theme.of(context)` con ESE context resolvería el
              // tema AMBIENTE de `MaterialApp`, no Dark Tech. Este `Builder`
              // da un context NUEVO, ya por debajo del `Theme` insertado
              // acá, para que `_buildStandardFormContent` resuelva Dark
              // Tech correctamente.
              child: Builder(
                builder: (BuildContext themeContext) => Align(
                  alignment: Alignment.center,
                  child: Padding(
                    padding: const EdgeInsets.all(AppSpacing.xxxl),
                    child: ConstrainedBox(
                      key: const Key('register-desktop-content-max-width'),
                      constraints: const BoxConstraints(maxWidth: 420),
                      // KORIXA-SCREEN03-WEB-FINAL-BACKGROUND-ASSET-
                      // INTEGRATION-20260913: ajuste MÍNIMO estrictamente
                      // necesario para mantener el formulario legible
                      // sobre la foto (`BoxFit.contain` deja partes muy
                      // claras del cielo/carretera directamente detrás del
                      // texto, sin ningún scrim) — un panel sólido
                      // semitransparente detrás del formulario, NUNCA
                      // sobre la imagen en sí (la imagen no se toca; este
                      // panel vive en una capa separada del `Stack`,
                      // encima de la foto pero sin modificarla). Ni
                      // texto/campos/orden/copy cambian.
                      child: DecoratedBox(
                        key: const Key('register-desktop-legibility-panel'),
                        decoration: BoxDecoration(
                          color: DarkTech.surface.withValues(alpha: 0.82),
                          borderRadius: BorderRadius.circular(24),
                        ),
                        child: Padding(
                          padding: const EdgeInsets.all(AppSpacing.xl),
                          child: SingleChildScrollView(
                            child:
                                _buildStandardFormContent(themeContext, l10n, registerState, socialState, anyLoading),
                          ),
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

  /// Contenido de formulario EXACTO que `RegisterPage` ya tenía antes de
  /// esta tarea — mismo texto/orden/lógica, sin ningún cambio — extraído a
  /// un método propio para que `_buildLegacyShell` (phone landscape) y
  /// `_buildDesktopWeb` (nuevo, esta ronda) lo compartan sin duplicar el
  /// árbol de widgets. Ningún archivo compartido del sistema de diseño se
  /// tocó para esto — es un refactor puramente interno de este archivo.
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
          Text(l10n.registerTitle, style: textTheme.headlineMedium),
          const SizedBox(height: AppSpacing.sm),
          Text(
            l10n.registerSubtitle,
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

  /// Composición NUEVA — solo mobile portrait (y tablet portrait, mismo
  /// criterio que Login). Hero fotográfico + bloque de formulario
  /// bottom-anchored, alineado visualmente con SCREEN_02 Login mobile
  /// aprobado, SIN reusar ningún widget privado de `login_page.dart`.
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
          key: const Key('register-portrait-layout'),
          fit: StackFit.expand,
          children: <Widget>[
            // KORIXA-SCREEN03-REGISTER-MOBILE-VISUAL-IMPLEMENTATION-
            // 20260913: asset móvil EXACTO ya aprobado para SCREEN_02 —
            // mismo archivo, sin recorte/regenerar/filtro. `BoxFit.cover`
            // + `Alignment.center`, sin `Transform.scale`/`Matrix4`/zoom
            // de ningún tipo — implementación local mínima (no se importa
            // ni se toca `_LoginHeroImage` de `login_page.dart`).
            const ExcludeSemantics(
              key: Key('register-hero-image'),
              child: _RegisterHeroImage(),
            ),
            const Positioned.fill(
              child: DecoratedBox(decoration: BoxDecoration(gradient: AppGradients.imageScrimBottom)),
            ),
            SafeArea(
              child: LayoutBuilder(
                builder: (BuildContext context, BoxConstraints safeAreaConstraints) {
                  final double actualViewportHeight = safeAreaConstraints.maxHeight;
                  _schedulePortraitScrollFitMeasurement(actualViewportHeight);

                  return Align(
                    alignment: Alignment.topCenter,
                    child: ConstrainedBox(
                      key: const Key('register-portrait-content-max-width'),
                      constraints: const BoxConstraints(maxWidth: 480),
                      child: SizedBox(
                        height: actualViewportHeight,
                        child: SingleChildScrollView(
                          physics: _portraitScrollNeeded ? null : const NeverScrollableScrollPhysics(),
                          child: ConstrainedBox(
                            constraints: BoxConstraints(minHeight: actualViewportHeight),
                            child: Padding(
                              key: _portraitContentKey,
                              padding: const EdgeInsets.fromLTRB(AppSpacing.xl, 0, AppSpacing.xl, AppSpacing.sm),
                              child: Form(
                                key: _formKey,
                                autovalidateMode: AutovalidateMode.onUserInteraction,
                                child: Column(
                                  mainAxisSize: MainAxisSize.min,
                                  mainAxisAlignment: MainAxisAlignment.end,
                                  crossAxisAlignment: CrossAxisAlignment.stretch,
                                  children: _mobilePortraitFormChildren(
                                    context: context,
                                    l10n: l10n,
                                    registerState: registerState,
                                    socialState: socialState,
                                    anyLoading: anyLoading,
                                  ),
                                ),
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
        ),
      ),
    );
  }

  List<Widget> _mobilePortraitFormChildren({
    required BuildContext context,
    required AppLocalizations l10n,
    required AsyncValue<void> registerState,
    required AsyncValue<void> socialState,
    required bool anyLoading,
  }) {
    final TextTheme textTheme = Theme.of(context).textTheme;
    const EdgeInsetsGeometry fieldContentPadding = EdgeInsets.symmetric(horizontal: 16, vertical: 12);
    const double gapXs = AppSpacing.xs;
    const double gapSm = AppSpacing.sm;

    return <Widget>[
      Text(
        l10n.registerTitle,
        key: const Key('register-title'),
        textAlign: TextAlign.center,
        style: textTheme.headlineMedium?.copyWith(fontWeight: FontWeight.w800),
      ),
      const SizedBox(height: gapXs),
      Text(
        l10n.registerSubtitle,
        key: const Key('register-subtitle'),
        textAlign: TextAlign.center,
        style: textTheme.bodyLarge?.copyWith(
          color: Color.lerp(DarkTech.textSecondary, Colors.white, 0.55),
          shadows: <Shadow>[Shadow(color: Colors.black.withValues(alpha: 0.55), blurRadius: 6)],
        ),
      ),
      const SizedBox(height: gapXs),
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
      const SizedBox(height: gapSm),
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
      const SizedBox(height: gapSm),
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
      const SizedBox(height: gapSm),
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
      const SizedBox(height: gapXs),
      const Center(
        child: ThreeBarIndicator(
          key: Key('register-portrait-indicator-row'),
          barWidth: 22,
          barHeight: 4,
          gap: 5,
          activeIndex: 2,
        ),
      ),
      const SizedBox(height: gapXs),
      PrimaryGradientButton(
        label: l10n.registerButton,
        isLoading: registerState.isLoading,
        onPressed: anyLoading ? null : _handleSubmit,
        height: 48,
      ),
      const SizedBox(height: gapXs),
      Text(
        l10n.termsAcceptText,
        key: const Key('register-terms-text'),
        textAlign: TextAlign.center,
        style: textTheme.bodySmall?.copyWith(color: DarkTech.textSecondary),
      ),
      const SizedBox(height: gapSm),
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
      const SizedBox(height: gapSm),
      SizedBox(
        height: 48,
        child: GoogleSignInButton(
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
        const SizedBox(height: gapSm),
        SizedBox(
          height: 48,
          child: AppleSignInButton(
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
      const SizedBox(height: gapSm),
      Wrap(
        alignment: WrapAlignment.center,
        crossAxisAlignment: WrapCrossAlignment.center,
        children: <Widget>[
          Text(l10n.hasAccountText, style: TextStyle(shadows: <Shadow>[Shadow(color: Colors.black.withValues(alpha: 0.45), blurRadius: 6)])),
          TextButton(
            onPressed: () => context.go(AppRoute.login),
            child: Text(l10n.loginLink),
          ),
        ],
      ),
    ];
  }
}

/// KORIXA-SCREEN03-REGISTER-MOBILE-VISUAL-IMPLEMENTATION-20260913: hero
/// mínimo propio de esta pantalla — mismo asset aprobado de SCREEN_02
/// mobile, mismo `BoxFit.cover`/`Alignment.center`, sin ningún mecanismo
/// de zoom. Deliberadamente un widget nuevo (no `_LoginHeroImage`
/// importado) para no acoplar esta pantalla al archivo LOCKED de Login.
class _RegisterHeroImage extends StatelessWidget {
  const _RegisterHeroImage();

  @override
  Widget build(BuildContext context) {
    return Image.asset(
      'assets/images/korixa_login_hero_guatape_mobile.png',
      fit: BoxFit.cover,
      alignment: Alignment.center,
    );
  }
}

/// KORIXA-SCREEN03-WEB-FINAL-BACKGROUND-ASSET-INTEGRATION-20260913: hero
/// WEB definitivo de Register (Santuario de Las Lajas) — asset aprobado,
/// copiado byte a byte, `korixa_register_hero_laslajas_web.png`, sin
/// recorte/regenerar/filtro/reencuadre. Deliberadamente `BoxFit.contain`
/// (NO `.cover`): el encargo exige mostrar la foto COMPLETA sin importar
/// que el aspect ratio del viewport no coincida — el espacio residual
/// (letterbox) lo resuelve el `DecoratedBox` sólido detrás en
/// `_buildDesktopWeb`, la imagen en sí nunca se recorta ni se estira para
/// "llenar" el viewport. Sin `Transform.scale`/`Matrix4`/ningún
/// mecanismo de zoom.
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
