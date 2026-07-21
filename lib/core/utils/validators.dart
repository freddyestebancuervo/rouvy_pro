/// Validadores puros (sin dependencia de Flutter ni de contexto de
/// localización) usados por todos los formularios del módulo de auth.
///
/// Devuelven una clave de mensaje en vez de texto — cada pantalla mapea la
/// clave al string localizado correspondiente (`l10n.validationX`). Esto
/// evita que `core/` dependa de `AppLocalizations` (que sí depende de
/// `BuildContext`), manteniendo el validador testeable sin widgets.
enum ValidationError {
  none,
  emailRequired,
  emailInvalid,
  passwordRequired,
  passwordTooShort,
  passwordMissingNumber,
  passwordMissingUppercase,
  nameRequired,
  nameTooShort,
  confirmPasswordMismatch,
}

abstract class Validators {
  static final RegExp _emailRegex =
      RegExp(r'^[\w\.\-\+]+@[\w\-]+\.[\w\-\.]+$');

  static ValidationError email(String? value) {
    if (value == null || value.trim().isEmpty) {
      return ValidationError.emailRequired;
    }
    if (!_emailRegex.hasMatch(value.trim())) {
      return ValidationError.emailInvalid;
    }
    return ValidationError.none;
  }

  /// Política mínima razonable para una app de consumo: 8+ caracteres, al
  /// menos un número y una mayúscula. Se puede endurecer más adelante sin
  /// tocar la UI, ya que las pantallas solo leen el enum resultante.
  static ValidationError password(String? value) {
    if (value == null || value.isEmpty) {
      return ValidationError.passwordRequired;
    }
    if (value.length < 8) return ValidationError.passwordTooShort;
    if (!value.contains(RegExp(r'[0-9]'))) {
      return ValidationError.passwordMissingNumber;
    }
    if (!value.contains(RegExp(r'[A-Z]'))) {
      return ValidationError.passwordMissingUppercase;
    }
    return ValidationError.none;
  }

  static ValidationError confirmPassword(String? password, String? confirmation) {
    if (password != confirmation) return ValidationError.confirmPasswordMismatch;
    return ValidationError.none;
  }

  static ValidationError name(String? value) {
    if (value == null || value.trim().isEmpty) {
      return ValidationError.nameRequired;
    }
    if (value.trim().length < 2) return ValidationError.nameTooShort;
    return ValidationError.none;
  }
}
