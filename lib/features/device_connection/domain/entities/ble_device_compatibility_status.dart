/// Evidence-based Korixa support classification for a BLE device.
///
/// This is separate from [SportDeviceType]: type is a functional hint, while
/// compatibility records what level of support has actually been proven.
enum BleDeviceCompatibilityStatus {
  /// The device was observed, but no GATT capability evidence has been
  /// evaluated yet. This is the safe default after scan and after process
  /// restore.
  discovered,

  /// GATT service discovery proved that at least one currently implemented
  /// standard BLE protocol adapter can parse this device.
  standardCompatible,

  /// Reserved for a future implemented Korixa/vendor protocol-family adapter.
  /// Phase B does not assign this status.
  korixaCompatible,

  /// Reserved for devices/protocol profiles with explicit physical validation
  /// evidence. Phase B does not assign this status.
  korixaVerified,

  /// GATT service discovery completed and no adapter in this Korixa build
  /// matched the discovered capabilities. This does not mean permanently
  /// incompatible hardware.
  unsupported,
}
