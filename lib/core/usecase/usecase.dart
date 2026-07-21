import 'package:dartz/dartz.dart';
import 'package:equatable/equatable.dart';

import '../error/failures.dart';

/// Contrato base para todos los casos de uso del dominio.
///
/// [Type] es el tipo de retorno exitoso, [Params] son los parámetros de
/// entrada. Cada caso de uso hace **una sola cosa** (Single Responsibility) —
/// p. ej. `LoginUseCase`, `LogoutUseCase`, nunca un `AuthUseCase` genérico.
abstract class UseCase<Type, Params> {
  Future<Either<Failure, Type>> call(Params params);
}

/// Usar cuando un caso de uso no requiere parámetros (p. ej. `LogoutUseCase`,
/// `GetCurrentUserUseCase`), evita tener que pasar `null` explícitamente.
class NoParams extends Equatable {
  const NoParams();

  @override
  List<Object?> get props => [];
}
