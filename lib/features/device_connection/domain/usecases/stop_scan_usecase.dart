import 'package:dartz/dartz.dart';

import '../../../../core/error/failures.dart';
import '../../../../core/usecase/usecase.dart';
import '../repositories/device_repository.dart';

class StopScanUseCase implements UseCase<void, NoParams> {
  StopScanUseCase(this._repository);

  final DeviceRepository _repository;

  @override
  Future<Either<Failure, void>> call(NoParams params) => _repository.stopScan();
}
