import 'package:dartz/dartz.dart';

import '../../../../core/error/failures.dart';
import '../entities/user_entity.dart';

/// Puerto (interfaz) que el dominio define y la capa `data` implementa.
///
/// Por qué es una interfaz abstracta aquí: el dominio NUNCA debe importar
/// nada de `data` ni de paquetes de infraestructura (Firebase, Dio). Esto
/// es lo que permite testear los `usecases` con un mock de este contrato,
/// sin tocar Firebase real.
///
/// **Contrato de API objetivo (tarea C1, `ROADMAP_M0_M1.md`):** hoy
/// `AuthRepositoryImpl` habla con Firebase Auth directamente (ver
/// `docs/TECHNICAL_SPECIFICATION_M0_M1.md` sección 0, "capa actual"). El
/// backend NestJS objetivo (sección 1.2 del mismo documento) define el
/// contrato REST exacto — endpoints, request/response, códigos de error —
/// que un futuro `AuthRemoteDataSourceNestImpl` debería implementar
/// método a método contra esta misma interfaz, SIN que `AuthRepository`
/// ni ningún `usecase` que la consume necesite cambiar:
///
/// | Método de esta interfaz | Endpoint REST objetivo |
/// |---|---|
/// | [login] | `POST /auth/login` |
/// | [register] | `POST /auth/register` |
/// | [signInWithGoogle] | `POST /auth/social/google` |
/// | [signInWithApple] | `POST /auth/social/apple` |
/// | [logout] | `POST /auth/logout` |
/// | [sendPasswordResetEmail] | `POST /auth/password-reset/request` |
/// | [sendEmailVerification] | (sin equivalente REST directo — Firebase lo gestiona vía SDK; el backend objetivo lo resolvería como parte de `register`) |
/// | [updateProfile] | `PATCH /users/me` |
///
/// Migrar de Firebase a este backend es, por diseño de Clean
/// Architecture, un cambio de `data/datasources/` — el dominio y la
/// presentación no deberían necesitar tocarse.
abstract class AuthRepository {
  // --- Registro / login con correo y contraseña ---
  Future<Either<Failure, UserEntity>> login({
    required String email,
    required String password,
  });

  Future<Either<Failure, UserEntity>> register({
    required String email,
    required String password,
    required String displayName,
  });

  // --- Login social ---
  Future<Either<Failure, UserEntity>> signInWithGoogle();

  /// Solo tiene efecto real en iOS/macOS; en Android se puede ofrecer si el
  /// proyecto lo requiere, pero Apple exige que si se ofrece login social
  /// en iOS, "Sign in with Apple" esté disponible como opción.
  Future<Either<Failure, UserEntity>> signInWithApple();

  // --- Sesión ---
  Future<Either<Failure, void>> logout();

  Future<Either<Failure, UserEntity?>> getCurrentUser();

  /// Stream del usuario autenticado — emite `null` al cerrar sesión.
  /// Lo consume `authStateProvider` para reaccionar a cambios de sesión
  /// (incluyendo expiración de token) en toda la app.
  Stream<UserEntity?> get authStateChanges;

  // --- Recuperación de contraseña ---
  Future<Either<Failure, void>> sendPasswordResetEmail(String email);

  // --- Verificación de correo ---
  Future<Either<Failure, void>> sendEmailVerification();

  /// Vuelve a consultar el estado del usuario contra Firebase (Firebase
  /// cachea `emailVerified` en el cliente; hay que forzar un `reload()`
  /// para detectar que el usuario ya confirmó el enlace del correo).
  Future<Either<Failure, UserEntity?>> reloadCurrentUser();

  // --- Perfil ---
  Future<Either<Failure, UserEntity>> updateProfile({
    String? displayName,
    String? photoUrl,
    int? ftp,
    double? weightKg,
  });
}
