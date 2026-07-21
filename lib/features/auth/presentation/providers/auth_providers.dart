import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/di/injection.dart';
import '../../domain/entities/user_entity.dart';
import '../../domain/repositories/auth_repository.dart';
import '../../domain/usecases/get_current_user_usecase.dart';
import '../../domain/usecases/login_usecase.dart';
import '../../domain/usecases/logout_usecase.dart';
import '../../domain/usecases/register_usecase.dart';
import '../../domain/usecases/reload_user_usecase.dart';
import '../../domain/usecases/send_email_verification_usecase.dart';
import '../../domain/usecases/send_password_reset_usecase.dart';
import '../../domain/usecases/sign_in_with_apple_usecase.dart';
import '../../domain/usecases/sign_in_with_google_usecase.dart';
import '../../domain/usecases/update_profile_usecase.dart';

/// Puente entre `get_it` (contenedor de DI) y Riverpod (gestión de estado).
/// Se mantiene la inyección de dependencias desacoplada de Riverpod para
/// poder testear usecases sin necesidad de un `ProviderContainer`.
final authRepositoryProvider = Provider<AuthRepository>((Ref ref) => sl<AuthRepository>());

final loginUseCaseProvider = Provider<LoginUseCase>((Ref ref) => sl<LoginUseCase>());
final registerUseCaseProvider = Provider<RegisterUseCase>((Ref ref) => sl<RegisterUseCase>());
final logoutUseCaseProvider = Provider<LogoutUseCase>((Ref ref) => sl<LogoutUseCase>());
final getCurrentUserUseCaseProvider =
    Provider<GetCurrentUserUseCase>((Ref ref) => sl<GetCurrentUserUseCase>());
final signInWithGoogleUseCaseProvider =
    Provider<SignInWithGoogleUseCase>((Ref ref) => sl<SignInWithGoogleUseCase>());
final signInWithAppleUseCaseProvider =
    Provider<SignInWithAppleUseCase>((Ref ref) => sl<SignInWithAppleUseCase>());
final sendPasswordResetUseCaseProvider =
    Provider<SendPasswordResetUseCase>((Ref ref) => sl<SendPasswordResetUseCase>());
final sendEmailVerificationUseCaseProvider =
    Provider<SendEmailVerificationUseCase>((Ref ref) => sl<SendEmailVerificationUseCase>());
final reloadUserUseCaseProvider =
    Provider<ReloadUserUseCase>((Ref ref) => sl<ReloadUserUseCase>());
final updateProfileUseCaseProvider =
    Provider<UpdateProfileUseCase>((Ref ref) => sl<UpdateProfileUseCase>());

/// Fuente única de verdad del estado de sesión en toda la app. `GoRouter`
/// (ver `app_router.dart`) observa este provider para decidir a qué
/// pantalla redirigir. `AsyncValue` cubre automáticamente los 3 estados
/// (cargando / con datos / con error) sin necesidad de un enum manual.
final authStateProvider = StreamProvider<UserEntity?>((Ref ref) {
  final AuthRepository repository = ref.watch(authRepositoryProvider);
  return repository.authStateChanges;
});
