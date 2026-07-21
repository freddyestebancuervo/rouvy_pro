import 'package:flutter_test/flutter_test.dart';
import 'package:rouvy_pro/features/auth/data/models/user_model.dart';
import 'package:rouvy_pro/features/auth/domain/entities/user_entity.dart';

void main() {
  group('UserModel.fromMap — campo role', () {
    test('lee el rol cuando el documento ya lo tiene', () {
      final UserModel model = UserModel.fromMap(
        const <String, dynamic>{'email': 'coach@ridepro.com', 'displayName': 'Coach', 'role': 'coach'},
        'uid-1',
        emailVerified: true,
        providerType: AuthProviderType.password,
      );

      expect(model.role, UserRole.coach);
    });

    test('usa UserRole.user cuando el documento es anterior a la tarea A2 (sin campo role)', () {
      final UserModel model = UserModel.fromMap(
        const <String, dynamic>{'email': 'legacy@ridepro.com', 'displayName': 'Legacy'},
        'uid-2',
        emailVerified: true,
        providerType: AuthProviderType.password,
      );

      expect(model.role, UserRole.user);
    });
  });

  group('UserModel.toMap — role NUNCA se incluye', () {
    test('el mapa de escritura no contiene la clave "role" aunque el modelo tenga un rol elevado', () {
      const UserModel adminUser = UserModel(
        id: 'uid-3',
        email: 'admin@ridepro.com',
        displayName: 'Admin',
        role: UserRole.admin,
      );

      final Map<String, dynamic> map = adminUser.toMap();

      expect(map.containsKey('role'), isFalse);
    });
  });
}
