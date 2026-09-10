import '../../domain/entities/ble_device_compatibility_status.dart';
import '../models/ble_device_model.dart';

/// Pure evidence merge seam used by production scan path.
///
/// A fresh advertising result is always `discovered` and must never
/// downgrade stronger compatibility/type evidence already proven for the
/// same device id during the current process (e.g. post-GATT
/// `standardCompatible` or `unsupported` stored in
/// `BleDataSourceImpl._sessions`).
///
/// Rules:
/// - no session evidence -> return [scan] unchanged (fresh `discovered`);
/// - session evidence strictly stronger than scan -> preserve session
///   `compatibilityStatus` + `type`, while keeping fresh transient scan
///   metadata (`name`/`rssi`) from [scan];
/// - otherwise -> return [scan] (latest wins, including equal rank).
///
/// Phase B never generates `korixaCompatible`/`korixaVerified`, but this
/// generic preservation keeps them if a legitimate future source already
/// proved them, without assigning them from advertising.
BleDeviceModel mergeScanWithSessionEvidence({
  required BleDeviceModel scan,
  BleDeviceModel? sessionEvidence,
}) {
  if (sessionEvidence == null) return scan;
  if (compatibilityRank(sessionEvidence.compatibilityStatus) >
      compatibilityRank(scan.compatibilityStatus)) {
    return scan.copyWithModel(
      compatibilityStatus: sessionEvidence.compatibilityStatus,
      type: sessionEvidence.type,
    );
  }
  return scan;
}

int compatibilityRank(BleDeviceCompatibilityStatus status) {
  return switch (status) {
    BleDeviceCompatibilityStatus.discovered => 0,
    BleDeviceCompatibilityStatus.unsupported => 1,
    BleDeviceCompatibilityStatus.standardCompatible => 2,
    BleDeviceCompatibilityStatus.korixaCompatible => 3,
    BleDeviceCompatibilityStatus.korixaVerified => 4,
  };
}
