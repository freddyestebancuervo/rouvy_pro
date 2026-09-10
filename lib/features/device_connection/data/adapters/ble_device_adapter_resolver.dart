import 'ble_device_adapter.dart';
import 'standard_ble_device_adapters.dart';

typedef BleDeviceAdapterFactory = BleDeviceAdapter Function();

class BleDeviceAdapterRegistration {
  const BleDeviceAdapterRegistration({
    required this.priority,
    required this.create,
  });

  final int priority;
  final BleDeviceAdapterFactory create;
}

class BleDeviceAdapterResolver {
  const BleDeviceAdapterResolver(this._registrations);

  final List<BleDeviceAdapterRegistration> _registrations;

  List<BleDeviceAdapter> resolve(List<BleDeviceCapability> capabilities) {
    final List<BleDeviceCapability> normalized = capabilities
        .map(
          (BleDeviceCapability capability) => BleDeviceCapability(
            serviceUuid: capability.serviceUuid.toLowerCase(),
            characteristicUuids: capability.characteristicUuids
                .map((String uuid) => uuid.toLowerCase())
                .toSet(),
          ),
        )
        .toList(growable: false);

    final List<BleDeviceAdapterRegistration> ordered =
        <BleDeviceAdapterRegistration>[..._registrations]..sort(
          (BleDeviceAdapterRegistration a, BleDeviceAdapterRegistration b) =>
              a.priority.compareTo(b.priority),
        );

    final List<BleDeviceAdapter> adapters = <BleDeviceAdapter>[];
    for (final BleDeviceAdapterRegistration registration in ordered) {
      final BleDeviceAdapter adapter = registration.create();
      if (normalized.any(adapter.supports)) {
        adapters.add(adapter);
      }
    }
    return adapters;
  }
}

class StandardBleDeviceAdapterResolver extends BleDeviceAdapterResolver {
  const StandardBleDeviceAdapterResolver()
    : super(const <BleDeviceAdapterRegistration>[
        BleDeviceAdapterRegistration(priority: 10, create: _createFtms),
        BleDeviceAdapterRegistration(priority: 20, create: _createCyclingPower),
        BleDeviceAdapterRegistration(priority: 30, create: _createCsc),
        BleDeviceAdapterRegistration(priority: 40, create: _createHeartRate),
      ]);
}

BleDeviceAdapter _createFtms() => const FtmsBleDeviceAdapter();
BleDeviceAdapter _createCyclingPower() => CyclingPowerBleDeviceAdapter();
BleDeviceAdapter _createCsc() => CscBleDeviceAdapter();
BleDeviceAdapter _createHeartRate() => const HeartRateBleDeviceAdapter();
