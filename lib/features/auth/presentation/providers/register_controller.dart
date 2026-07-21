import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/entities/user_entity.dart';
import '../../domain/usecases/register_usecase.dart';
import 'auth_providers.dart';

final registerControllerProvider =
    AsyncNotifierProvider<RegisterController, void>(RegisterController.new);

class RegisterController extends AsyncNotifier<void> {
  @override
  Future<void> build() async {}

  Future<bool> submit({
    required String email,
    required String password,
    required String displayName,
  }) async {
    state = const AsyncLoading();

    final RegisterUseCase useCase = ref.read(registerUseCaseProvider);
    final result = await useCase(
      RegisterParams(email: email, password: password, displayName: displayName),
    );

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
