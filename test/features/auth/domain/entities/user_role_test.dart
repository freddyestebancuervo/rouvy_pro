import 'package:flutter_test/flutter_test.dart';
import 'package:rouvy_pro/features/auth/domain/entities/user_entity.dart';

void main() {
  group('UserRole.fromRaw', () {
    test('convierte cada string válido a su enum correspondiente', () {
      expect(UserRole.fromRaw('user'), UserRole.user);
      expect(UserRole.fromRaw('premium'), UserRole.premium);
      expect(UserRole.fromRaw('coach'), UserRole.coach);
      expect(UserRole.fromRaw('admin'), UserRole.admin);
    });

    test('cae a UserRole.user cuando el valor es null (documentos previos a A2)', () {
      expect(UserRole.fromRaw(null), UserRole.user);
    });

    test('cae a UserRole.user ante un valor desconocido/corrupto, nunca a uno más privilegiado', () {
      expect(UserRole.fromRaw('superadmin'), UserRole.user);
      expect(UserRole.fromRaw(''), UserRole.user);
    });
  });

  group('UserEntity.role por defecto', () {
    test('un UserEntity construido sin especificar role es UserRole.user', () {
      const UserEntity user = UserEntity(id: '1', email: 'a@b.com', displayName: 'A');
      expect(user.role, UserRole.user);
    });
  });
}
