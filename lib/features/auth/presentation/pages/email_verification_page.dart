import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../app/router/app_router.dart';
import '../../../../core/error/failures.dart';
import '../../../../l10n/generated/app_localizations.dart';
import '../../domain/entities/user_entity.dart';
import '../providers/auth_providers.dart';
import '../providers/email_verification_controller.dart';
import '../providers/logout_controller.dart';

/// Pantalla intermedia obligatoria para cuentas creadas con correo y
/// contraseña hasta que el usuario confirma el enlace enviado a su email.
/// Hace polling cada 5s contra Firebase (`reload()`) para detectar la
/// confirmación sin que el usuario tenga que volver manualmente a la app.
class EmailVerificationPage extends ConsumerStatefulWidget {
  const EmailVerificationPage({super.key});

  @override
  ConsumerState<EmailVerificationPage> createState() => _EmailVerificationPageState();
}

class _EmailVerificationPageState extends ConsumerState<EmailVerificationPage> {
  Timer? _pollingTimer;

  @override
  void initState() {
    super.initState();
    _pollingTimer = Timer.periodic(const Duration(seconds: 5), (_) => _checkVerified());
  }

  @override
  void dispose() {
    _pollingTimer?.cancel();
    super.dispose();
  }

  Future<void> _checkVerified() async {
    final bool verified = await ref.read(emailVerificationControllerProvider.notifier).checkIfVerified();
    if (verified && mounted) {
      context.go(AppRoute.home);
    }
  }

  /// Igual que `_checkVerified`: reacciona al resultado real de la
  /// acción, no a la transición loading→data del `AsyncValue` del
  /// controller — esa también ocurre al inicializarse
  /// `EmailVerificationController.build()` sin que el usuario haya tocado
  /// "Reenviar", lo que antes mostraba el snackbar de "correo reenviado"
  /// apenas se abría esta pantalla.
  Future<void> _handleResend() async {
    final bool success = await ref.read(emailVerificationControllerProvider.notifier).resendVerificationEmail();
    if (!mounted || !success) return;
    final AppLocalizations l10n = AppLocalizations.of(context);
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(l10n.emailVerificationSentMessage)));
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final AsyncValue<UserEntity?> authState = ref.watch(authStateProvider);
    final AsyncValue<void> verificationState = ref.watch(emailVerificationControllerProvider);
    final int cooldown = ref.watch(resendCooldownProvider);

    // Solo errores: el éxito del reenvío se maneja en `_handleResend`,
    // awaiteando el `Future<bool>` de la acción — nunca a partir de la
    // transición loading→data de este `AsyncValue`, que también ocurre al
    // inicializarse el controller sin que el usuario haya tocado nada.
    ref.listen<AsyncValue<void>>(emailVerificationControllerProvider, (previous, next) {
      if (next.hasError && !next.isLoading) {
        final Object error = next.error!;
        final String message = error is Failure ? error.message : l10n.genericErrorMessage;
        ScaffoldMessenger.of(context)
          ..hideCurrentSnackBar()
          ..showSnackBar(SnackBar(content: Text(message)));
      }
    });

    final String email = authState.valueOrNull?.email ?? '';

    return Scaffold(
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 420),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 24),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: <Widget>[
                  Icon(Icons.mark_email_unread_outlined, size: 72, color: Theme.of(context).colorScheme.primary),
                  const SizedBox(height: 24),
                  Text(
                    l10n.verifyEmailTitle,
                    style: Theme.of(context).textTheme.headlineSmall,
                    textAlign: TextAlign.center,
                  ),
                  const SizedBox(height: 12),
                  Text(
                    l10n.verifyEmailMessage(email),
                    textAlign: TextAlign.center,
                    style: Theme.of(context)
                        .textTheme
                        .bodyMedium
                        ?.copyWith(color: Theme.of(context).colorScheme.outline),
                  ),
                  const SizedBox(height: 32),
                  FilledButton(
                    onPressed: () => _checkVerified(),
                    child: Text(l10n.iVerifiedButton),
                  ),
                  const SizedBox(height: 12),
                  OutlinedButton(
                    onPressed: cooldown > 0 || verificationState.isLoading ? null : () => _handleResend(),
                    child: Text(
                      cooldown > 0 ? l10n.resendEmailCooldown(cooldown) : l10n.resendEmailButton,
                    ),
                  ),
                  const SizedBox(height: 20),
                  TextButton(
                    onPressed: () => ref.read(logoutControllerProvider.notifier).logout(),
                    child: Text(l10n.useAnotherAccountLink),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
