import '../../domain/entities/user_entity.dart';

/// [UserModel] pertenece a la capa `data`: sabe convertirse desde/hacia
/// Firestore. La capa `domain` solo conoce [UserEntity] (sin `fromJson`/
/// `toJson`), lo que evita que reglas de negocio dependan del formato de
/// persistencia.
class UserModel extends UserEntity {
  const UserModel({
    required super.id,
    required super.email,
    required super.displayName,
    super.photoUrl,
    super.ftp,
    super.weightKg,
    super.premium,
    super.role,
    super.emailVerified,
    super.providerType,
  });

  factory UserModel.fromMap(
    Map<String, dynamic> map,
    String documentId, {
    required bool emailVerified,
    required AuthProviderType providerType,
  }) {
    return UserModel(
      id: documentId,
      email: map['email'] as String? ?? '',
      displayName: map['displayName'] as String? ?? '',
      photoUrl: map['photoUrl'] as String?,
      ftp: map['ftp'] as int?,
      weightKg: (map['weightKg'] as num?)?.toDouble(),
      premium: map['premium'] as bool? ?? false,
      // Documentos anteriores a la tarea A2 (roadmap) no tienen este
      // campo todavía — `UserRole.fromRaw(null)` cae a `UserRole.user`
      // de forma segura hasta que corra el script de backfill.
      role: UserRole.fromRaw(map['role'] as String?),
      emailVerified: emailVerified,
      providerType: providerType,
    );
  }

  factory UserModel.fromEntity(UserEntity entity) {
    return UserModel(
      id: entity.id,
      email: entity.email,
      displayName: entity.displayName,
      photoUrl: entity.photoUrl,
      ftp: entity.ftp,
      weightKg: entity.weightKg,
      premium: entity.premium,
      role: entity.role,
      emailVerified: entity.emailVerified,
      providerType: entity.providerType,
    );
  }

  /// Solo los campos que el CLIENTE tiene permitido escribir.
  ///
  /// `role` se lee (ver `fromMap`) pero NUNCA se incluye aquí — es de
  /// solo lectura desde la app por diseño (ver el docblock de
  /// `UserEntity.copyWith`). Si `role` apareciera en este mapa, un
  /// `set(..., merge: true)` desde `updateProfile()` podría sobrescribirlo
  /// aunque las reglas de seguridad de Firestore también lo bloqueen —
  /// dos capas de protección independientes son mejor que confiar solo en
  /// una. `emailVerified` y `providerType` tampoco se incluyen: se derivan
  /// de `FirebaseAuth.currentUser` en cada lectura, no se duplican en el
  /// documento para evitar que queden desincronizados.
  Map<String, dynamic> toMap() {
    return <String, dynamic>{
      'email': email,
      'displayName': displayName,
      'photoUrl': photoUrl,
      'ftp': ftp,
      'weightKg': weightKg,
      'premium': premium,
    };
  }
}
