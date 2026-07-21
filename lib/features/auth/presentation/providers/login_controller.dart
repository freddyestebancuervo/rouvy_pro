import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/entities/user_entity.dart';
import '../../domain/usecases/login_usecase.dart';
import 'auth_providers.dart';

/// Controla el envío del formulario de login. Al usar `AsyncNotifier<void>`,
/// la UI puede reaccionar a `isLoading` / `hasError` directamente desde
/// `ref.watch(loginControllerProvider)` sin variables de estado manuales
/// (`_isLoading`, `setState`).
final loginControllerProvider =
    AsyncNotifierProvider<LoginController, void>(LoginController.new);

class LoginController extends AsyncNotifier<void> {
  @override
  Future<void> build() async {
    // Sin estado inicial que cargar; el "estado" real es el resultado del
    // último submit.
  }

  Future<bool> submit({required String email, required String password}) async {
    state = const AsyncLoading();

    final LoginUseCase useCase = ref.read(loginUseCaseProvider);
    final result = await useCase(LoginParams(email: email, password: password));

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
