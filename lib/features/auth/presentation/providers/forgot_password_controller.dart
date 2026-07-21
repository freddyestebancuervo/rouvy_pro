import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/usecases/send_password_reset_usecase.dart';
import 'auth_providers.dart';

final forgotPasswordControllerProvider =
    AsyncNotifierProvider<ForgotPasswordController, void>(ForgotPasswordController.new);

class ForgotPasswordController extends AsyncNotifier<void> {
  @override
  Future<void> build() async {}

  Future<bool> submit(String email) async {
    state = const AsyncLoading();
    final useCase = ref.read(sendPasswordResetUseCaseProvider);
    final result = await useCase(SendPasswordResetParams(email: email));

    return result.fold(
      (failure) {
        state = AsyncError(failure, StackTrace.current);
        return false;
      },
      (_) {
        state = const AsyncData(null);
        return true;
      },
    );
  }
}
