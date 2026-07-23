import 'package:flutter/foundation.dart';

/// Resuelve la URL base del backend propio de RidePro (NestJS + Postgres,
/// ver `backend/`) según la plataforma — **completamente independiente**
/// de Firebase (`firebase_options.dart`), que es un sistema aparte usado
/// hoy solo por `features/auth`, `training`, `wearables`.
///
/// ⚠️ DEUDA TÉCNICA: no existe todavía un mecanismo de configuración por
/// entorno (`--dart-define`, `.env` de Flutter) para este valor — asume
/// siempre un backend corriendo en local (`backend/.env.example`,
/// `PORT=3000`, prefijo global `/v1`, ver `backend/src/main.ts`). Antes de
/// apuntar a un backend desplegado (staging/producción) hay que introducir
/// esa configuración; hasta entonces esto solo sirve para desarrollo.
abstract class ApiConfig {
  static String get backendBaseUrl {
    if (kIsWeb) return 'http://localhost:3000/v1';
    // El emulador de Android no resuelve "localhost" como la propia
    // máquina host — 10.0.2.2 es el alias especial que sí lo hace.
    if (defaultTargetPlatform == TargetPlatform.android) {
      return 'http://10.0.2.2:3000/v1';
    }
    return 'http://localhost:3000/v1';
  }
}
