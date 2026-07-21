import 'package:equatable/equatable.dart';

/// Proveedor con el que el usuario inició sesión. Determina reglas de
/// negocio como: ¿debe pasar por la pantalla de verificación de correo?
/// (password sí, google/apple no — sus correos ya vienen verificados).
enum AuthProviderType { password, google, apple }

/// Rol del usuario — ver `ROADMAP_M0_M1.md` tarea A2 y
/// `docs/TECHNICAL_SPECIFICATION_M0_M1.md` sección 4 (matriz de permisos
/// completa). Jerarquía ADITIVA: cada rol incluye las capacidades de los
/// anteriores (un `coach` puede todo lo que un `premium`, etc.) — la
/// lógica de qué puede hacer cada uno vive donde se consulte el rol
/// (guards de rutas, visibilidad de UI), NUNCA en esta clase, que es solo
/// el dato.
enum UserRole {
  user,
  premium,
  coach,
  admin;

  /// Traduce el string crudo guardado en Firestore (`role` field) a este
  /// enum. Cualquier valor desconocido o ausente cae a [user] — el rol
  /// más restrictivo, nunca al revés (fallar hacia menos privilegios,
  /// no hacia más, si el dato viniera corrupto o de una versión de
  /// esquema más nueva que este cliente no reconoce todavía).
  static UserRole fromRaw(String? raw) {
    return UserRole.values.firstWhere(
      (UserRole r) => r.name == raw,
      orElse: () => UserRole.user,
    );
  }
}

/// Entidad pura del dominio. No sabe nada de Firebase, JSON ni HTTP — es el
/// modelo que usan los `usecases` y la capa de `presentation`.
class UserEntity extends Equatable {
  const UserEntity({
    required this.id,
    required this.email,
    required this.displayName,
    this.photoUrl,
    this.ftp,
    this.weightKg,
    this.premium = false,
    this.role = UserRole.user,
    this.emailVerified = false,
    this.providerType = AuthProviderType.password,
  });

  final String id;
  final String email;
  final String displayName;
  final String? photoUrl;

  /// Functional Threshold Power — se completa en el onboarding.
  final int? ftp;
  final double? weightKg;

  /// ⚠️ Redundante con [role] a día de hoy (`role: premium` implica
  /// `premium: true`) — se mantiene por compatibilidad con código
  /// existente que ya lo usa. Unificar en una sola fuente de verdad es
  /// tarea pendiente explícita, NO resuelta en A2 (ver
  /// `ROADMAP_M0_M1.md`); hasta entonces, [role] es el campo autoritativo
  /// para cualquier lógica NUEVA de permisos — no leer [premium] en
  /// código nuevo.
  final bool premium;

  final UserRole role;

  /// Si es `false` y [providerType] es `password`, el router redirige a la
  /// pantalla de verificación de correo antes de dejar entrar a la app.
  final bool emailVerified;
  final AuthProviderType providerType;

  /// Los proveedores sociales certifican el correo por su cuenta — nunca se
  /// les exige pasar por la pantalla de verificación propia de la app.
  bool get requiresEmailVerification =>
      providerType == AuthProviderType.password && !emailVerified;

  /// `role` es de SOLO LECTURA desde el cliente por diseño — no existe
  /// (deliberadamente) ningún `copyWith(role: ...)` ni forma de que
  /// `ProfileController.updateProfile()` lo modifique. Solo una Cloud
  /// Function con Admin SDK puede cambiarlo (ver
  /// `firebase/scripts/backfill_user_roles.js` y las reglas de seguridad
  /// en la sección 5.4 de la especificación técnica), reflejando en el
  /// cliente la misma restricción que ya imponen las reglas de Firestore.
  UserEntity copyWith({
    String? displayName,
    String? photoUrl,
    int? ftp,
    double? weightKg,
    bool? emailVerified,
  }) {
    return UserEntity(
      id: id,
      email: email,
      displayName: displayName ?? this.displayName,
      photoUrl: photoUrl ?? this.photoUrl,
      ftp: ftp ?? this.ftp,
      weightKg: weightKg ?? this.weightKg,
      premium: premium,
      role: role,
      emailVerified: emailVerified ?? this.emailVerified,
      providerType: providerType,
    );
  }

  @override
  List<Object?> get props => [
        id,
        email,
        displayName,
        photoUrl,
        ftp,
        weightKg,
        premium,
        role,
        emailVerified,
        providerType,
      ];
}
