import 'package:dartz/dartz.dart';
import 'package:equatable/equatable.dart';

import '../../../../core/error/failures.dart';
import '../../../../core/usecase/usecase.dart';
import '../repositories/device_repository.dart';

class ForgetDeviceUseCase implements UseCase<void, ForgetDeviceParams> {
  ForgetDeviceUseCase(this._repository);

  final DeviceRepository _repository;

  @override
  Future<Either<Failure, void>> call(ForgetDeviceParams params) {
    return _repository.forgetDevice(params.deviceId);
  }
}

class ForgetDeviceParams extends Equatable {
  const ForgetDeviceParams({required this.deviceId});

  final String deviceId;

  @override
  List<Object?> get props => [deviceId];
}
