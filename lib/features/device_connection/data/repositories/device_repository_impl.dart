import 'package:dartz/dartz.dart';

import '../../../../core/error/error_handler.dart';
import '../../../../core/error/failures.dart';
import '../../domain/entities/ble_device.dart';
import '../../domain/entities/telemetry_snapshot.dart';
import '../../domain/repositories/device_repository.dart';
import '../datasources/ble_datasource.dart';

class DeviceRepositoryImpl implements DeviceRepository {
  DeviceRepositoryImpl({required BleDataSource dataSource}) : _dataSource = dataSource;

  final BleDataSource _dataSource;

  @override
  Stream<List<BleDevice>> scanForDevices() => _dataSource.scanForDevices();

  @override
  Future<Either<Failure, void>> stopScan() => _tryCatch(_dataSource.stopScan);

  @override
  Future<Either<Failure, void>> connect(String deviceId) {
    return _tryCatch(() => _dataSource.connect(deviceId));
  }

  @override
  Future<Either<Failure, void>> disconnect(String deviceId) {
    return _tryCatch(() => _dataSource.disconnect(deviceId));
  }

  @override
  Future<Either<Failure, void>> forgetDevice(String deviceId) {
    return _tryCatch(() => _dataSource.forgetDevice(deviceId));
  }

  @override
  Stream<List<BleDevice>> get connectedDevicesStream => _dataSource.connectedDevicesStream;

  @override
  Stream<TelemetrySnapshot> telemetryStreamFor(String deviceId) {
    return _dataSource.telemetryStreamFor(deviceId);
  }

  @override
  Future<Either<Failure, bool>> hasBlePermissions() => _tryCatch(_dataSource.hasBlePermissions);

  @override
  Future<Either<Failure, bool>> requestBlePermissions() {
    return _tryCatch(_dataSource.requestBlePermissions);
  }

  @override
  Stream<bool> get isBluetoothEnabled => _dataSource.isBluetoothEnabled;

  Future<Either<Failure, T>> _tryCatch<T>(Future<T> Function() action) async {
    try {
      return Right(await action());
    } catch (e) {
      return Left(AppErrorHandler.handle(e));
    }
  }
}
