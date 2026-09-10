import '../../domain/entities/ble_device_compatibility_status.dart';
import '../models/ble_device_model.dart';

class BleScanResultCollector {
  final Map<String, BleDeviceModel> _found = <String, BleDeviceModel>{};

  List<BleDeviceModel> addAll(Iterable<BleDeviceModel> scanResults) {
    for (final BleDeviceModel result in scanResults) {
      final BleDeviceModel? current = _found[result.id];
      _found[result.id] = result.copyWithModel(
        compatibilityStatus: _strongerCompatibility(
          current?.compatibilityStatus,
          result.compatibilityStatus,
        ),
      );
    }
    return _found.values.toList(growable: false);
  }

  BleDeviceCompatibilityStatus _strongerCompatibility(
    BleDeviceCompatibilityStatus? current,
    BleDeviceCompatibilityStatus next,
  ) {
    if (current == null) return next;
    if (_rank(current) >= _rank(next)) return current;
    return next;
  }

  int _rank(BleDeviceCompatibilityStatus status) {
    return switch (status) {
      BleDeviceCompatibilityStatus.discovered => 0,
      BleDeviceCompatibilityStatus.unsupported => 1,
      BleDeviceCompatibilityStatus.standardCompatible => 2,
      BleDeviceCompatibilityStatus.korixaCompatible => 3,
      BleDeviceCompatibilityStatus.korixaVerified => 4,
    };
  }
}
