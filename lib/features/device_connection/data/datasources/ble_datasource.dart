import 'dart:async';
import 'dart:typed_data';

import 'package:flutter_blue_plus/flutter_blue_plus.dart';

import '../../../../core/ble/ble_permission_handler.dart';
import '../../../../core/ble/ble_uuids.dart';
import '../../../../core/error/exceptions.dart';
import '../../domain/entities/device_connection_status.dart';
import '../../domain/entities/sport_device_type.dart';
import '../../domain/entities/telemetry_snapshot.dart';
import 'known_devices_local_datasource.dart';
import '../models/ble_device_model.dart';
import '../parsers/battery_level_parser.dart';
import '../parsers/csc_parser.dart';
import '../parsers/cycling_power_parser.dart';
import '../parsers/ftms_parser.dart';
import '../parsers/heart_rate_parser.dart';

/// Estado interno que el datasource mantiene por cada dispositivo con el
/// que ha interactuado (visto en escaneo, conectado, o conocido de una
/// sesión anterior). No se expone fuera de este archivo — `data/repositories`
/// solo ve los streams públicos.
class _DeviceSession {
  _DeviceSession({required this.model});

  BleDeviceModel model;
  BluetoothDevice? bluetoothDevice;
  final List<StreamSubscription<dynamic>> subscriptions = <StreamSubscription<dynamic>>[];
  final StreamController<TelemetrySnapshot> telemetryController =
      StreamController<TelemetrySnapshot>.broadcast();

  // Parsers con estado — una instancia por dispositivo, no globales,
  // porque cada uno lleva su propio histórico de contadores acumulados.
  final CyclingPowerParser cyclingPowerParser = CyclingPowerParser();
  final CscParser cscParser = CscParser();

  int reconnectAttempts = 0;
  Timer? reconnectTimer;

  /// Marca de tiempo de la PRIMERA caída de señal de un ciclo de
  /// reconexión — se resetea a `null` en cuanto la conexión se restablece
  /// con éxito. Junto a [BleDataSourceImpl._maxTotalReconnectDuration],
  /// implementa la tarea B2 del roadmap: un límite de tiempo total, no
  /// solo de número de intentos — con backoff de hasta 30s por intento,
  /// `_maxReconnectAttempts` (6) por sí solo podría tardar varios minutos
  /// en agotarse, drenando batería en segundo plano sin que el usuario se
  /// entere de que la reconexión lleva mucho tiempo fallando.
  DateTime? firstDisconnectAt;

  void disposeSubscriptions() {
    for (final StreamSubscription<dynamic> sub in subscriptions) {
      sub.cancel();
    }
    subscriptions.clear();
  }
}

abstract class BleDataSource {
  Stream<List<BleDeviceModel>> scanForDevices();
  Future<void> stopScan();
  Future<void> connect(String deviceId);
  Future<void> disconnect(String deviceId);
  Future<void> forgetDevice(String deviceId);
  Stream<List<BleDeviceModel>> get connectedDevicesStream;
  Stream<TelemetrySnapshot> telemetryStreamFor(String deviceId);
  Future<bool> hasBlePermissions();
  Future<bool> requestBlePermissions();
  Stream<bool> get isBluetoothEnabled;

  /// Se llama una vez al arrancar la app (desde el repositorio, durante
  /// `initDependencyInjection` o el primer acceso a la pantalla de
  /// dispositivos) para intentar reconectar automáticamente a todo lo que
  /// el usuario tenía emparejado en la sesión anterior.
  Future<void> restoreKnownDevices();
}

class BleDataSourceImpl implements BleDataSource {
  BleDataSourceImpl({
    required KnownDevicesLocalDataSource knownDevicesLocalDataSource,
    required BlePermissionHandler permissionHandler,
  })  : _knownDevicesLocalDataSource = knownDevicesLocalDataSource,
        _permissionHandler = permissionHandler;

  final KnownDevicesLocalDataSource _knownDevicesLocalDataSource;
  final BlePermissionHandler _permissionHandler;

  /// Única fuente de verdad de todos los dispositivos con los que la app
  /// ha interactuado en esta sesión de proceso — tanto los vistos en
  /// escaneo como los conectados. Se expone combinado a través de
  /// [connectedDevicesStream].
  final Map<String, _DeviceSession> _sessions = <String, _DeviceSession>{};

  final StreamController<List<BleDeviceModel>> _connectedDevicesController =
      StreamController<List<BleDeviceModel>>.broadcast();

  static const Duration _scanTimeout = Duration(seconds: 15);
  static const int _maxReconnectAttempts = 6;

  /// Tarea B2 del roadmap: además del límite de INTENTOS, un límite de
  /// TIEMPO TOTAL desde la primera caída de señal. 10 minutos es
  /// suficiente para cubrir una pérdida de señal transitoria real (el
  /// usuario se aleja un momento del rodillo, interferencia puntual) sin
  /// dejar el reintento corriendo indefinidamente en segundo plano.
  static const Duration _maxTotalReconnectDuration = Duration(minutes: 10);

  // -------------------------------------------------------------------
  // Escaneo
  // -------------------------------------------------------------------

  @override
  Stream<List<BleDeviceModel>> scanForDevices() {
    final StreamController<List<BleDeviceModel>> controller =
        StreamController<List<BleDeviceModel>>.broadcast();
    final Map<String, BleDeviceModel> found = <String, BleDeviceModel>{};

    late final StreamSubscription<List<ScanResult>> resultsSub;
    resultsSub = FlutterBluePlus.scanResults.listen(
      (List<ScanResult> results) {
        for (final ScanResult result in results) {
          final BleDeviceModel model = BleDeviceModel.fromScanResult(result);
          // Se descartan dispositivos sin ningún servicio deportivo
          // reconocido — el filtro de UUIDs en `startScan` ya debería
          // encargarse de esto, pero se revalida aquí por si el sistema
          // operativo devuelve advertising adicional sin filtrar (ocurre
          // en algunas versiones de Android con el filtro por hardware).
          if (model.type == SportDeviceType.unknown) continue;
          found[model.id] = model;
        }
        controller.add(found.values.toList(growable: false));
      },
      onError: controller.addError,
    );

    FlutterBluePlus.startScan(
      withServices: BleUuids.scannableServices.map(Guid.new).toList(),
      timeout: _scanTimeout,
    );

    controller.onCancel = () {
      resultsSub.cancel();
      FlutterBluePlus.stopScan();
    };

    return controller.stream;
  }

  @override
  Future<void> stopScan() => FlutterBluePlus.stopScan();

  // -------------------------------------------------------------------
  // Conexión
  // -------------------------------------------------------------------

  @override
  Future<void> connect(String deviceId) async {
    final _DeviceSession session = _sessionFor(deviceId);
    _updateStatus(deviceId, DeviceConnectionStatus.connecting);

    final BluetoothDevice device = session.bluetoothDevice ?? BluetoothDevice.fromId(deviceId);
    session.bluetoothDevice = device;

    try {
      await device.connect(timeout: const Duration(seconds: 10), autoConnect: false);
    } catch (e) {
      _updateStatus(deviceId, DeviceConnectionStatus.connectionFailed);
      throw const ServerException('No se pudo conectar con el dispositivo.');
    }

    // Escucha el estado de conexión para detectar caídas inesperadas y
    // disparar la reconexión automática — se registra ANTES de terminar
    // el resto del setup para no perder el primer evento.
    final StreamSubscription<BluetoothConnectionState> connectionSub =
        device.connectionState.listen((BluetoothConnectionState state) {
      if (state == BluetoothConnectionState.disconnected) {
        _handleUnexpectedDisconnect(deviceId);
      }
    });
    session.subscriptions.add(connectionSub);

    await _discoverAndSubscribe(deviceId, device, session);

    session.reconnectAttempts = 0; // conexión exitosa: resetea el backoff
    session.firstDisconnectAt = null; // y el reloj del límite total (B2)
    _updateStatus(deviceId, DeviceConnectionStatus.connected);
    await _knownDevicesLocalDataSource.addKnownDevice(deviceId);

    // Refresco periódico de RSSI mientras esté conectado — alimenta el
    // indicador de calidad de señal en la pantalla de gestión.
    Timer.periodic(const Duration(seconds: 4), (Timer timer) async {
      final _DeviceSession? current = _sessions[deviceId];
      if (current == null || current.model.status != DeviceConnectionStatus.connected) {
        timer.cancel();
        return;
      }
      try {
        final int rssi = await device.readRssi();
        _updateModel(deviceId, (BleDeviceModel m) => m.copyWithModel(rssi: rssi));
      } catch (_) {
        // Lectura de RSSI falló puntualmente — no es motivo de desconexión.
      }
    });
  }

  Future<void> _discoverAndSubscribe(
    String deviceId,
    BluetoothDevice device,
    _DeviceSession session,
  ) async {
    final List<BluetoothService> services = await device.discoverServices();

    for (final BluetoothService service in services) {
      final String serviceUuid = service.uuid.str.toLowerCase();

      if (serviceUuid == BleUuids.fitnessMachine) {
        await _subscribeCharacteristic(session, service, BleUuids.indoorBikeData, (List<int> bytes) {
          final FtmsIndoorBikeData data = FtmsParser.parseIndoorBikeData(_asUint8List(bytes));
          _emitTelemetry(
            session,
            deviceId,
            speedKmh: data.speedKmh,
            powerWatts: data.powerWatts,
            cadenceRpm: data.cadenceRpm,
            heartRateBpm: data.heartRateBpm,
          );
        });
      }

      if (serviceUuid == BleUuids.cyclingPower) {
        await _subscribeCharacteristic(session, service, BleUuids.cyclingPowerMeasurement, (List<int> bytes) {
          final CyclingPowerReading? reading = session.cyclingPowerParser.parse(_asUint8List(bytes));
          if (reading != null) {
            _emitTelemetry(session, deviceId, powerWatts: reading.powerWatts, cadenceRpm: reading.cadenceRpm);
          }
        });
      }

      if (serviceUuid == BleUuids.cyclingSpeedCadence) {
        await _subscribeCharacteristic(session, service, BleUuids.cscMeasurement, (List<int> bytes) {
          final CscReading reading = session.cscParser.parse(_asUint8List(bytes));
          _emitTelemetry(session, deviceId, speedKmh: reading.speedKmh, cadenceRpm: reading.cadenceRpm);
        });
      }

      if (serviceUuid == BleUuids.heartRate) {
        await _subscribeCharacteristic(session, service, BleUuids.heartRateMeasurement, (List<int> bytes) {
          final int? bpm = HeartRateParser.parseHeartRateMeasurement(_asUint8List(bytes));
          if (bpm != null) _emitTelemetry(session, deviceId, heartRateBpm: bpm);
        });
      }

      if (serviceUuid == BleUuids.battery) {
        await _subscribeCharacteristic(session, service, BleUuids.batteryLevel, (List<int> bytes) {
          final int? level = BatteryLevelParser.parseBatteryLevel(_asUint8List(bytes));
          if (level != null) {
            _updateModel(deviceId, (BleDeviceModel m) => m.copyWithModel(batteryLevel: level));
          }
        });
      }
    }
  }

  Future<void> _subscribeCharacteristic(
    _DeviceSession session,
    BluetoothService service,
    String characteristicUuid,
    void Function(List<int> value) onData,
  ) async {
    BluetoothCharacteristic? characteristic;
    for (final BluetoothCharacteristic c in service.characteristics) {
      if (c.uuid.str.toLowerCase() == characteristicUuid.toLowerCase()) {
        characteristic = c;
        break;
      }
    }
    // El servicio anunciaba el UUID pero puede no exponer esta
    // característica en particular — no todos los rodillos implementan
    // absolutamente todo lo opcional de la spec, así que simplemente se
    // omite en vez de fallar la conexión completa.
    if (characteristic == null) return;

    await characteristic.setNotifyValue(true);
    final StreamSubscription<List<int>> sub = characteristic.lastValueStream.listen(onData);
    session.subscriptions.add(sub);
  }

  void _emitTelemetry(
    _DeviceSession session,
    String deviceId, {
    double? speedKmh,
    int? powerWatts,
    int? cadenceRpm,
    int? heartRateBpm,
  }) {
    session.telemetryController.add(
      TelemetrySnapshot(
        deviceId: deviceId,
        timestamp: DateTime.now(),
        speedKmh: speedKmh,
        powerWatts: powerWatts,
        cadenceRpm: cadenceRpm,
        heartRateBpm: heartRateBpm,
      ),
    );
  }

  // -------------------------------------------------------------------
  // Desconexión y reconexión automática
  // -------------------------------------------------------------------

  @override
  Future<void> disconnect(String deviceId) async {
    final _DeviceSession? session = _sessions[deviceId];
    if (session == null) return;

    session.reconnectTimer?.cancel();
    session.reconnectTimer = null;
    // Desconexión SOLICITADA por el usuario: se marca para que
    // `_handleUnexpectedDisconnect` no la confunda con una caída de señal
    // y dispare una reconexión no deseada.
    session.model = session.model.copyWithModel(status: DeviceConnectionStatus.disconnected);
    _emitConnectedDevices();

    await session.bluetoothDevice?.disconnect();
    session.disposeSubscriptions();
  }

  @override
  Future<void> forgetDevice(String deviceId) async {
    await disconnect(deviceId);
    await _knownDevicesLocalDataSource.removeKnownDevice(deviceId);
    _sessions.remove(deviceId);
    _emitConnectedDevices();
  }

  void _handleUnexpectedDisconnect(String deviceId) {
    final _DeviceSession? session = _sessions[deviceId];
    if (session == null) return;

    // Si el usuario ya lo desconectó manualmente (`disconnect()` puso el
    // status en `disconnected` explícitamente y canceló el timer), no se
    // reintenta. Solo se reconecta si el estado ANTES de esta caída era
    // `connected` (o `reconnecting`, si ya estaba en un ciclo de reintentos).
    if (session.model.status != DeviceConnectionStatus.connected &&
        session.model.status != DeviceConnectionStatus.reconnecting) {
      return;
    }

    if (!session.model.isAutoReconnectEnabled) {
      _updateStatus(deviceId, DeviceConnectionStatus.disconnected);
      return;
    }

    // Se registra la marca de la PRIMERA caída del ciclo actual — las
    // siguientes llamadas encadenadas (`reconnectTimer` → intento fallido
    // → esta misma función otra vez) no la sobrescriben, así el reloj
    // mide desde el inicio real del problema, no desde el último intento.
    session.firstDisconnectAt ??= DateTime.now();

    if (DateTime.now().difference(session.firstDisconnectAt!) >= _maxTotalReconnectDuration) {
      // Tarea B2: límite de TIEMPO total alcanzado, independientemente de
      // cuántos intentos lleve — se detiene y notifica en vez de seguir
      // en silencio potencialmente más allá de los 6 intentos si el
      // backoff los hubiera espaciado mucho.
      _updateStatus(deviceId, DeviceConnectionStatus.connectionFailed);
      session.reconnectAttempts = 0;
      session.firstDisconnectAt = null;
      return;
    }

    if (session.reconnectAttempts >= _maxReconnectAttempts) {
      _updateStatus(deviceId, DeviceConnectionStatus.connectionFailed);
      return;
    }

    _updateStatus(deviceId, DeviceConnectionStatus.reconnecting);
    session.disposeSubscriptions();

    // Backoff exponencial con techo de 30s: 2s, 4s, 8s, 16s, 30s, 30s...
    final int delaySeconds = (2 << session.reconnectAttempts).clamp(2, 30);
    session.reconnectAttempts += 1;

    session.reconnectTimer = Timer(Duration(seconds: delaySeconds), () async {
      try {
        await connect(deviceId);
      } catch (_) {
        _handleUnexpectedDisconnect(deviceId); // encadena el siguiente intento
      }
    });
  }

  @override
  Future<void> restoreKnownDevices() async {
    final List<String> knownIds = await _knownDevicesLocalDataSource.getKnownDeviceIds();
    for (final String id in knownIds) {
      // Se crea la sesión en estado `reconnecting` para que la pantalla de
      // dispositivos muestre inmediatamente "Reconectando..." en vez de
      // aparecer vacía mientras se intenta el primer `connect()`.
      _sessions[id] = _DeviceSession(
        model: BleDeviceModel(
          id: id,
          name: 'Dispositivo guardado',
          type: SportDeviceType.unknown,
          status: DeviceConnectionStatus.reconnecting,
        ),
      );
      unawaited(connect(id).catchError((_) => _handleUnexpectedDisconnect(id)));
    }
    _emitConnectedDevices();
  }

  // -------------------------------------------------------------------
  // Estado combinado / permisos / adaptador
  // -------------------------------------------------------------------

  @override
  Stream<List<BleDeviceModel>> get connectedDevicesStream => _connectedDevicesController.stream;

  @override
  Stream<TelemetrySnapshot> telemetryStreamFor(String deviceId) {
    return _sessionFor(deviceId).telemetryController.stream;
  }

  @override
  Future<bool> hasBlePermissions() => _permissionHandler.hasBlePermissions();

  @override
  Future<bool> requestBlePermissions() async {
    final BlePermissionStatus status = await _permissionHandler.requestBlePermissions();
    return status == BlePermissionStatus.granted;
  }

  @override
  Stream<bool> get isBluetoothEnabled {
    return FlutterBluePlus.adapterState.map((BluetoothAdapterState s) => s == BluetoothAdapterState.on);
  }

  // -------------------------------------------------------------------
  // Helpers privados
  // -------------------------------------------------------------------

  _DeviceSession _sessionFor(String deviceId) {
    return _sessions.putIfAbsent(
      deviceId,
      () => _DeviceSession(
        model: BleDeviceModel(
          id: deviceId,
          name: 'Dispositivo',
          type: SportDeviceType.unknown,
          status: DeviceConnectionStatus.disconnected,
        ),
      ),
    );
  }

  void _updateStatus(String deviceId, DeviceConnectionStatus status) {
    _updateModel(deviceId, (BleDeviceModel m) => m.copyWithModel(status: status));
  }

  void _updateModel(String deviceId, BleDeviceModel Function(BleDeviceModel current) update) {
    final _DeviceSession session = _sessionFor(deviceId);
    session.model = update(session.model);
    _emitConnectedDevices();
  }

  void _emitConnectedDevices() {
    _connectedDevicesController.add(
      _sessions.values.map((_DeviceSession s) => s.model).toList(growable: false),
    );
  }

  Uint8List _asUint8List(List<int> raw) => Uint8List.fromList(raw);
}
