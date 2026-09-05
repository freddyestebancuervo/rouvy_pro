import 'package:flutter/foundation.dart' show defaultTargetPlatform, kIsWeb, TargetPlatform;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../app/router/app_router.dart';
import '../../../../app/theme/app_colors.dart';
import '../../../../app/theme/app_spacing.dart';
import '../../../../core/design_system/dark_tech_buttons.dart';
import '../../../../core/error/failures.dart';
import '../../../../core/utils/validation_l10n.dart';
import '../../../../core/utils/validators.dart';
import '../../../../l10n/generated/app_localizations.dart';
import '../providers/login_controller.dart';
import '../providers/social_auth_controller.dart';
import '../widgets/dark_tech_auth_shell.dart';
import '../widgets/social_sign_in_buttons.dart';

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

    return DarkTechAuthShell(
      maxWidth: 420,
      // KORIXA-UI-SCREEN-BATCH-01A: `themeContext`, no el `context` de
      // `build` — ver el docblock de `DarkTechAuthShell`.
      builder: (BuildContext themeContext) {
        final TextTheme textTheme = Theme.of(themeContext).textTheme;
        return Form(
          key: _formKey,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              Text(l10n.loginTitle, style: textTheme.headlineMedium),
              const SizedBox(height: AppSpacing.sm),
              Text(
                l10n.loginSubtitle,
                style: textTheme.bodyMedium?.copyWith(color: DarkTech.textSecondary),
              ),
              const SizedBox(height: AppSpacing.xl),
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
                textInputAction: TextInputAction.done,
                autofillHints: const <String>[AutofillHints.password],
                decoration: InputDecoration(
                  labelText: l10n.passwordLabel,
                  suffixIcon: Semantics(
                    // `toggled` anuncia al lector de pantalla el
                    // estado actual (mostrando/ocultando), no solo
                    // "botón" — sin esto, VoiceOver/TalkBack solo
                    // dirían "botón, doble toque para activar", sin
                    // que la persona sepa qué hace ni en qué estado
                    // está.
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
                // En login (a diferencia de registro) solo se exige que
                // no esté vacío — no se re-valida la política de
                // complejidad de una contraseña ya creada.
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
              const SizedBox(height: AppSpacing.xl),
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
              const SizedBox(height: AppSpacing.xl),
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
      },
    );
  }
}
