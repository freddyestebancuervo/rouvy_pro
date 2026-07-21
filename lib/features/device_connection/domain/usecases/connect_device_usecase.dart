import 'package:dartz/dartz.dart';
import 'package:equatable/equatable.dart';

import '../../../../core/error/failures.dart';
import '../../../../core/usecase/usecase.dart';
import '../repositories/device_repository.dart';

class ConnectDeviceUseCase implements UseCase<void, ConnectDeviceParams> {
  ConnectDeviceUseCase(this._repository);

  final DeviceRepository _repository;

  @override
  Future<Either<Failure, void>> call(ConnectDeviceParams params) {
    return _repository.connect(params.deviceId);
  }
}

class ConnectDeviceParams extends Equatable {
  const ConnectDeviceParams({required this.deviceId});

  final String deviceId;

  @override
  List<Object?> get props => [deviceId];
}
