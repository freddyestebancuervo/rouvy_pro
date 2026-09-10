import '../models/ble_device_model.dart';
import 'ble_device_evidence_merger.dart';

class BleScanResultCollector {
  final Map<String, BleDeviceModel> _found = <String, BleDeviceModel>{};

  List<BleDeviceModel> addAll(Iterable<BleDeviceModel> scanResults) {
    for (final BleDeviceModel result in scanResults) {
      final BleDeviceModel? current = _found[result.id];
      _found[result.id] = mergeScanWithSessionEvidence(
        scan: result,
        sessionEvidence: current,
      );
    }
    return _found.values.toList(growable: false);
  }
}
