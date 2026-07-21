import 'package:flutter_test/flutter_test.dart';

import 'package:rouvy_pro/core/utils/validators.dart';

void main() {
  group('Validators.email', () {
    test('rechaza vacío', () {
      expect(Validators.email(''), ValidationError.emailRequired);
    });

    test('rechaza null', () {
      expect(Validators.email(null), ValidationError.emailRequired);
    });

    test('rechaza formato inválido', () {
      expect(Validators.email('no-es-un-correo'), ValidationError.emailInvalid);
      expect(Validators.email('falta@dominio'), ValidationError.emailInvalid);
    });

    test('acepta correo válido', () {
      expect(Validators.email('rider@ridepro.com'), ValidationError.none);
    });
  });

  group('Validators.password', () {
    test('rechaza vacío', () {
      expect(Validators.password(''), ValidationError.passwordRequired);
    });

    test('rechaza menos de 8 caracteres', () {
      expect(Validators.password('Abc123'), ValidationError.passwordTooShort);
    });

    test('rechaza sin número', () {
      expect(Validators.password('Abcdefgh'), ValidationError.passwordMissingNumber);
    });

    test('rechaza sin mayúscula', () {
      expect(Validators.password('abcdefgh1'), ValidationError.passwordMissingUppercase);
    });

    test('acepta contraseña válida', () {
      expect(Validators.password('Abcdefg1'), ValidationError.none);
    });
  });

  group('Validators.confirmPassword', () {
    test('rechaza cuando no coinciden', () {
      expect(Validators.confirmPassword('Abcdefg1', 'Abcdefg2'), ValidationError.confirmPasswordMismatch);
    });

    test('acepta cuando coinciden', () {
      expect(Validators.confirmPassword('Abcdefg1', 'Abcdefg1'), ValidationError.none);
    });
  });

  group('Validators.name', () {
    test('rechaza vacío', () {
      expect(Validators.name(''), ValidationError.nameRequired);
    });

    test('rechaza demasiado corto', () {
      expect(Validators.name('A'), ValidationError.nameTooShort);
    });

    test('acepta nombre válido', () {
      expect(Validators.name('Ana'), ValidationError.none);
    });
  });
}
