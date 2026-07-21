import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/usecase/usecase.dart';
import '../../domain/entities/user_entity.dart';
import 'auth_providers.dart';

/// Controla ambos botones de login social. Se modela como un único
/// notifier (en vez de uno por proveedor) porque solo uno puede estar en
/// curso a la vez y comparten exactamente la misma forma de estado
/// (loading/data/error) — duplicar la clase no aportaría nada.
final socialAuthControllerProvider =
    AsyncNotifierProvider<SocialAuthController, void>(SocialAuthController.new);

class SocialAuthController extends AsyncNotifier<void> {
  @override
  Future<void> build() async {}

  Future<bool> signInWithGoogle() async {
    state = const AsyncLoading();
    final result = await ref.read(signInWithGoogleUseCaseProvider)(const NoParams());
    return result.fold(
      (failure) {
        state = AsyncError(failure, StackTrace.current);
        return false;
      },
      (UserEntity user) {
        state = const AsyncData(null);
        return true;
      },
    );
  }

  Future<bool> signInWithApple() async {
    state = const AsyncLoading();
    final result = await ref.read(signInWithAppleUseCaseProvider)(const NoParams());
    return result.fold(
      (failure) {
        state = AsyncError(failure, StackTrace.current);
        return false;
      },
      (UserEntity user) {
        state = const AsyncData(null);
        return true;
      },
    );
  }
}
