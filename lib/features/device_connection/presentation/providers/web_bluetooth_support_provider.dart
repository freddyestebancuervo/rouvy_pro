import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/platform/web_bluetooth_support.dart';

/// `true` en Android/iOS/desktop (siempre) y en Web solo si el navegador
/// expone `navigator.bluetooth` (Chrome/Edge). Se consulta UNA vez por
/// entrada a la pantalla de dispositivos — no cambia durante la sesión
/// (el usuario no cambia de navegador a mitad de uso de la app).
final webBluetoothSupportedProvider = FutureProvider<bool>((Ref ref) => isWebBluetoothSupported());
