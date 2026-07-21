import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/usecase/usecase.dart';
import 'auth_providers.dart';

final logoutControllerProvider =
    AsyncNotifierProvider<LogoutController, void>(LogoutController.new);

class LogoutController extends AsyncNotifier<void> {
  @override
  Future<void> build() async {}

  Future<void> logout() async {
    state = const AsyncLoading();
    final result = await ref.read(logoutUseCaseProvider)(const NoParams());
    state = result.fold(
      (failure) => AsyncError(failure, StackTrace.current),
      (_) => const AsyncData(null),
    );
    // No hace falta navegar manualmente: al cerrar sesión,
    // `authStateProvider` emite `null` y `GoRouter.redirect` envía al
    // usuario a Welcome/Login automáticamente.
  }
}
