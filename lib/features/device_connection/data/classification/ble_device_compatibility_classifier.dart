import '../../domain/entities/ble_device_compatibility_status.dart';
import '../../domain/entities/sport_device_type.dart';
import '../../domain/entities/telemetry_source.dart';
import '../adapters/ble_device_adapter.dart';
import '../adapters/ble_device_adapter_resolver.dart';

class BleDeviceGattClassification {
  const BleDeviceGattClassification({required this.status, required this.type});

  final BleDeviceCompatibilityStatus status;
  final SportDeviceType type;
}

class BleDeviceCompatibilityClassifier {
  const BleDeviceCompatibilityClassifier({
    required BleDeviceAdapterResolver resolver,
  }) : _resolver = resolver;

  final BleDeviceAdapterResolver _resolver;

  BleDeviceGattClassification classify(List<BleDeviceCapability> capabilities) {
    final List<BleDeviceAdapter> adapters = _resolver.resolve(capabilities);
    if (adapters.isEmpty) {
      return const BleDeviceGattClassification(
        status: BleDeviceCompatibilityStatus.unsupported,
        type: SportDeviceType.unknown,
      );
    }

    return BleDeviceGattClassification(
      status: BleDeviceCompatibilityStatus.standardCompatible,
      type: _typeFromAdapters(adapters),
    );
  }

  SportDeviceType _typeFromAdapters(List<BleDeviceAdapter> adapters) {
    final Set<TelemetrySourceKind> sources =
        adapters.map((BleDeviceAdapter adapter) => adapter.source).toSet();

    if (sources.contains(TelemetrySourceKind.ftms)) {
      return SportDeviceType.smartTrainer;
    }
    if (sources.contains(TelemetrySourceKind.cyclingPower)) {
      return SportDeviceType.powerMeter;
    }
    if (sources.contains(TelemetrySourceKind.csc)) {
      return SportDeviceType.speedCadenceCombo;
    }
    if (sources.contains(TelemetrySourceKind.heartRate)) {
      return SportDeviceType.heartRateMonitor;
    }
    return SportDeviceType.unknown;
  }
}
