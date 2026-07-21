import 'package:dartz/dartz.dart';

import '../../../../core/error/error_handler.dart';
import '../../../../core/error/failures.dart';
import '../../../../core/network/network_info.dart';
import '../../domain/entities/user_entity.dart';
import '../../domain/repositories/auth_repository.dart';
import '../datasources/auth_remote_datasource.dart';

/// Implementación concreta del contrato `AuthRepository`. Es la única
/// pieza que conoce tanto `domain` (implementa su interfaz) como `data`
/// (usa el datasource) — por eso vive en la capa `data`.
///
/// Patrón repetido en cada método: 1) comprobar red si aplica, 2) delegar
/// al datasource dentro de un `try/catch`, 3) traducir cualquier excepción
/// con `AppErrorHandler.handle`. Mantenerlo así (en vez de un wrapper
/// genérico) hace explícito, método por método, qué puede fallar.
class AuthRepositoryImpl implements AuthRepository {
  AuthRepositoryImpl({
    required AuthRemoteDataSource remoteDataSource,
    required NetworkInfo networkInfo,
  })  : _remoteDataSource = remoteDataSource,
        _networkInfo = networkInfo;

  final AuthRemoteDataSource _remoteDataSource;
  final NetworkInfo _networkInfo;

  Future<Either<Failure, T>> _guard<T>(Future<T> Function() action) async {
    if (!await _networkInfo.isConnected) {
      return const Left(NetworkFailure());
    }
    try {
      return Right(await action());
    } catch (e) {
      return Left(AppErrorHandler.handle(e));
    }
  }

  @override
  Future<Either<Failure, UserEntity>> login({
    required String email,
    required String password,
  }) {
    return _guard(() => _remoteDataSource.login(email: email, password: password));
  }

  @override
  Future<Either<Failure, UserEntity>> register({
    required String email,
    required String password,
    required String displayName,
  }) {
    return _guard(
      () => _remoteDataSource.register(email: email, password: password, displayName: displayName),
    );
  }

  @override
  Future<Either<Failure, UserEntity>> signInWithGoogle() {
    return _guard(_remoteDataSource.signInWithGoogle);
  }

  @override
  Future<Either<Failure, UserEntity>> signInWithApple() {
    return _guard(_remoteDataSource.signInWithApple);
  }

  @override
  Future<Either<Failure, void>> logout() {
    // Cerrar sesión no depende de tener red (debe poder hacerse offline),
    // así que no pasa por `_guard` (que exige conectividad).
    return _tryCatch(_remoteDataSource.logout);
  }

  @override
  Future<Either<Failure, UserEntity?>> getCurrentUser() {
    return _tryCatch(_remoteDataSource.getCurrentUser);
  }

  @override
  Stream<UserEntity?> get authStateChanges => _remoteDataSource.authStateChanges;

  @override
  Future<Either<Failure, void>> sendPasswordResetEmail(String email) {
    return _guard(() => _remoteDataSource.sendPasswordResetEmail(email));
  }

  @override
  Future<Either<Failure, void>> sendEmailVerification() {
    return _guard(_remoteDataSource.sendEmailVerification);
  }

  @override
  Future<Either<Failure, UserEntity?>> reloadCurrentUser() {
    return _guard(_remoteDataSource.reloadCurrentUser);
  }

  @override
  Future<Either<Failure, UserEntity>> updateProfile({
    String? displayName,
    String? photoUrl,
    int? ftp,
    double? weightKg,
  }) {
    return _guard(
      () => _remoteDataSource.updateProfile(
        displayName: displayName,
        photoUrl: photoUrl,
        ftp: ftp,
        weightKg: weightKg,
      ),
    );
  }

  Future<Either<Failure, T>> _tryCatch<T>(Future<T> Function() action) async {
    try {
      return Right(await action());
    } catch (e) {
      return Left(AppErrorHandler.handle(e));
    }
  }
}
