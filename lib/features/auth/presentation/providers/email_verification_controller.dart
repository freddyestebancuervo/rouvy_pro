import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/usecase/usecase.dart';
import '../../domain/entities/user_entity.dart';
import 'auth_providers.dart';

/// Segundos de espera obligatoria entre reenvíos, para no golpear el
/// límite de envíos de Firebase Auth (y no saturar al usuario de correos).
const int emailVerificationCooldownSeconds = 30;

/// Cuenta regresiva del botón "Reenviar correo". Vive separado del
/// controller principal para que la UI pueda observarla sin reconstruir
/// todo lo demás cada segundo.
final resendCooldownProvider = NotifierProvider<ResendCooldownNotifier, int>(
  ResendCooldownNotifier.new,
);

class ResendCooldownNotifier extends Notifier<int> {
  Timer? _timer;

  @override
  int build() {
    ref.onDispose(() => _timer?.cancel());
    return 0;
  }

  void start() {
    state = emailVerificationCooldownSeconds;
    _timer?.cancel();
    _timer = Timer.periodic(const Duration(seconds: 1), (Timer t) {
      if (state <= 1) {
        state = 0;
        t.cancel();
      } else {
        state -= 1;
      }
    });
  }
}

final emailVerificationControllerProvider =
    AsyncNotifierProvider<EmailVerificationController, void>(EmailVerificationController.new);

class EmailVerificationController extends AsyncNotifier<void> {
  @override
  Future<void> build() async {}

  Future<bool> resendVerificationEmail() async {
    state = const AsyncLoading();
    final result = await ref.read(sendEmailVerificationUseCaseProvider)(const NoParams());
    return result.fold(
      (failure) {
        state = AsyncError(failure, StackTrace.current);
        return false;
      },
      (_) {
        state = const AsyncData(null);
        ref.read(resendCooldownProvider.notifier).start();
        return true;
      },
    );
  }

  /// Devuelve `true` si tras recargar el usuario contra Firebase, el
  /// correo ya quedó verificado. Refresca `authStateProvider` para que el
  /// router reaccione y saque al usuario de esta pantalla automáticamente.
  Future<bool> checkIfVerified() async {
    final result = await ref.read(reloadUserUseCaseProvider)(const NoParams());
    return result.fold(
      (failure) => false,
      (UserEntity? user) {
        final bool verified = user?.emailVerified ?? false;
        if (verified) {
          // Fuerza a authStateProvider a re-suscribirse: al recibir el
          // valor actual del stream de Firebase, ya reflejará el
          // `emailVerified: true` que acabamos de confirmar con reload().
          ref.invalidate(authStateProvider);
        }
        return verified;
      },
    );
  }
}
