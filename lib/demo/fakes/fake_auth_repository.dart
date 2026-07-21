import 'dart:async';

import 'package:dartz/dartz.dart';

import '../../features/auth/domain/entities/user_entity.dart';
import '../../features/auth/domain/repositories/auth_repository.dart';
import '../../core/error/failures.dart';
import '../fixtures/demo_user_fixture.dart';

/// Implementación de `AuthRepository` para el modo demo — vive
/// enteramente en memoria, con latencias artificiales para que los
/// estados de carga de la UI (spinners) se vean realistas, igual que
/// haría una llamada de red real. **Nunca** importa `firebase_auth` ni
/// `cloud_firestore`.
///
/// Reemplazo por la implementación real: ver `docs/DEMO_MODE.md` sección
/// "Cómo volver a producción" — se trata de dejar de registrar esta
/// clase en `demo_overrides.dart` y usar la app normal (`main.dart`), que
/// ya registra `AuthRepositoryImpl` (Firebase) sin ningún cambio
/// adicional en el resto del código.
class FakeAuthRepository implements AuthRepository {
  UserEntity? _currentUser;
  final StreamController<UserEntity?> _authStateController = StreamController<UserEntity?>.broadcast();

  Future<void> _simulateLatency([int ms = 500]) => Future<void>.delayed(Duration(milliseconds: ms));

  @override
  Future<Either<Failure, UserEntity>> login({required String email, required String password}) async {
    await _simulateLatency();
    // En modo demo, cualquier combinación de credenciales "funciona" —
    // no hay una base de usuarios real contra la que validar.
    _currentUser = demoUserFixture.copyWith();
    _authStateController.add(_currentUser);
    return Right(_currentUser!);
  }

  @override
  Future<Either<Failure, UserEntity>> register({
    required String email,
    required String password,
    required String displayName,
  }) async {
    await _simulateLatency();
    _currentUser = UserEntity(
      id: demoUserFixture.id,
      email: email,
      displayName: displayName,
      ftp: demoUserFixture.ftp,
      weightKg: demoUserFixture.weightKg,
      premium: demoUserFixture.premium,
      role: demoUserFixture.role,
      // A diferencia de producción, en demo el correo queda verificado de
      // inmediato — no tiene sentido simular el flujo de verificación por
      // correo real (no hay ningún correo que enviar).
      emailVerified: true,
      providerType: AuthProviderType.password,
    );
    _authStateController.add(_currentUser);
    return Right(_currentUser!);
  }

  @override
  Future<Either<Failure, UserEntity>> signInWithGoogle() async {
    await _simulateLatency(700);
    _currentUser = demoUserFixture.copyWith();
    _authStateController.add(_currentUser);
    return Right(_currentUser!);
  }

  @override
  Future<Either<Failure, UserEntity>> signInWithApple() async {
    await _simulateLatency(700);
    _currentUser = demoUserFixture.copyWith();
    _authStateController.add(_currentUser);
    return Right(_currentUser!);
  }

  @override
  Future<Either<Failure, void>> logout() async {
    await _simulateLatency(200);
    _currentUser = null;
    _authStateController.add(null);
    return const Right(null);
  }

  @override
  Future<Either<Failure, UserEntity?>> getCurrentUser() async => Right(_currentUser);

  @override
  Stream<UserEntity?> get authStateChanges {
    // `Stream.multi` para que un nuevo suscriptor reciba el estado ACTUAL
    // de inmediato — igual que hace `FirebaseAuth.authStateChanges()` en
    // producción (siempre emite el usuario actual, o `null`, apenas
    // alguien se suscribe, no solo en cambios futuros). Sin esto, el
    // router quedaría esperando indefinidamente en la pantalla de splash
    // (`authStateProvider` nunca sale de `AsyncLoading`) hasta el primer
    // login/logout — un comportamiento distinto al de Firebase real que
    // rompería el flujo de navegación de la demo desde el arranque.
    return Stream<UserEntity?>.multi((StreamController<UserEntity?> multiController) {
      multiController.add(_currentUser);
      final StreamSubscription<UserEntity?> sub = _authStateController.stream.listen(multiController.add);
      multiController.onCancel = sub.cancel;
    });
  }

  @override
  Future<Either<Failure, void>> sendPasswordResetEmail(String email) async {
    await _simulateLatency();
    return const Right(null);
  }

  @override
  Future<Either<Failure, void>> sendEmailVerification() async {
    await _simulateLatency(300);
    return const Right(null);
  }

  @override
  Future<Either<Failure, UserEntity?>> reloadCurrentUser() async => Right(_currentUser);

  @override
  Future<Either<Failure, UserEntity>> updateProfile({
    String? displayName,
    String? photoUrl,
    int? ftp,
    double? weightKg,
  }) async {
    await _simulateLatency(400);
    if (_currentUser == null) {
      return const Left(ServerFailure('No hay una sesión activa.'));
    }
    _currentUser = _currentUser!.copyWith(
      displayName: displayName,
      photoUrl: photoUrl,
      ftp: ftp,
      weightKg: weightKg,
    );
    _authStateController.add(_currentUser);
    return Right(_currentUser!);
  }
}
