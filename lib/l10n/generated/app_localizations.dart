import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:intl/intl.dart' as intl;

import 'app_localizations_en.dart';
import 'app_localizations_es.dart';

// ignore_for_file: type=lint

/// Callers can lookup localized strings with an instance of AppLocalizations
/// returned by `AppLocalizations.of(context)`.
///
/// Applications need to include `AppLocalizations.delegate()` in their app's
/// `localizationDelegates` list, and the locales they support in the app's
/// `supportedLocales` list. For example:
///
/// ```dart
/// import 'generated/app_localizations.dart';
///
/// return MaterialApp(
///   localizationsDelegates: AppLocalizations.localizationsDelegates,
///   supportedLocales: AppLocalizations.supportedLocales,
///   home: MyApplicationHome(),
/// );
/// ```
///
/// ## Update pubspec.yaml
///
/// Please make sure to update your pubspec.yaml to include the following
/// packages:
///
/// ```yaml
/// dependencies:
///   # Internationalization support.
///   flutter_localizations:
///     sdk: flutter
///   intl: any # Use the pinned version from flutter_localizations
///
///   # Rest of dependencies
/// ```
///
/// ## iOS Applications
///
/// iOS applications define key application metadata, including supported
/// locales, in an Info.plist file that is built into the application bundle.
/// To configure the locales supported by your app, you’ll need to edit this
/// file.
///
/// First, open your project’s ios/Runner.xcworkspace Xcode workspace file.
/// Then, in the Project Navigator, open the Info.plist file under the Runner
/// project’s Runner folder.
///
/// Next, select the Information Property List item, select Add Item from the
/// Editor menu, then select Localizations from the pop-up menu.
///
/// Select and expand the newly-created Localizations item then, for each
/// locale your application supports, add a new item and select the locale
/// you wish to add from the pop-up menu in the Value field. This list should
/// be consistent with the languages listed in the AppLocalizations.supportedLocales
/// property.
abstract class AppLocalizations {
  AppLocalizations(String locale)
      : localeName = intl.Intl.canonicalizedLocale(locale.toString());

  final String localeName;

  static AppLocalizations of(BuildContext context) {
    return Localizations.of<AppLocalizations>(context, AppLocalizations)!;
  }

  static const LocalizationsDelegate<AppLocalizations> delegate =
      _AppLocalizationsDelegate();

  /// A list of this localizations delegate along with the default localizations
  /// delegates.
  ///
  /// Returns a list of localizations delegates containing this delegate along with
  /// GlobalMaterialLocalizations.delegate, GlobalCupertinoLocalizations.delegate,
  /// and GlobalWidgetsLocalizations.delegate.
  ///
  /// Additional delegates can be added by appending to this list in
  /// MaterialApp. This list does not have to be used at all if a custom list
  /// of delegates is preferred or required.
  static const List<LocalizationsDelegate<dynamic>> localizationsDelegates =
      <LocalizationsDelegate<dynamic>>[
    delegate,
    GlobalMaterialLocalizations.delegate,
    GlobalCupertinoLocalizations.delegate,
    GlobalWidgetsLocalizations.delegate,
  ];

  /// A list of this localizations delegate's supported locales.
  static const List<Locale> supportedLocales = <Locale>[
    Locale('en'),
    Locale('es')
  ];

  /// No description provided for @appName.
  ///
  /// In es, this message translates to:
  /// **'RidePro'**
  String get appName;

  /// No description provided for @welcomeTitle.
  ///
  /// In es, this message translates to:
  /// **'Entrena como nunca antes'**
  String get welcomeTitle;

  /// No description provided for @welcomeSubtitle.
  ///
  /// In es, this message translates to:
  /// **'Rutas reales, multijugador en vivo y planes con IA — todo en una app más rápida.'**
  String get welcomeSubtitle;

  /// No description provided for @welcomeCreateAccount.
  ///
  /// In es, this message translates to:
  /// **'Crear cuenta'**
  String get welcomeCreateAccount;

  /// No description provided for @welcomeLogin.
  ///
  /// In es, this message translates to:
  /// **'Ya tengo cuenta'**
  String get welcomeLogin;

  /// No description provided for @loginTitle.
  ///
  /// In es, this message translates to:
  /// **'Bienvenido de nuevo'**
  String get loginTitle;

  /// No description provided for @loginSubtitle.
  ///
  /// In es, this message translates to:
  /// **'Inicia sesión para continuar entrenando'**
  String get loginSubtitle;

  /// No description provided for @emailLabel.
  ///
  /// In es, this message translates to:
  /// **'Correo electrónico'**
  String get emailLabel;

  /// No description provided for @passwordLabel.
  ///
  /// In es, this message translates to:
  /// **'Contraseña'**
  String get passwordLabel;

  /// No description provided for @confirmPasswordLabel.
  ///
  /// In es, this message translates to:
  /// **'Confirmar contraseña'**
  String get confirmPasswordLabel;

  /// No description provided for @loginButton.
  ///
  /// In es, this message translates to:
  /// **'Iniciar sesión'**
  String get loginButton;

  /// No description provided for @noAccountText.
  ///
  /// In es, this message translates to:
  /// **'¿No tienes cuenta?'**
  String get noAccountText;

  /// No description provided for @createAccountLink.
  ///
  /// In es, this message translates to:
  /// **'Crear cuenta'**
  String get createAccountLink;

  /// No description provided for @forgotPasswordLink.
  ///
  /// In es, this message translates to:
  /// **'¿Olvidaste tu contraseña?'**
  String get forgotPasswordLink;

  /// No description provided for @orDividerText.
  ///
  /// In es, this message translates to:
  /// **'o'**
  String get orDividerText;

  /// No description provided for @continueWithGoogle.
  ///
  /// In es, this message translates to:
  /// **'Continuar con Google'**
  String get continueWithGoogle;

  /// No description provided for @continueWithApple.
  ///
  /// In es, this message translates to:
  /// **'Continuar con Apple'**
  String get continueWithApple;

  /// No description provided for @registerTitle.
  ///
  /// In es, this message translates to:
  /// **'Crea tu cuenta'**
  String get registerTitle;

  /// No description provided for @registerSubtitle.
  ///
  /// In es, this message translates to:
  /// **'Empieza a entrenar en minutos'**
  String get registerSubtitle;

  /// No description provided for @nameLabel.
  ///
  /// In es, this message translates to:
  /// **'Nombre'**
  String get nameLabel;

  /// No description provided for @registerButton.
  ///
  /// In es, this message translates to:
  /// **'Registrarme'**
  String get registerButton;

  /// No description provided for @hasAccountText.
  ///
  /// In es, this message translates to:
  /// **'¿Ya tienes cuenta?'**
  String get hasAccountText;

  /// No description provided for @loginLink.
  ///
  /// In es, this message translates to:
  /// **'Inicia sesión'**
  String get loginLink;

  /// No description provided for @termsAcceptText.
  ///
  /// In es, this message translates to:
  /// **'Al registrarte aceptas los Términos y la Política de Privacidad'**
  String get termsAcceptText;

  /// No description provided for @forgotPasswordTitle.
  ///
  /// In es, this message translates to:
  /// **'Recupera tu contraseña'**
  String get forgotPasswordTitle;

  /// No description provided for @forgotPasswordSubtitle.
  ///
  /// In es, this message translates to:
  /// **'Te enviaremos un enlace a tu correo para restablecerla'**
  String get forgotPasswordSubtitle;

  /// No description provided for @sendResetLinkButton.
  ///
  /// In es, this message translates to:
  /// **'Enviar enlace'**
  String get sendResetLinkButton;

  /// No description provided for @resetLinkSentMessage.
  ///
  /// In es, this message translates to:
  /// **'Revisa tu correo — te enviamos un enlace para restablecer tu contraseña.'**
  String get resetLinkSentMessage;

  /// No description provided for @backToLoginLink.
  ///
  /// In es, this message translates to:
  /// **'Volver a iniciar sesión'**
  String get backToLoginLink;

  /// No description provided for @verifyEmailTitle.
  ///
  /// In es, this message translates to:
  /// **'Verifica tu correo'**
  String get verifyEmailTitle;

  /// No description provided for @verifyEmailMessage.
  ///
  /// In es, this message translates to:
  /// **'Enviamos un enlace de confirmación a {email}. Ábrelo para activar tu cuenta.'**
  String verifyEmailMessage(String email);

  /// No description provided for @resendEmailButton.
  ///
  /// In es, this message translates to:
  /// **'Reenviar correo'**
  String get resendEmailButton;

  /// No description provided for @resendEmailCooldown.
  ///
  /// In es, this message translates to:
  /// **'Podrás reenviar en {seconds}s'**
  String resendEmailCooldown(int seconds);

  /// No description provided for @iVerifiedButton.
  ///
  /// In es, this message translates to:
  /// **'Ya verifiqué mi correo'**
  String get iVerifiedButton;

  /// No description provided for @emailVerificationSentMessage.
  ///
  /// In es, this message translates to:
  /// **'Correo de verificación enviado.'**
  String get emailVerificationSentMessage;

  /// No description provided for @useAnotherAccountLink.
  ///
  /// In es, this message translates to:
  /// **'Usar otra cuenta'**
  String get useAnotherAccountLink;

  /// No description provided for @profileTitle.
  ///
  /// In es, this message translates to:
  /// **'Mi perfil'**
  String get profileTitle;

  /// No description provided for @editProfileTitle.
  ///
  /// In es, this message translates to:
  /// **'Editar perfil'**
  String get editProfileTitle;

  /// No description provided for @ftpLabel.
  ///
  /// In es, this message translates to:
  /// **'FTP (watts)'**
  String get ftpLabel;

  /// No description provided for @weightLabel.
  ///
  /// In es, this message translates to:
  /// **'Peso (kg)'**
  String get weightLabel;

  /// No description provided for @saveChangesButton.
  ///
  /// In es, this message translates to:
  /// **'Guardar cambios'**
  String get saveChangesButton;

  /// No description provided for @profileUpdatedMessage.
  ///
  /// In es, this message translates to:
  /// **'Perfil actualizado correctamente.'**
  String get profileUpdatedMessage;

  /// No description provided for @changePhotoAction.
  ///
  /// In es, this message translates to:
  /// **'Cambiar foto'**
  String get changePhotoAction;

  /// No description provided for @accountSectionTitle.
  ///
  /// In es, this message translates to:
  /// **'Cuenta'**
  String get accountSectionTitle;

  /// No description provided for @logoutAction.
  ///
  /// In es, this message translates to:
  /// **'Cerrar sesión'**
  String get logoutAction;

  /// No description provided for @logoutConfirmTitle.
  ///
  /// In es, this message translates to:
  /// **'Cerrar sesión'**
  String get logoutConfirmTitle;

  /// No description provided for @logoutConfirmMessage.
  ///
  /// In es, this message translates to:
  /// **'¿Seguro que quieres cerrar sesión?'**
  String get logoutConfirmMessage;

  /// No description provided for @cancelAction.
  ///
  /// In es, this message translates to:
  /// **'Cancelar'**
  String get cancelAction;

  /// No description provided for @confirmAction.
  ///
  /// In es, this message translates to:
  /// **'Confirmar'**
  String get confirmAction;

  /// No description provided for @validationEmailRequired.
  ///
  /// In es, this message translates to:
  /// **'Ingresa tu correo electrónico'**
  String get validationEmailRequired;

  /// No description provided for @validationEmailInvalid.
  ///
  /// In es, this message translates to:
  /// **'Ingresa un correo válido'**
  String get validationEmailInvalid;

  /// No description provided for @validationPasswordRequired.
  ///
  /// In es, this message translates to:
  /// **'Ingresa tu contraseña'**
  String get validationPasswordRequired;

  /// No description provided for @validationPasswordTooShort.
  ///
  /// In es, this message translates to:
  /// **'Mínimo 8 caracteres'**
  String get validationPasswordTooShort;

  /// No description provided for @validationPasswordMissingNumber.
  ///
  /// In es, this message translates to:
  /// **'Debe incluir al menos un número'**
  String get validationPasswordMissingNumber;

  /// No description provided for @validationPasswordMissingUppercase.
  ///
  /// In es, this message translates to:
  /// **'Debe incluir al menos una mayúscula'**
  String get validationPasswordMissingUppercase;

  /// No description provided for @validationNameRequired.
  ///
  /// In es, this message translates to:
  /// **'Ingresa tu nombre'**
  String get validationNameRequired;

  /// No description provided for @validationNameTooShort.
  ///
  /// In es, this message translates to:
  /// **'El nombre es demasiado corto'**
  String get validationNameTooShort;

  /// No description provided for @validationConfirmPasswordMismatch.
  ///
  /// In es, this message translates to:
  /// **'Las contraseñas no coinciden'**
  String get validationConfirmPasswordMismatch;

  /// No description provided for @homeGreeting.
  ///
  /// In es, this message translates to:
  /// **'Hola, {name}'**
  String homeGreeting(String name);

  /// No description provided for @homeTodaySession.
  ///
  /// In es, this message translates to:
  /// **'Tu sesión de hoy'**
  String get homeTodaySession;

  /// No description provided for @homeRecommendedRoutes.
  ///
  /// In es, this message translates to:
  /// **'Rutas recomendadas'**
  String get homeRecommendedRoutes;

  /// No description provided for @genericErrorMessage.
  ///
  /// In es, this message translates to:
  /// **'Ocurrió un error. Intenta de nuevo.'**
  String get genericErrorMessage;

  /// No description provided for @retryAction.
  ///
  /// In es, this message translates to:
  /// **'Reintentar'**
  String get retryAction;

  /// No description provided for @socialSignInCancelledMessage.
  ///
  /// In es, this message translates to:
  /// **'Inicio de sesión cancelado.'**
  String get socialSignInCancelledMessage;

  /// No description provided for @deviceManagementTitle.
  ///
  /// In es, this message translates to:
  /// **'Dispositivos'**
  String get deviceManagementTitle;

  /// No description provided for @connectedDevicesSection.
  ///
  /// In es, this message translates to:
  /// **'Conectados'**
  String get connectedDevicesSection;

  /// No description provided for @availableDevicesSection.
  ///
  /// In es, this message translates to:
  /// **'Dispositivos disponibles'**
  String get availableDevicesSection;

  /// No description provided for @scanForDevicesButton.
  ///
  /// In es, this message translates to:
  /// **'Buscar dispositivos'**
  String get scanForDevicesButton;

  /// No description provided for @stopScanButton.
  ///
  /// In es, this message translates to:
  /// **'Detener búsqueda'**
  String get stopScanButton;

  /// No description provided for @scanningInProgressMessage.
  ///
  /// In es, this message translates to:
  /// **'Buscando dispositivos cercanos…'**
  String get scanningInProgressMessage;

  /// No description provided for @noDevicesFoundMessage.
  ///
  /// In es, this message translates to:
  /// **'No se encontraron dispositivos. Asegúrate de que estén encendidos y cerca.'**
  String get noDevicesFoundMessage;

  /// No description provided for @noConnectedDevicesMessage.
  ///
  /// In es, this message translates to:
  /// **'Aún no tienes dispositivos conectados.'**
  String get noConnectedDevicesMessage;

  /// No description provided for @connectAction.
  ///
  /// In es, this message translates to:
  /// **'Conectar'**
  String get connectAction;

  /// No description provided for @disconnectAction.
  ///
  /// In es, this message translates to:
  /// **'Desconectar'**
  String get disconnectAction;

  /// No description provided for @forgetDeviceAction.
  ///
  /// In es, this message translates to:
  /// **'Olvidar dispositivo'**
  String get forgetDeviceAction;

  /// No description provided for @forgetDeviceConfirmTitle.
  ///
  /// In es, this message translates to:
  /// **'Olvidar dispositivo'**
  String get forgetDeviceConfirmTitle;

  /// No description provided for @forgetDeviceConfirmMessage.
  ///
  /// In es, this message translates to:
  /// **'Se eliminará de tus dispositivos guardados y no se reconectará automáticamente. ¿Continuar?'**
  String get forgetDeviceConfirmMessage;

  /// No description provided for @autoReconnectLabel.
  ///
  /// In es, this message translates to:
  /// **'Reconexión automática'**
  String get autoReconnectLabel;

  /// No description provided for @bluetoothOffMessage.
  ///
  /// In es, this message translates to:
  /// **'El Bluetooth está apagado. Actívalo para buscar dispositivos.'**
  String get bluetoothOffMessage;

  /// No description provided for @permissionsRequiredTitle.
  ///
  /// In es, this message translates to:
  /// **'Permisos de Bluetooth necesarios'**
  String get permissionsRequiredTitle;

  /// No description provided for @permissionsRequiredMessage.
  ///
  /// In es, this message translates to:
  /// **'RidePro necesita permiso de Bluetooth para conectarse a tu rodillo y sensores.'**
  String get permissionsRequiredMessage;

  /// No description provided for @grantPermissionAction.
  ///
  /// In es, this message translates to:
  /// **'Conceder permiso'**
  String get grantPermissionAction;

  /// No description provided for @openSettingsAction.
  ///
  /// In es, this message translates to:
  /// **'Abrir ajustes'**
  String get openSettingsAction;

  /// No description provided for @deviceTypeSmartTrainer.
  ///
  /// In es, this message translates to:
  /// **'Rodillo inteligente'**
  String get deviceTypeSmartTrainer;

  /// No description provided for @deviceTypePowerMeter.
  ///
  /// In es, this message translates to:
  /// **'Medidor de potencia'**
  String get deviceTypePowerMeter;

  /// No description provided for @deviceTypeHeartRateMonitor.
  ///
  /// In es, this message translates to:
  /// **'Pulsómetro'**
  String get deviceTypeHeartRateMonitor;

  /// No description provided for @deviceTypeCadenceSensor.
  ///
  /// In es, this message translates to:
  /// **'Sensor de cadencia'**
  String get deviceTypeCadenceSensor;

  /// No description provided for @deviceTypeSpeedSensor.
  ///
  /// In es, this message translates to:
  /// **'Sensor de velocidad'**
  String get deviceTypeSpeedSensor;

  /// No description provided for @deviceTypeSpeedCadenceCombo.
  ///
  /// In es, this message translates to:
  /// **'Sensor de velocidad/cadencia'**
  String get deviceTypeSpeedCadenceCombo;

  /// No description provided for @deviceTypeUnknown.
  ///
  /// In es, this message translates to:
  /// **'Dispositivo'**
  String get deviceTypeUnknown;

  /// No description provided for @statusConnected.
  ///
  /// In es, this message translates to:
  /// **'Conectado'**
  String get statusConnected;

  /// No description provided for @statusConnecting.
  ///
  /// In es, this message translates to:
  /// **'Conectando…'**
  String get statusConnecting;

  /// No description provided for @statusReconnecting.
  ///
  /// In es, this message translates to:
  /// **'Reconectando…'**
  String get statusReconnecting;

  /// No description provided for @statusDisconnected.
  ///
  /// In es, this message translates to:
  /// **'Desconectado'**
  String get statusDisconnected;

  /// No description provided for @statusConnectionFailed.
  ///
  /// In es, this message translates to:
  /// **'Conexión fallida'**
  String get statusConnectionFailed;

  /// No description provided for @statusScanning.
  ///
  /// In es, this message translates to:
  /// **'Buscando…'**
  String get statusScanning;

  /// No description provided for @signalExcellent.
  ///
  /// In es, this message translates to:
  /// **'Señal excelente'**
  String get signalExcellent;

  /// No description provided for @signalGood.
  ///
  /// In es, this message translates to:
  /// **'Señal buena'**
  String get signalGood;

  /// No description provided for @signalWeak.
  ///
  /// In es, this message translates to:
  /// **'Señal débil'**
  String get signalWeak;

  /// No description provided for @signalVeryWeak.
  ///
  /// In es, this message translates to:
  /// **'Señal muy débil'**
  String get signalVeryWeak;

  /// No description provided for @batteryLabel.
  ///
  /// In es, this message translates to:
  /// **'Batería'**
  String get batteryLabel;

  /// No description provided for @liveSpeedLabel.
  ///
  /// In es, this message translates to:
  /// **'Vel.'**
  String get liveSpeedLabel;

  /// No description provided for @livePowerLabel.
  ///
  /// In es, this message translates to:
  /// **'Pot.'**
  String get livePowerLabel;

  /// No description provided for @liveCadenceLabel.
  ///
  /// In es, this message translates to:
  /// **'Cad.'**
  String get liveCadenceLabel;

  /// No description provided for @liveHeartRateLabel.
  ///
  /// In es, this message translates to:
  /// **'FC'**
  String get liveHeartRateLabel;

  /// No description provided for @manageDevicesMenuLabel.
  ///
  /// In es, this message translates to:
  /// **'Dispositivos conectados'**
  String get manageDevicesMenuLabel;

  /// No description provided for @wearablesTitle.
  ///
  /// In es, this message translates to:
  /// **'Relojes y apps de salud'**
  String get wearablesTitle;

  /// No description provided for @wearablesMenuLabel.
  ///
  /// In es, this message translates to:
  /// **'Relojes y apps de salud'**
  String get wearablesMenuLabel;

  /// No description provided for @wearableConnectAction.
  ///
  /// In es, this message translates to:
  /// **'Conectar'**
  String get wearableConnectAction;

  /// No description provided for @wearableDisconnectAction.
  ///
  /// In es, this message translates to:
  /// **'Desconectar'**
  String get wearableDisconnectAction;

  /// No description provided for @wearableImportAction.
  ///
  /// In es, this message translates to:
  /// **'Importar actividades'**
  String get wearableImportAction;

  /// No description provided for @wearableSimulatedBadge.
  ///
  /// In es, this message translates to:
  /// **'Simulado — pendiente de aprobación oficial'**
  String get wearableSimulatedBadge;

  /// No description provided for @wearableLastSyncLabel.
  ///
  /// In es, this message translates to:
  /// **'Última sincronización: {date}'**
  String wearableLastSyncLabel(String date);

  /// No description provided for @providerNameAppleHealth.
  ///
  /// In es, this message translates to:
  /// **'Apple Health'**
  String get providerNameAppleHealth;

  /// No description provided for @providerNameGoogleFit.
  ///
  /// In es, this message translates to:
  /// **'Google Fit'**
  String get providerNameGoogleFit;

  /// No description provided for @providerNameGarmin.
  ///
  /// In es, this message translates to:
  /// **'Garmin'**
  String get providerNameGarmin;

  /// No description provided for @providerNamePolar.
  ///
  /// In es, this message translates to:
  /// **'Polar'**
  String get providerNamePolar;

  /// No description provided for @providerNameCoros.
  ///
  /// In es, this message translates to:
  /// **'Coros'**
  String get providerNameCoros;

  /// No description provided for @providerNameSuunto.
  ///
  /// In es, this message translates to:
  /// **'Suunto'**
  String get providerNameSuunto;

  /// No description provided for @wearableStatusNotConnected.
  ///
  /// In es, this message translates to:
  /// **'No conectado'**
  String get wearableStatusNotConnected;

  /// No description provided for @wearableStatusConnecting.
  ///
  /// In es, this message translates to:
  /// **'Conectando…'**
  String get wearableStatusConnecting;

  /// No description provided for @wearableStatusConnected.
  ///
  /// In es, this message translates to:
  /// **'Conectado'**
  String get wearableStatusConnected;

  /// No description provided for @wearableStatusSyncing.
  ///
  /// In es, this message translates to:
  /// **'Sincronizando…'**
  String get wearableStatusSyncing;

  /// No description provided for @wearableStatusError.
  ///
  /// In es, this message translates to:
  /// **'Error de conexión'**
  String get wearableStatusError;

  /// No description provided for @wearableStatusPendingApproval.
  ///
  /// In es, this message translates to:
  /// **'Pendiente de aprobación'**
  String get wearableStatusPendingApproval;

  /// No description provided for @activitiesImportedMessage.
  ///
  /// In es, this message translates to:
  /// **'Se importaron {count} actividades.'**
  String activitiesImportedMessage(int count);

  /// No description provided for @webBluetoothUnsupportedTitle.
  ///
  /// In es, this message translates to:
  /// **'Bluetooth no disponible en este navegador'**
  String get webBluetoothUnsupportedTitle;

  /// No description provided for @webBluetoothUnsupportedMessage.
  ///
  /// In es, this message translates to:
  /// **'Para conectar tu rodillo y sensores desde la Web necesitas Google Chrome o Microsoft Edge. El resto de la app funciona con normalidad.'**
  String get webBluetoothUnsupportedMessage;

  /// No description provided for @webBluetoothUseAppMessage.
  ///
  /// In es, this message translates to:
  /// **'Para la mejor experiencia de entrenamiento, usa la app en Android o iOS.'**
  String get webBluetoothUseAppMessage;

  /// No description provided for @openInChromeOrEdgeAction.
  ///
  /// In es, this message translates to:
  /// **'Abre esta página en Chrome o Edge'**
  String get openInChromeOrEdgeAction;

  /// No description provided for @mobileAppRecommendedBanner.
  ///
  /// In es, this message translates to:
  /// **'RidePro ofrece la experiencia completa de entrenamiento en Android e iOS.'**
  String get mobileAppRecommendedBanner;

  /// No description provided for @startTrainingAction.
  ///
  /// In es, this message translates to:
  /// **'Entrenar ahora'**
  String get startTrainingAction;

  /// No description provided for @trainingPageTitle.
  ///
  /// In es, this message translates to:
  /// **'Entrenamiento libre'**
  String get trainingPageTitle;

  /// No description provided for @pauseAction.
  ///
  /// In es, this message translates to:
  /// **'Pausar'**
  String get pauseAction;

  /// No description provided for @resumeAction.
  ///
  /// In es, this message translates to:
  /// **'Reanudar'**
  String get resumeAction;

  /// No description provided for @finishSessionAction.
  ///
  /// In es, this message translates to:
  /// **'Finalizar'**
  String get finishSessionAction;

  /// No description provided for @finishSessionConfirmTitle.
  ///
  /// In es, this message translates to:
  /// **'Finalizar sesión'**
  String get finishSessionConfirmTitle;

  /// No description provided for @finishSessionConfirmMessage.
  ///
  /// In es, this message translates to:
  /// **'¿Seguro que quieres terminar el entrenamiento?'**
  String get finishSessionConfirmMessage;

  /// No description provided for @noDevicesConnectedHint.
  ///
  /// In es, this message translates to:
  /// **'No tienes dispositivos conectados — puedes entrenar igual, pero sin datos de velocidad, potencia o cadencia.'**
  String get noDevicesConnectedHint;

  /// No description provided for @connectDevicesAction.
  ///
  /// In es, this message translates to:
  /// **'Conectar dispositivos'**
  String get connectDevicesAction;

  /// No description provided for @metricSpeedLabel.
  ///
  /// In es, this message translates to:
  /// **'Velocidad'**
  String get metricSpeedLabel;

  /// No description provided for @metricPowerLabel.
  ///
  /// In es, this message translates to:
  /// **'Potencia'**
  String get metricPowerLabel;

  /// No description provided for @metricCadenceLabel.
  ///
  /// In es, this message translates to:
  /// **'Cadencia'**
  String get metricCadenceLabel;

  /// No description provided for @metricHeartRateLabel.
  ///
  /// In es, this message translates to:
  /// **'Frec. cardíaca'**
  String get metricHeartRateLabel;

  /// No description provided for @metricDistanceLabel.
  ///
  /// In es, this message translates to:
  /// **'Distancia'**
  String get metricDistanceLabel;

  /// No description provided for @metricCaloriesLabel.
  ///
  /// In es, this message translates to:
  /// **'Calorías'**
  String get metricCaloriesLabel;

  /// No description provided for @metricTimeLabel.
  ///
  /// In es, this message translates to:
  /// **'Tiempo'**
  String get metricTimeLabel;

  /// No description provided for @sessionSummaryTitle.
  ///
  /// In es, this message translates to:
  /// **'Resumen de la sesión'**
  String get sessionSummaryTitle;

  /// No description provided for @sessionSummarySubtitle.
  ///
  /// In es, this message translates to:
  /// **'¡Buen trabajo!'**
  String get sessionSummarySubtitle;

  /// No description provided for @lastReadingsLabel.
  ///
  /// In es, this message translates to:
  /// **'Últimas lecturas'**
  String get lastReadingsLabel;

  /// No description provided for @noReadingsMessage.
  ///
  /// In es, this message translates to:
  /// **'Sin lecturas registradas (sin dispositivos conectados durante la sesión).'**
  String get noReadingsMessage;

  /// No description provided for @backToHomeAction.
  ///
  /// In es, this message translates to:
  /// **'Volver a inicio'**
  String get backToHomeAction;

  /// No description provided for @devicesUsedLabel.
  ///
  /// In es, this message translates to:
  /// **'{count} dispositivo(s) conectado(s) durante la sesión'**
  String devicesUsedLabel(int count);

  /// No description provided for @savingSessionLabel.
  ///
  /// In es, this message translates to:
  /// **'Guardando…'**
  String get savingSessionLabel;

  /// No description provided for @sessionSavedLabel.
  ///
  /// In es, this message translates to:
  /// **'Guardado'**
  String get sessionSavedLabel;

  /// No description provided for @sessionSaveErrorLabel.
  ///
  /// In es, this message translates to:
  /// **'No se pudo guardar (sin conexión). Tus datos siguen aquí en pantalla.'**
  String get sessionSaveErrorLabel;

  /// No description provided for @rideHistoryTitle.
  ///
  /// In es, this message translates to:
  /// **'Historial de entrenamientos'**
  String get rideHistoryTitle;

  /// No description provided for @noSessionsYetMessage.
  ///
  /// In es, this message translates to:
  /// **'Aún no tienes sesiones guardadas. ¡Termina tu primer entrenamiento para verlo aquí!'**
  String get noSessionsYetMessage;

  /// No description provided for @offlineBannerMessage.
  ///
  /// In es, this message translates to:
  /// **'Sin conexión — tus cambios se guardarán y sincronizarán automáticamente.'**
  String get offlineBannerMessage;

  /// No description provided for @syncingBannerMessage.
  ///
  /// In es, this message translates to:
  /// **'Sincronizando cambios pendientes…'**
  String get syncingBannerMessage;

  /// No description provided for @recoverSessionTitle.
  ///
  /// In es, this message translates to:
  /// **'Sesión sin finalizar encontrada'**
  String get recoverSessionTitle;

  /// No description provided for @recoverSessionMessage.
  ///
  /// In es, this message translates to:
  /// **'Tenías una sesión de {duration} y {distanceKm} km que no se finalizó (la app se cerró inesperadamente). ¿Quieres continuarla?'**
  String recoverSessionMessage(String duration, String distanceKm);

  /// No description provided for @discardSessionAction.
  ///
  /// In es, this message translates to:
  /// **'Descartar'**
  String get discardSessionAction;

  /// No description provided for @resumeSessionAction.
  ///
  /// In es, this message translates to:
  /// **'Continuar sesión'**
  String get resumeSessionAction;

  /// No description provided for @statisticsTitle.
  ///
  /// In es, this message translates to:
  /// **'Estadísticas'**
  String get statisticsTitle;

  /// No description provided for @weeklyActivityLabel.
  ///
  /// In es, this message translates to:
  /// **'Actividad de la semana'**
  String get weeklyActivityLabel;

  /// No description provided for @personalRecordsLabel.
  ///
  /// In es, this message translates to:
  /// **'Récords personales'**
  String get personalRecordsLabel;

  /// No description provided for @longestSessionLabel.
  ///
  /// In es, this message translates to:
  /// **'Sesión más larga'**
  String get longestSessionLabel;

  /// No description provided for @totalSessionsLabel.
  ///
  /// In es, this message translates to:
  /// **'{count} sesiones registradas'**
  String totalSessionsLabel(int count);

  /// No description provided for @streakLabel.
  ///
  /// In es, this message translates to:
  /// **'¡{days} días seguidos entrenando!'**
  String streakLabel(int days);

  /// No description provided for @achievementsTitle.
  ///
  /// In es, this message translates to:
  /// **'Logros'**
  String get achievementsTitle;

  /// No description provided for @achievementsProgressLabel.
  ///
  /// In es, this message translates to:
  /// **'{unlocked} de {total} desbloqueados'**
  String achievementsProgressLabel(int unlocked, int total);

  /// No description provided for @showPasswordAction.
  ///
  /// In es, this message translates to:
  /// **'Mostrar contraseña'**
  String get showPasswordAction;

  /// No description provided for @hidePasswordAction.
  ///
  /// In es, this message translates to:
  /// **'Ocultar contraseña'**
  String get hidePasswordAction;

  /// No description provided for @noSignalLabel.
  ///
  /// In es, this message translates to:
  /// **'Sin señal'**
  String get noSignalLabel;

  /// No description provided for @routesCatalogTitle.
  ///
  /// In es, this message translates to:
  /// **'Catálogo de rutas'**
  String get routesCatalogTitle;

  /// No description provided for @routeDetailTitle.
  ///
  /// In es, this message translates to:
  /// **'Detalle de ruta'**
  String get routeDetailTitle;

  /// No description provided for @noRoutesAvailableMessage.
  ///
  /// In es, this message translates to:
  /// **'No hay rutas disponibles por ahora.'**
  String get noRoutesAvailableMessage;

  /// No description provided for @routeDifficultyEasy.
  ///
  /// In es, this message translates to:
  /// **'Fácil'**
  String get routeDifficultyEasy;

  /// No description provided for @routeDifficultyModerate.
  ///
  /// In es, this message translates to:
  /// **'Moderada'**
  String get routeDifficultyModerate;

  /// No description provided for @routeDifficultyHard.
  ///
  /// In es, this message translates to:
  /// **'Difícil'**
  String get routeDifficultyHard;

  /// No description provided for @routeDifficultyExtreme.
  ///
  /// In es, this message translates to:
  /// **'Extrema'**
  String get routeDifficultyExtreme;

  /// No description provided for @routeContentVideo.
  ///
  /// In es, this message translates to:
  /// **'Video'**
  String get routeContentVideo;

  /// No description provided for @routeContentTerrain3d.
  ///
  /// In es, this message translates to:
  /// **'Terreno 3D'**
  String get routeContentTerrain3d;

  /// No description provided for @startTrainingOnRouteAction.
  ///
  /// In es, this message translates to:
  /// **'Entrenar esta ruta'**
  String get startTrainingOnRouteAction;

  /// No description provided for @routeTrainingNote.
  ///
  /// In es, this message translates to:
  /// **'El entrenamiento con esta ruta específica (video/3D sincronizado) llega en un módulo futuro — por ahora inicia una sesión libre.'**
  String get routeTrainingNote;

  /// No description provided for @settingsTitle.
  ///
  /// In es, this message translates to:
  /// **'Configuración'**
  String get settingsTitle;

  /// No description provided for @appearanceSectionTitle.
  ///
  /// In es, this message translates to:
  /// **'Apariencia'**
  String get appearanceSectionTitle;

  /// No description provided for @themeSystemAction.
  ///
  /// In es, this message translates to:
  /// **'Seguir el sistema'**
  String get themeSystemAction;

  /// No description provided for @themeLightAction.
  ///
  /// In es, this message translates to:
  /// **'Claro'**
  String get themeLightAction;

  /// No description provided for @themeDarkAction.
  ///
  /// In es, this message translates to:
  /// **'Oscuro'**
  String get themeDarkAction;

  /// No description provided for @languageSectionTitle.
  ///
  /// In es, this message translates to:
  /// **'Idioma'**
  String get languageSectionTitle;

  /// No description provided for @languageSystemAction.
  ///
  /// In es, this message translates to:
  /// **'Seguir el sistema'**
  String get languageSystemAction;

  /// No description provided for @otherSectionTitle.
  ///
  /// In es, this message translates to:
  /// **'Otros'**
  String get otherSectionTitle;

  /// No description provided for @unitsLabel.
  ///
  /// In es, this message translates to:
  /// **'Unidades'**
  String get unitsLabel;

  /// No description provided for @unitsMetricValue.
  ///
  /// In es, this message translates to:
  /// **'Métrico (km, kg)'**
  String get unitsMetricValue;

  /// No description provided for @notificationsLabel.
  ///
  /// In es, this message translates to:
  /// **'Notificaciones'**
  String get notificationsLabel;

  /// No description provided for @notificationsEnabledValue.
  ///
  /// In es, this message translates to:
  /// **'Activadas'**
  String get notificationsEnabledValue;

  /// No description provided for @exploreCatalogHint.
  ///
  /// In es, this message translates to:
  /// **'Explora el catálogo completo'**
  String get exploreCatalogHint;
}

class _AppLocalizationsDelegate
    extends LocalizationsDelegate<AppLocalizations> {
  const _AppLocalizationsDelegate();

  @override
  Future<AppLocalizations> load(Locale locale) {
    return SynchronousFuture<AppLocalizations>(lookupAppLocalizations(locale));
  }

  @override
  bool isSupported(Locale locale) =>
      <String>['en', 'es'].contains(locale.languageCode);

  @override
  bool shouldReload(_AppLocalizationsDelegate old) => false;
}

AppLocalizations lookupAppLocalizations(Locale locale) {
  // Lookup logic when only language code is specified.
  switch (locale.languageCode) {
    case 'en':
      return AppLocalizationsEn();
    case 'es':
      return AppLocalizationsEs();
  }

  throw FlutterError(
      'AppLocalizations.delegate failed to load unsupported locale "$locale". This is likely '
      'an issue with the localizations generation tool. Please file an issue '
      'on GitHub with a reproducible sample app and the gen-l10n configuration '
      'that was used.');
}
