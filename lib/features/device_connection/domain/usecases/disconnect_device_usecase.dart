import 'package:dartz/dartz.dart';
import 'package:equatable/equatable.dart';

import '../../../../core/error/failures.dart';
import '../../../../core/usecase/usecase.dart';
import '../repositories/device_repository.dart';

class DisconnectDeviceUseCase implements UseCase<void, DisconnectDeviceParams> {
  DisconnectDeviceUseCase(this._repository);

  final DeviceRepository _repository;

  @override
  Future<Either<Failure, void>> call(DisconnectDeviceParams params) {
    return _repository.disconnect(params.deviceId);
  }
}

class DisconnectDeviceParams extends Equatable {
  const DisconnectDeviceParams({required this.deviceId});

  final String deviceId;

  @override
  List<Object?> get props => [deviceId];
}
