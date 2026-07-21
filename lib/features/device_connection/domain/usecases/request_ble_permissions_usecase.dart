import 'package:dartz/dartz.dart';

import '../../../../core/error/failures.dart';
import '../../../../core/usecase/usecase.dart';
import '../repositories/device_repository.dart';

class RequestBlePermissionsUseCase implements UseCase<bool, NoParams> {
  RequestBlePermissionsUseCase(this._repository);

  final DeviceRepository _repository;

  @override
  Future<Either<Failure, bool>> call(NoParams params) => _repository.requestBlePermissions();
}
