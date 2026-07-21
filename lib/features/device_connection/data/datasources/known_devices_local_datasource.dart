import 'package:shared_preferences/shared_preferences.dart';

/// Guarda qué dispositivos el usuario ha emparejado alguna vez, para que
/// `DeviceRepositoryImpl` pueda intentar reconectarse automáticamente a
/// ellos en cuanto la app arranca y detecta que están al alcance — sin
/// esto, el usuario tendría que re-escanear y reconectar manualmente cada
/// vez que abre la app, incluso a su propio rodillo de siempre.
abstract class KnownDevicesLocalDataSource {
  Future<List<String>> getKnownDeviceIds();
  Future<void> addKnownDevice(String deviceId);
  Future<void> removeKnownDevice(String deviceId);
}

class KnownDevicesLocalDataSourceImpl implements KnownDevicesLocalDataSource {
  KnownDevicesLocalDataSourceImpl(this._prefs);

  final SharedPreferences _prefs;

  static const String _key = 'known_ble_device_ids';

  @override
  Future<List<String>> getKnownDeviceIds() async {
    return _prefs.getStringList(_key) ?? <String>[];
  }

  @override
  Future<void> addKnownDevice(String deviceId) async {
    final List<String> current = await getKnownDeviceIds();
    if (!current.contains(deviceId)) {
      await _prefs.setStringList(_key, <String>[...current, deviceId]);
    }
  }

  @override
  Future<void> removeKnownDevice(String deviceId) async {
    final List<String> current = await getKnownDeviceIds();
    current.remove(deviceId);
    await _prefs.setStringList(_key, current);
  }
}
