import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/entities/user_entity.dart';
import '../../domain/usecases/update_profile_usecase.dart';
import 'auth_providers.dart';

final profileControllerProvider =
    AsyncNotifierProvider<ProfileController, void>(ProfileController.new);

class ProfileController extends AsyncNotifier<void> {
  @override
  Future<void> build() async {}

  Future<bool> updateProfile({
    String? displayName,
    int? ftp,
    double? weightKg,
  }) async {
    state = const AsyncLoading();
    final useCase = ref.read(updateProfileUseCaseProvider);
    final result = await useCase(
      UpdateProfileParams(displayName: displayName, ftp: ftp, weightKg: weightKg),
    );

    return result.fold(
      (failure) {
        state = AsyncError(failure, StackTrace.current);
        return false;
      },
      (UserEntity user) {
        state = const AsyncData(null);
        // El documento de Firestore ya se actualizó; refrescamos el stream
        // de sesión para que Home/Perfil reflejen el cambio de inmediato
        // sin esperar al siguiente evento natural de authStateChanges.
        ref.invalidate(authStateProvider);
        return true;
      },
    );
  }
}
