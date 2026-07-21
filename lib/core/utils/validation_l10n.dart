import '../../l10n/generated/app_localizations.dart';
import 'validators.dart';

/// Traduce el resultado puro de `Validators` a un string localizado.
/// Vive separado de `validators.dart` para que ese archivo siga siendo
/// testeable sin necesidad de `AppLocalizations`/`BuildContext`.
extension ValidationErrorL10n on ValidationError {
  String? message(AppLocalizations l10n) {
    switch (this) {
      case ValidationError.none:
        return null;
      case ValidationError.emailRequired:
        return l10n.validationEmailRequired;
      case ValidationError.emailInvalid:
        return l10n.validationEmailInvalid;
      case ValidationError.passwordRequired:
        return l10n.validationPasswordRequired;
      case ValidationError.passwordTooShort:
        return l10n.validationPasswordTooShort;
      case ValidationError.passwordMissingNumber:
        return l10n.validationPasswordMissingNumber;
      case ValidationError.passwordMissingUppercase:
        return l10n.validationPasswordMissingUppercase;
      case ValidationError.nameRequired:
        return l10n.validationNameRequired;
      case ValidationError.nameTooShort:
        return l10n.validationNameTooShort;
      case ValidationError.confirmPasswordMismatch:
        return l10n.validationConfirmPasswordMismatch;
    }
  }
}
