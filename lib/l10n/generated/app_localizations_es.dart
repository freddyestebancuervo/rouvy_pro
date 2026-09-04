// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for Spanish Castilian (`es`).
class AppLocalizationsEs extends AppLocalizations {
  AppLocalizationsEs([String locale = 'es']) : super(locale);

  @override
  String get appName => 'RidePro';

  @override
  String get welcomeTitle => 'Entrena como nunca antes';

  @override
  String get welcomeSubtitle =>
      'Rutas del mundo real y entrenamiento indoor enfocado, en una sola app rápida.';

  @override
  String get welcomeCreateAccount => 'Crear cuenta';

  @override
  String get welcomeLogin => 'Ya tengo cuenta';

  @override
  String get loginTitle => 'Bienvenido de nuevo';

  @override
  String get loginSubtitle => 'Inicia sesión para continuar entrenando';

  @override
  String get emailLabel => 'Correo electrónico';

  @override
  String get passwordLabel => 'Contraseña';

  @override
  String get confirmPasswordLabel => 'Confirmar contraseña';

  @override
  String get loginButton => 'Iniciar sesión';

  @override
  String get noAccountText => '¿No tienes cuenta?';

  @override
  String get createAccountLink => 'Crear cuenta';

  @override
  String get forgotPasswordLink => '¿Olvidaste tu contraseña?';

  @override
  String get orDividerText => 'o';

  @override
  String get continueWithGoogle => 'Continuar con Google';

  @override
  String get continueWithApple => 'Continuar con Apple';

  @override
  String get registerTitle => 'Crea tu cuenta';

  @override
  String get registerSubtitle => 'Empieza a entrenar en minutos';

  @override
  String get nameLabel => 'Nombre';

  @override
  String get registerButton => 'Registrarme';

  @override
  String get hasAccountText => '¿Ya tienes cuenta?';

  @override
  String get loginLink => 'Inicia sesión';

  @override
  String get termsAcceptText =>
      'Al registrarte aceptas los Términos y la Política de Privacidad';

  @override
  String get forgotPasswordTitle => 'Recupera tu contraseña';

  @override
  String get forgotPasswordSubtitle =>
      'Te enviaremos un enlace a tu correo para restablecerla';

  @override
  String get sendResetLinkButton => 'Enviar enlace';

  @override
  String get resetLinkSentMessage =>
      'Revisa tu correo — te enviamos un enlace para restablecer tu contraseña.';

  @override
  String get backToLoginLink => 'Volver a iniciar sesión';

  @override
  String get verifyEmailTitle => 'Verifica tu correo';

  @override
  String verifyEmailMessage(String email) {
    return 'Enviamos un enlace de confirmación a $email. Ábrelo para activar tu cuenta.';
  }

  @override
  String get resendEmailButton => 'Reenviar correo';

  @override
  String resendEmailCooldown(int seconds) {
    return 'Podrás reenviar en ${seconds}s';
  }

  @override
  String get iVerifiedButton => 'Ya verifiqué mi correo';

  @override
  String get emailVerificationSentMessage => 'Correo de verificación enviado.';

  @override
  String get useAnotherAccountLink => 'Usar otra cuenta';

  @override
  String get profileTitle => 'Mi perfil';

  @override
  String get editProfileTitle => 'Editar perfil';

  @override
  String get ftpLabel => 'FTP (watts)';

  @override
  String get weightLabel => 'Peso (kg)';

  @override
  String get saveChangesButton => 'Guardar cambios';

  @override
  String get profileUpdatedMessage => 'Perfil actualizado correctamente.';

  @override
  String get changePhotoAction => 'Cambiar foto';

  @override
  String get accountSectionTitle => 'Cuenta';

  @override
  String get logoutAction => 'Cerrar sesión';

  @override
  String get logoutConfirmTitle => 'Cerrar sesión';

  @override
  String get logoutConfirmMessage => '¿Seguro que quieres cerrar sesión?';

  @override
  String get cancelAction => 'Cancelar';

  @override
  String get confirmAction => 'Confirmar';

  @override
  String get validationEmailRequired => 'Ingresa tu correo electrónico';

  @override
  String get validationEmailInvalid => 'Ingresa un correo válido';

  @override
  String get validationPasswordRequired => 'Ingresa tu contraseña';

  @override
  String get validationPasswordTooShort => 'Mínimo 8 caracteres';

  @override
  String get validationPasswordMissingNumber =>
      'Debe incluir al menos un número';

  @override
  String get validationPasswordMissingUppercase =>
      'Debe incluir al menos una mayúscula';

  @override
  String get validationNameRequired => 'Ingresa tu nombre';

  @override
  String get validationNameTooShort => 'El nombre es demasiado corto';

  @override
  String get validationConfirmPasswordMismatch =>
      'Las contraseñas no coinciden';

  @override
  String homeGreeting(String name) {
    return 'Hola, $name';
  }

  @override
  String get homeTodaySession => 'Tu sesión de hoy';

  @override
  String get homeRecommendedRoutes => 'Rutas recomendadas';

  @override
  String get genericErrorMessage => 'Ocurrió un error. Intenta de nuevo.';

  @override
  String get retryAction => 'Reintentar';

  @override
  String get socialSignInCancelledMessage => 'Inicio de sesión cancelado.';

  @override
  String get deviceManagementTitle => 'Dispositivos';

  @override
  String get connectedDevicesSection => 'Conectados';

  @override
  String get availableDevicesSection => 'Dispositivos disponibles';

  @override
  String get scanForDevicesButton => 'Buscar dispositivos';

  @override
  String get stopScanButton => 'Detener búsqueda';

  @override
  String get scanningInProgressMessage => 'Buscando dispositivos cercanos…';

  @override
  String get noDevicesFoundMessage =>
      'No se encontraron dispositivos. Asegúrate de que estén encendidos y cerca.';

  @override
  String get noConnectedDevicesMessage =>
      'Aún no tienes dispositivos conectados.';

  @override
  String get connectAction => 'Conectar';

  @override
  String get disconnectAction => 'Desconectar';

  @override
  String get forgetDeviceAction => 'Olvidar dispositivo';

  @override
  String get forgetDeviceConfirmTitle => 'Olvidar dispositivo';

  @override
  String get forgetDeviceConfirmMessage =>
      'Se eliminará de tus dispositivos guardados y no se reconectará automáticamente. ¿Continuar?';

  @override
  String get autoReconnectLabel => 'Reconexión automática';

  @override
  String get bluetoothOffMessage =>
      'El Bluetooth está apagado. Actívalo para buscar dispositivos.';

  @override
  String get permissionsRequiredTitle => 'Permisos de Bluetooth necesarios';

  @override
  String get permissionsRequiredMessage =>
      'RidePro necesita permiso de Bluetooth para conectarse a tu rodillo y sensores.';

  @override
  String get grantPermissionAction => 'Conceder permiso';

  @override
  String get openSettingsAction => 'Abrir ajustes';

  @override
  String get deviceTypeSmartTrainer => 'Rodillo inteligente';

  @override
  String get deviceTypePowerMeter => 'Medidor de potencia';

  @override
  String get deviceTypeHeartRateMonitor => 'Pulsómetro';

  @override
  String get deviceTypeCadenceSensor => 'Sensor de cadencia';

  @override
  String get deviceTypeSpeedSensor => 'Sensor de velocidad';

  @override
  String get deviceTypeSpeedCadenceCombo => 'Sensor de velocidad/cadencia';

  @override
  String get deviceTypeUnknown => 'Dispositivo';

  @override
  String get statusConnected => 'Conectado';

  @override
  String get statusConnecting => 'Conectando…';

  @override
  String get statusReconnecting => 'Reconectando…';

  @override
  String get statusDisconnected => 'Desconectado';

  @override
  String get statusConnectionFailed => 'Conexión fallida';

  @override
  String get statusScanning => 'Buscando…';

  @override
  String get signalExcellent => 'Señal excelente';

  @override
  String get signalGood => 'Señal buena';

  @override
  String get signalWeak => 'Señal débil';

  @override
  String get signalVeryWeak => 'Señal muy débil';

  @override
  String get batteryLabel => 'Batería';

  @override
  String get liveSpeedLabel => 'Vel.';

  @override
  String get livePowerLabel => 'Pot.';

  @override
  String get liveCadenceLabel => 'Cad.';

  @override
  String get liveHeartRateLabel => 'FC';

  @override
  String get manageDevicesMenuLabel => 'Dispositivos conectados';

  @override
  String get wearablesTitle => 'Relojes y apps de salud';

  @override
  String get wearablesMenuLabel => 'Relojes y apps de salud';

  @override
  String get wearableConnectAction => 'Conectar';

  @override
  String get wearableDisconnectAction => 'Desconectar';

  @override
  String get wearableImportAction => 'Importar actividades';

  @override
  String get wearableSimulatedBadge =>
      'Simulado — pendiente de aprobación oficial';

  @override
  String wearableLastSyncLabel(String date) {
    return 'Última sincronización: $date';
  }

  @override
  String get providerNameAppleHealth => 'Apple Health';

  @override
  String get providerNameGoogleFit => 'Google Fit';

  @override
  String get providerNameGarmin => 'Garmin';

  @override
  String get providerNamePolar => 'Polar';

  @override
  String get providerNameCoros => 'Coros';

  @override
  String get providerNameSuunto => 'Suunto';

  @override
  String get wearableStatusNotConnected => 'No conectado';

  @override
  String get wearableStatusConnecting => 'Conectando…';

  @override
  String get wearableStatusConnected => 'Conectado';

  @override
  String get wearableStatusSyncing => 'Sincronizando…';

  @override
  String get wearableStatusError => 'Error de conexión';

  @override
  String get wearableStatusPendingApproval => 'Pendiente de aprobación';

  @override
  String activitiesImportedMessage(int count) {
    return 'Se importaron $count actividades.';
  }

  @override
  String get webBluetoothUnsupportedTitle =>
      'Bluetooth no disponible en este navegador';

  @override
  String get webBluetoothUnsupportedMessage =>
      'Para conectar tu rodillo y sensores desde la Web necesitas Google Chrome o Microsoft Edge. El resto de la app funciona con normalidad.';

  @override
  String get webBluetoothUseAppMessage =>
      'Para la mejor experiencia de entrenamiento, usa la app en Android o iOS.';

  @override
  String get openInChromeOrEdgeAction => 'Abre esta página en Chrome o Edge';

  @override
  String get mobileAppRecommendedBanner =>
      'RidePro ofrece la experiencia completa de entrenamiento en Android e iOS.';

  @override
  String get startTrainingAction => 'Entrenar ahora';

  @override
  String get trainingPageTitle => 'Entrenamiento libre';

  @override
  String get pauseAction => 'Pausar';

  @override
  String get resumeAction => 'Reanudar';

  @override
  String get finishSessionAction => 'Finalizar';

  @override
  String get finishSessionConfirmTitle => 'Finalizar sesión';

  @override
  String get finishSessionConfirmMessage =>
      '¿Seguro que quieres terminar el entrenamiento?';

  @override
  String get noDevicesConnectedHint =>
      'No tienes dispositivos conectados — puedes entrenar igual, pero sin datos de velocidad, potencia o cadencia.';

  @override
  String get connectDevicesAction => 'Conectar dispositivos';

  @override
  String get metricSpeedLabel => 'Velocidad';

  @override
  String get metricPowerLabel => 'Potencia';

  @override
  String get metricCadenceLabel => 'Cadencia';

  @override
  String get metricHeartRateLabel => 'Frec. cardíaca';

  @override
  String get metricDistanceLabel => 'Distancia';

  @override
  String get metricCaloriesLabel => 'Calorías';

  @override
  String get metricTimeLabel => 'Tiempo';

  @override
  String get sessionSummaryTitle => 'Resumen de la sesión';

  @override
  String get sessionSummarySubtitle => '¡Buen trabajo!';

  @override
  String get lastReadingsLabel => 'Últimas lecturas';

  @override
  String get noReadingsMessage =>
      'Sin lecturas registradas (sin dispositivos conectados durante la sesión).';

  @override
  String get backToHomeAction => 'Volver a inicio';

  @override
  String devicesUsedLabel(int count) {
    return '$count dispositivo(s) conectado(s) durante la sesión';
  }

  @override
  String get savingSessionLabel => 'Guardando…';

  @override
  String get sessionSavedLabel => 'Guardado';

  @override
  String get sessionSaveErrorLabel =>
      'No se pudo guardar (sin conexión). Tus datos siguen aquí en pantalla.';

  @override
  String get rideHistoryTitle => 'Historial de entrenamientos';

  @override
  String get noSessionsYetMessage =>
      'Aún no tienes sesiones guardadas. ¡Termina tu primer entrenamiento para verlo aquí!';

  @override
  String get offlineBannerMessage =>
      'Sin conexión — tus cambios se guardarán y sincronizarán automáticamente.';

  @override
  String get syncingBannerMessage => 'Sincronizando cambios pendientes…';

  @override
  String get recoverSessionTitle => 'Sesión sin finalizar encontrada';

  @override
  String recoverSessionMessage(String duration, String distanceKm) {
    return 'Tenías una sesión de $duration y $distanceKm km que no se finalizó (la app se cerró inesperadamente). ¿Quieres continuarla?';
  }

  @override
  String get discardSessionAction => 'Descartar';

  @override
  String get resumeSessionAction => 'Continuar sesión';

  @override
  String get statisticsTitle => 'Estadísticas';

  @override
  String get weeklyActivityLabel => 'Actividad de la semana';

  @override
  String get personalRecordsLabel => 'Récords personales';

  @override
  String get longestSessionLabel => 'Sesión más larga';

  @override
  String totalSessionsLabel(int count) {
    return '$count sesiones registradas';
  }

  @override
  String streakLabel(int days) {
    return '¡$days días seguidos entrenando!';
  }

  @override
  String get achievementsTitle => 'Logros';

  @override
  String achievementsProgressLabel(int unlocked, int total) {
    return '$unlocked de $total desbloqueados';
  }

  @override
  String get showPasswordAction => 'Mostrar contraseña';

  @override
  String get hidePasswordAction => 'Ocultar contraseña';

  @override
  String get noSignalLabel => 'Sin señal';

  @override
  String get routesCatalogTitle => 'Catálogo de rutas';

  @override
  String get routeDetailTitle => 'Detalle de ruta';

  @override
  String get noRoutesAvailableMessage => 'No hay rutas disponibles por ahora.';

  @override
  String get routeDifficultyEasy => 'Fácil';

  @override
  String get routeDifficultyModerate => 'Moderada';

  @override
  String get routeDifficultyHard => 'Difícil';

  @override
  String get routeDifficultyExtreme => 'Extrema';

  @override
  String get routeContentVideo => 'Video';

  @override
  String get routeContentTerrain3d => 'Terreno 3D';

  @override
  String get routeContentStatic => 'Ruta local';

  @override
  String get startTrainingOnRouteAction => 'Entrenar esta ruta';

  @override
  String get routeTrainingNote =>
      'Tu progreso se rastrea por distancia a lo largo de esta ruta. La reproducción de video/3D sincronizado todavía no está implementada.';

  @override
  String get routeNotFoundTitle => 'Ruta no encontrada';

  @override
  String get routeNotFoundMessage =>
      'No se pudo cargar esta ruta. Volvé y elegí otra desde el catálogo.';

  @override
  String get backToRoutesAction => 'Volver a rutas';

  @override
  String get routeProgressLabel => 'Progreso de ruta';

  @override
  String get routeCompletedLabel => 'Ruta completada';

  @override
  String get routeStoppedEarlyLabel => 'Detenida antes de terminar la ruta';

  @override
  String get routeComingSoonLabel => 'Próximamente';

  @override
  String get routeComingSoonNote =>
      'Esta ruta necesita contenido de video/3D que todavía no existe — no se puede iniciar hasta entonces.';

  @override
  String get routeNotAvailableTitle => 'Ruta no disponible todavía';

  @override
  String get routeNotAvailableMessage =>
      'Esta ruta necesita contenido de video/3D que todavía no existe. Volvé y elegí una ruta disponible del catálogo.';

  @override
  String get settingsTitle => 'Configuración';

  @override
  String get appearanceSectionTitle => 'Apariencia';

  @override
  String get themeSystemAction => 'Seguir el sistema';

  @override
  String get themeLightAction => 'Claro';

  @override
  String get themeDarkAction => 'Oscuro';

  @override
  String get languageSectionTitle => 'Idioma';

  @override
  String get languageSystemAction => 'Seguir el sistema';

  @override
  String get otherSectionTitle => 'Otros';

  @override
  String get unitsLabel => 'Unidades';

  @override
  String get unitsMetricValue => 'Métrico (km, kg)';

  @override
  String get notificationsLabel => 'Notificaciones';

  @override
  String get notificationsEnabledValue => 'Activadas';

  @override
  String get exploreCatalogHint => 'Explora el catálogo completo';

  @override
  String get workoutsTitle => 'Entrenamientos';

  @override
  String get workoutsHomeHint => 'Crea y explora tus entrenamientos';

  @override
  String get workoutsMineFilterLabel => 'Míos';

  @override
  String get workoutsAllFilterLabel => 'Todos';

  @override
  String get noWorkoutsAvailableMessage =>
      'No hay entrenamientos disponibles todavía.';

  @override
  String get newWorkoutAction => 'Nuevo entrenamiento';

  @override
  String get workoutDetailTitle => 'Detalle del entrenamiento';

  @override
  String get workoutIntervalsTitle => 'Intervalos';

  @override
  String workoutIntervalsCount(int count) {
    return '$count intervalos';
  }

  @override
  String get workoutEstimatedDurationLabel => 'Duración estimada';

  @override
  String get workoutTargetTypeLabel => 'Tipo de objetivo';

  @override
  String get workoutTargetTypePower => 'Potencia (%FTP)';

  @override
  String get workoutTargetTypeHeartRate => 'Frecuencia cardíaca';

  @override
  String get workoutTargetTypeNone => 'Libre';

  @override
  String get workoutPublicLabel => 'Público';

  @override
  String get workoutPrivateLabel => 'Privado';

  @override
  String get workoutCatalogLabel => 'Catálogo';

  @override
  String get workoutArchivedLabel => 'Archivado';

  @override
  String get createWorkoutTitle => 'Crear entrenamiento';

  @override
  String get editWorkoutTitle => 'Editar entrenamiento';

  @override
  String get workoutDescriptionLabel => 'Descripción (opcional)';

  @override
  String get workoutPublicSwitchLabel => 'Hacer público';

  @override
  String get workoutPublicSwitchHint =>
      'Otros usuarios podrán verlo, pero no editarlo.';

  @override
  String get addIntervalAction => 'Agregar intervalo';

  @override
  String get removeAction => 'Quitar';

  @override
  String intervalNumberLabel(int number) {
    return 'Intervalo $number';
  }

  @override
  String get intervalDurationLabel => 'Duración (segundos)';

  @override
  String get intervalTargetLowLabel => 'Objetivo mínimo';

  @override
  String get intervalTargetHighLabel => 'Objetivo máximo';

  @override
  String get intervalLabelLabel => 'Etiqueta (opcional)';

  @override
  String get createWorkoutButton => 'Crear entrenamiento';

  @override
  String get archiveWorkoutAction => 'Archivar';

  @override
  String get archiveWorkoutConfirmTitle => '¿Archivar este entrenamiento?';

  @override
  String get archiveWorkoutConfirmMessage =>
      'Podrás seguir viéndolo, pero ya no podrás editarlo.';

  @override
  String get workoutArchivedSuccessMessage => 'Entrenamiento archivado.';

  @override
  String get workoutCreatedSuccessMessage => 'Entrenamiento creado.';

  @override
  String get workoutUpdatedSuccessMessage => 'Entrenamiento actualizado.';

  @override
  String get workoutReadOnlyNotice =>
      'Este entrenamiento no es tuyo — solo puedes verlo.';

  @override
  String get workoutArchivedNotice =>
      'Este entrenamiento está archivado y no se puede editar.';

  @override
  String get backendSessionUnavailableMessage =>
      'No se pudo conectar con el backend de entrenamientos. Verifica tu conexión e intenta de nuevo.';

  @override
  String get validationAtLeastOneInterval => 'Agrega al menos un intervalo.';

  @override
  String get validationDurationRequired =>
      'Ingresa una duración válida (1 a 36000 segundos).';

  @override
  String get validationTargetRangeInvalid =>
      'El objetivo mínimo no puede ser mayor que el máximo.';
}
