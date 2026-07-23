// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for English (`en`).
class AppLocalizationsEn extends AppLocalizations {
  AppLocalizationsEn([String locale = 'en']) : super(locale);

  @override
  String get appName => 'RidePro';

  @override
  String get welcomeTitle => 'Train like never before';

  @override
  String get welcomeSubtitle =>
      'Real-world routes, live multiplayer and AI training plans — all in a faster app.';

  @override
  String get welcomeCreateAccount => 'Create account';

  @override
  String get welcomeLogin => 'I already have an account';

  @override
  String get loginTitle => 'Welcome back';

  @override
  String get loginSubtitle => 'Sign in to keep training';

  @override
  String get emailLabel => 'Email';

  @override
  String get passwordLabel => 'Password';

  @override
  String get confirmPasswordLabel => 'Confirm password';

  @override
  String get loginButton => 'Sign in';

  @override
  String get noAccountText => 'Don\'t have an account?';

  @override
  String get createAccountLink => 'Create account';

  @override
  String get forgotPasswordLink => 'Forgot your password?';

  @override
  String get orDividerText => 'or';

  @override
  String get continueWithGoogle => 'Continue with Google';

  @override
  String get continueWithApple => 'Continue with Apple';

  @override
  String get registerTitle => 'Create your account';

  @override
  String get registerSubtitle => 'Start training in minutes';

  @override
  String get nameLabel => 'Name';

  @override
  String get registerButton => 'Sign up';

  @override
  String get hasAccountText => 'Already have an account?';

  @override
  String get loginLink => 'Sign in';

  @override
  String get termsAcceptText =>
      'By signing up you accept the Terms and Privacy Policy';

  @override
  String get forgotPasswordTitle => 'Reset your password';

  @override
  String get forgotPasswordSubtitle =>
      'We\'ll send a link to your email to reset it';

  @override
  String get sendResetLinkButton => 'Send link';

  @override
  String get resetLinkSentMessage =>
      'Check your inbox — we sent you a link to reset your password.';

  @override
  String get backToLoginLink => 'Back to sign in';

  @override
  String get verifyEmailTitle => 'Verify your email';

  @override
  String verifyEmailMessage(String email) {
    return 'We sent a confirmation link to $email. Open it to activate your account.';
  }

  @override
  String get resendEmailButton => 'Resend email';

  @override
  String resendEmailCooldown(int seconds) {
    return 'You can resend in ${seconds}s';
  }

  @override
  String get iVerifiedButton => 'I already verified my email';

  @override
  String get emailVerificationSentMessage => 'Verification email sent.';

  @override
  String get useAnotherAccountLink => 'Use another account';

  @override
  String get profileTitle => 'My profile';

  @override
  String get editProfileTitle => 'Edit profile';

  @override
  String get ftpLabel => 'FTP (watts)';

  @override
  String get weightLabel => 'Weight (kg)';

  @override
  String get saveChangesButton => 'Save changes';

  @override
  String get profileUpdatedMessage => 'Profile updated successfully.';

  @override
  String get changePhotoAction => 'Change photo';

  @override
  String get accountSectionTitle => 'Account';

  @override
  String get logoutAction => 'Sign out';

  @override
  String get logoutConfirmTitle => 'Sign out';

  @override
  String get logoutConfirmMessage => 'Are you sure you want to sign out?';

  @override
  String get cancelAction => 'Cancel';

  @override
  String get confirmAction => 'Confirm';

  @override
  String get validationEmailRequired => 'Enter your email';

  @override
  String get validationEmailInvalid => 'Enter a valid email';

  @override
  String get validationPasswordRequired => 'Enter your password';

  @override
  String get validationPasswordTooShort => 'Minimum 8 characters';

  @override
  String get validationPasswordMissingNumber =>
      'Must include at least one number';

  @override
  String get validationPasswordMissingUppercase =>
      'Must include at least one uppercase letter';

  @override
  String get validationNameRequired => 'Enter your name';

  @override
  String get validationNameTooShort => 'Name is too short';

  @override
  String get validationConfirmPasswordMismatch => 'Passwords don\'t match';

  @override
  String homeGreeting(String name) {
    return 'Hi, $name';
  }

  @override
  String get homeTodaySession => 'Today\'s session';

  @override
  String get homeRecommendedRoutes => 'Recommended routes';

  @override
  String get genericErrorMessage => 'Something went wrong. Please try again.';

  @override
  String get retryAction => 'Retry';

  @override
  String get socialSignInCancelledMessage => 'Sign-in cancelled.';

  @override
  String get deviceManagementTitle => 'Devices';

  @override
  String get connectedDevicesSection => 'Connected';

  @override
  String get availableDevicesSection => 'Available devices';

  @override
  String get scanForDevicesButton => 'Scan for devices';

  @override
  String get stopScanButton => 'Stop scanning';

  @override
  String get scanningInProgressMessage => 'Scanning for nearby devices…';

  @override
  String get noDevicesFoundMessage =>
      'No devices found. Make sure they\'re powered on and nearby.';

  @override
  String get noConnectedDevicesMessage =>
      'You don\'t have any connected devices yet.';

  @override
  String get connectAction => 'Connect';

  @override
  String get disconnectAction => 'Disconnect';

  @override
  String get forgetDeviceAction => 'Forget device';

  @override
  String get forgetDeviceConfirmTitle => 'Forget device';

  @override
  String get forgetDeviceConfirmMessage =>
      'It will be removed from your saved devices and won\'t auto-reconnect. Continue?';

  @override
  String get autoReconnectLabel => 'Auto-reconnect';

  @override
  String get bluetoothOffMessage =>
      'Bluetooth is off. Turn it on to scan for devices.';

  @override
  String get permissionsRequiredTitle => 'Bluetooth permissions needed';

  @override
  String get permissionsRequiredMessage =>
      'RidePro needs Bluetooth permission to connect to your trainer and sensors.';

  @override
  String get grantPermissionAction => 'Grant permission';

  @override
  String get openSettingsAction => 'Open settings';

  @override
  String get deviceTypeSmartTrainer => 'Smart trainer';

  @override
  String get deviceTypePowerMeter => 'Power meter';

  @override
  String get deviceTypeHeartRateMonitor => 'Heart rate monitor';

  @override
  String get deviceTypeCadenceSensor => 'Cadence sensor';

  @override
  String get deviceTypeSpeedSensor => 'Speed sensor';

  @override
  String get deviceTypeSpeedCadenceCombo => 'Speed/cadence sensor';

  @override
  String get deviceTypeUnknown => 'Device';

  @override
  String get statusConnected => 'Connected';

  @override
  String get statusConnecting => 'Connecting…';

  @override
  String get statusReconnecting => 'Reconnecting…';

  @override
  String get statusDisconnected => 'Disconnected';

  @override
  String get statusConnectionFailed => 'Connection failed';

  @override
  String get statusScanning => 'Scanning…';

  @override
  String get signalExcellent => 'Excellent signal';

  @override
  String get signalGood => 'Good signal';

  @override
  String get signalWeak => 'Weak signal';

  @override
  String get signalVeryWeak => 'Very weak signal';

  @override
  String get batteryLabel => 'Battery';

  @override
  String get liveSpeedLabel => 'Spd';

  @override
  String get livePowerLabel => 'Pwr';

  @override
  String get liveCadenceLabel => 'Cad';

  @override
  String get liveHeartRateLabel => 'HR';

  @override
  String get manageDevicesMenuLabel => 'Connected devices';

  @override
  String get wearablesTitle => 'Watches & health apps';

  @override
  String get wearablesMenuLabel => 'Watches & health apps';

  @override
  String get wearableConnectAction => 'Connect';

  @override
  String get wearableDisconnectAction => 'Disconnect';

  @override
  String get wearableImportAction => 'Import activities';

  @override
  String get wearableSimulatedBadge => 'Simulated — pending official approval';

  @override
  String wearableLastSyncLabel(String date) {
    return 'Last synced: $date';
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
  String get wearableStatusNotConnected => 'Not connected';

  @override
  String get wearableStatusConnecting => 'Connecting…';

  @override
  String get wearableStatusConnected => 'Connected';

  @override
  String get wearableStatusSyncing => 'Syncing…';

  @override
  String get wearableStatusError => 'Connection error';

  @override
  String get wearableStatusPendingApproval => 'Pending approval';

  @override
  String activitiesImportedMessage(int count) {
    return '$count activities imported.';
  }

  @override
  String get webBluetoothUnsupportedTitle =>
      'Bluetooth unavailable in this browser';

  @override
  String get webBluetoothUnsupportedMessage =>
      'To connect your trainer and sensors from the Web you need Google Chrome or Microsoft Edge. The rest of the app works normally.';

  @override
  String get webBluetoothUseAppMessage =>
      'For the best training experience, use the app on Android or iOS.';

  @override
  String get openInChromeOrEdgeAction => 'Open this page in Chrome or Edge';

  @override
  String get mobileAppRecommendedBanner =>
      'RidePro offers the full training experience on Android and iOS.';

  @override
  String get startTrainingAction => 'Train now';

  @override
  String get trainingPageTitle => 'Free training';

  @override
  String get pauseAction => 'Pause';

  @override
  String get resumeAction => 'Resume';

  @override
  String get finishSessionAction => 'Finish';

  @override
  String get finishSessionConfirmTitle => 'Finish session';

  @override
  String get finishSessionConfirmMessage =>
      'Are you sure you want to end the workout?';

  @override
  String get noDevicesConnectedHint =>
      'You don\'t have any devices connected — you can still train, but without speed, power or cadence data.';

  @override
  String get connectDevicesAction => 'Connect devices';

  @override
  String get metricSpeedLabel => 'Speed';

  @override
  String get metricPowerLabel => 'Power';

  @override
  String get metricCadenceLabel => 'Cadence';

  @override
  String get metricHeartRateLabel => 'Heart rate';

  @override
  String get metricDistanceLabel => 'Distance';

  @override
  String get metricCaloriesLabel => 'Calories';

  @override
  String get metricTimeLabel => 'Time';

  @override
  String get sessionSummaryTitle => 'Session summary';

  @override
  String get sessionSummarySubtitle => 'Great work!';

  @override
  String get lastReadingsLabel => 'Last readings';

  @override
  String get noReadingsMessage =>
      'No readings recorded (no devices were connected during the session).';

  @override
  String get backToHomeAction => 'Back to home';

  @override
  String devicesUsedLabel(int count) {
    return '$count device(s) connected during the session';
  }

  @override
  String get savingSessionLabel => 'Saving…';

  @override
  String get sessionSavedLabel => 'Saved';

  @override
  String get sessionSaveErrorLabel =>
      'Couldn\'t save (offline). Your data is still shown here.';

  @override
  String get rideHistoryTitle => 'Training history';

  @override
  String get noSessionsYetMessage =>
      'No saved sessions yet. Finish your first workout to see it here!';

  @override
  String get offlineBannerMessage =>
      'You\'re offline — your changes will be saved and synced automatically.';

  @override
  String get syncingBannerMessage => 'Syncing pending changes…';

  @override
  String get recoverSessionTitle => 'Unfinished session found';

  @override
  String recoverSessionMessage(String duration, String distanceKm) {
    return 'You had a $duration, $distanceKm km session that wasn\'t finished (the app closed unexpectedly). Continue it?';
  }

  @override
  String get discardSessionAction => 'Discard';

  @override
  String get resumeSessionAction => 'Resume session';

  @override
  String get statisticsTitle => 'Statistics';

  @override
  String get weeklyActivityLabel => 'This week\'s activity';

  @override
  String get personalRecordsLabel => 'Personal records';

  @override
  String get longestSessionLabel => 'Longest session';

  @override
  String totalSessionsLabel(int count) {
    return '$count sessions logged';
  }

  @override
  String streakLabel(int days) {
    return '$days days in a row training!';
  }

  @override
  String get achievementsTitle => 'Achievements';

  @override
  String achievementsProgressLabel(int unlocked, int total) {
    return '$unlocked of $total unlocked';
  }

  @override
  String get showPasswordAction => 'Show password';

  @override
  String get hidePasswordAction => 'Hide password';

  @override
  String get noSignalLabel => 'No signal';

  @override
  String get routesCatalogTitle => 'Route catalog';

  @override
  String get routeDetailTitle => 'Route detail';

  @override
  String get noRoutesAvailableMessage => 'No routes available right now.';

  @override
  String get routeDifficultyEasy => 'Easy';

  @override
  String get routeDifficultyModerate => 'Moderate';

  @override
  String get routeDifficultyHard => 'Hard';

  @override
  String get routeDifficultyExtreme => 'Extreme';

  @override
  String get routeContentVideo => 'Video';

  @override
  String get routeContentTerrain3d => '3D terrain';

  @override
  String get startTrainingOnRouteAction => 'Train this route';

  @override
  String get routeTrainingNote =>
      'Training on this specific route (synchronized video/3D) is coming in a future module — for now it starts a free session.';

  @override
  String get settingsTitle => 'Settings';

  @override
  String get appearanceSectionTitle => 'Appearance';

  @override
  String get themeSystemAction => 'Follow system';

  @override
  String get themeLightAction => 'Light';

  @override
  String get themeDarkAction => 'Dark';

  @override
  String get languageSectionTitle => 'Language';

  @override
  String get languageSystemAction => 'Follow system';

  @override
  String get otherSectionTitle => 'Other';

  @override
  String get unitsLabel => 'Units';

  @override
  String get unitsMetricValue => 'Metric (km, kg)';

  @override
  String get notificationsLabel => 'Notifications';

  @override
  String get notificationsEnabledValue => 'Enabled';

  @override
  String get exploreCatalogHint => 'Explore the full catalog';

  @override
  String get workoutsTitle => 'Workouts';

  @override
  String get workoutsHomeHint => 'Create and explore your workouts';

  @override
  String get workoutsMineFilterLabel => 'Mine';

  @override
  String get workoutsAllFilterLabel => 'All';

  @override
  String get noWorkoutsAvailableMessage => 'No workouts available yet.';

  @override
  String get newWorkoutAction => 'New workout';

  @override
  String get workoutDetailTitle => 'Workout detail';

  @override
  String get workoutIntervalsTitle => 'Intervals';

  @override
  String workoutIntervalsCount(int count) {
    return '$count intervals';
  }

  @override
  String get workoutEstimatedDurationLabel => 'Estimated duration';

  @override
  String get workoutTargetTypeLabel => 'Target type';

  @override
  String get workoutTargetTypePower => 'Power (%FTP)';

  @override
  String get workoutTargetTypeHeartRate => 'Heart rate';

  @override
  String get workoutTargetTypeNone => 'Free';

  @override
  String get workoutPublicLabel => 'Public';

  @override
  String get workoutPrivateLabel => 'Private';

  @override
  String get workoutCatalogLabel => 'Catalog';

  @override
  String get workoutArchivedLabel => 'Archived';

  @override
  String get createWorkoutTitle => 'Create workout';

  @override
  String get editWorkoutTitle => 'Edit workout';

  @override
  String get workoutDescriptionLabel => 'Description (optional)';

  @override
  String get workoutPublicSwitchLabel => 'Make public';

  @override
  String get workoutPublicSwitchHint =>
      'Other users will be able to view it, but not edit it.';

  @override
  String get addIntervalAction => 'Add interval';

  @override
  String get removeAction => 'Remove';

  @override
  String intervalNumberLabel(int number) {
    return 'Interval $number';
  }

  @override
  String get intervalDurationLabel => 'Duration (seconds)';

  @override
  String get intervalTargetLowLabel => 'Target minimum';

  @override
  String get intervalTargetHighLabel => 'Target maximum';

  @override
  String get intervalLabelLabel => 'Label (optional)';

  @override
  String get createWorkoutButton => 'Create workout';

  @override
  String get archiveWorkoutAction => 'Archive';

  @override
  String get archiveWorkoutConfirmTitle => 'Archive this workout?';

  @override
  String get archiveWorkoutConfirmMessage =>
      'You\'ll still be able to view it, but no longer edit it.';

  @override
  String get workoutArchivedSuccessMessage => 'Workout archived.';

  @override
  String get workoutCreatedSuccessMessage => 'Workout created.';

  @override
  String get workoutUpdatedSuccessMessage => 'Workout updated.';

  @override
  String get workoutReadOnlyNotice =>
      'This workout isn\'t yours — you can only view it.';

  @override
  String get workoutArchivedNotice =>
      'This workout is archived and can\'t be edited.';

  @override
  String get backendSessionUnavailableMessage =>
      'Couldn\'t connect to the workouts backend. Check your connection and try again.';

  @override
  String get validationAtLeastOneInterval => 'Add at least one interval.';

  @override
  String get validationDurationRequired =>
      'Enter a valid duration (1 to 36000 seconds).';

  @override
  String get validationTargetRangeInvalid =>
      'The minimum target can\'t be greater than the maximum.';
}
