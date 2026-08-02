import 'app/bootstrap.dart';
import 'core/config/environments/environment_development.dart';

/// Entry point exclusivo del entorno Development (`ridepro-development`).
/// Deliberadamente NO importa `firebase_options.dart` (Producción), ni
/// `social_login_config.dart`, ni `environment_production.dart` — la
/// separación de entorno la da la ausencia física de esos símbolos en
/// este árbol de compilación, no una condición evaluada en runtime.
/// `bootstrap.dart` tampoco los importa — solo recibe el [AppEnvironment]
/// ya resuelto aquí.
Future<void> main() => bootstrapRideProApp(developmentEnvironment);
