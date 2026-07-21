import '../../features/auth/domain/entities/user_entity.dart';

/// Usuario simulado para el modo demo — nunca se usa en producción.
/// `id` empieza con `demo-` a propósito, igual que el prefijo `MOCK-` de
/// las actividades de wearables simuladas: cualquier dato de este archivo
/// debe poder distinguirse de un dato real con solo mirarlo.
const UserEntity demoUserFixture = UserEntity(
  id: 'demo-user-1',
  email: 'demo@ridepro.app',
  displayName: 'Ciclista Demo',
  ftp: 245,
  weightKg: 72.0,
  premium: true,
  role: UserRole.premium,
  emailVerified: true,
  providerType: AuthProviderType.password,
);
