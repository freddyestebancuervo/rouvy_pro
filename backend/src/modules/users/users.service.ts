import { HttpStatus, Injectable } from '@nestjs/common';
import { ApiException } from '../../common/exceptions/api.exception';
import { RefreshTokensRepository } from '../refresh-tokens/refresh-tokens.repository';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UserRecord, UsersRepository } from './users.repository';

export interface UserProfileResponse {
  id: string;
  email: string;
  displayName: string;
  photoUrl: string | null;
  ftp: number | null;
  weightKg: number | null;
  premium: boolean;
  role: string;
  createdAt: Date;
}

/**
 * La spec (sección 1.2, `GET /users/me`) expone un único `role` (string),
 * pero el esquema real (`migrations/0001_init.sql`, `user_roles`) es
 * many-to-many — un usuario puede tener varios. Se resuelve tomando el de
 * mayor privilegio, en vez de, por ejemplo, el primero que devuelva la
 * query (no determinístico). Decisión documentada, no un dato literal del
 * contrato — hoy en la práctica todo usuario tiene exactamente un rol
 * (`register` solo asigna `'user'`), así que no cambia el comportamiento
 * observable todavía.
 */
const ROLE_PRIORITY = ['admin', 'coach', 'premium', 'user'];

function resolvePrimaryRole(roles: string[]): string {
  return ROLE_PRIORITY.find((role) => roles.includes(role)) ?? 'user';
}

const USER_NOT_FOUND = (): ApiException =>
  new ApiException(
    HttpStatus.UNAUTHORIZED,
    'AUTH_TOKEN_MISSING_OR_INVALID',
    'La cuenta asociada a este token ya no existe.',
  );

@Injectable()
export class UsersService {
  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly refreshTokensRepository: RefreshTokensRepository,
  ) {}

  async getProfile(userId: string): Promise<UserProfileResponse> {
    const user = await this.usersRepository.findById(userId);
    // El JWT puede seguir siendo válido (hasta 1h) para una cuenta
    // borrada (soft delete) desde otra sesión — mismo código que "token
    // inválido", no hay nada más específico que revelarle al cliente.
    if (!user) {
      throw USER_NOT_FOUND();
    }
    return this.toResponse(user);
  }

  async updateProfile(userId: string, dto: UpdateProfileDto): Promise<UserProfileResponse> {
    const updated = await this.usersRepository.updateProfile(userId, {
      displayName: dto.displayName,
      ftp: dto.ftp,
      weightKg: dto.weightKg,
    });
    if (!updated) {
      throw USER_NOT_FOUND();
    }
    return this.toResponse(updated);
  }

  /** Revoca todos los refresh tokens de inmediato (spec 1.2/5.6) — el
   * borrado físico de datos, pasado el período de gracia, es un job en
   * segundo plano fuera del alcance de este endpoint. */
  async deleteAccount(userId: string): Promise<void> {
    await this.usersRepository.softDelete(userId);
    await this.refreshTokensRepository.revokeAllForUser(userId);
  }

  private async toResponse(user: UserRecord): Promise<UserProfileResponse> {
    const roles = await this.usersRepository.findRoleNames(user.id);
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      photoUrl: user.photoUrl,
      ftp: user.ftp,
      // `pg` devuelve NUMERIC como string por defecto (evita pérdida de
      // precisión silenciosa) — se convierte acá, en el borde de salida
      // hacia el contrato JSON de la spec.
      weightKg: user.weightKg === null ? null : Number(user.weightKg),
      premium: user.premium,
      role: resolvePrimaryRole(roles),
      createdAt: user.createdAt,
    };
  }
}
