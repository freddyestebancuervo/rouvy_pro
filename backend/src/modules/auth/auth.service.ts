import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { isPgUniqueViolation } from '../../common/database/pg-error.util';
import { ApiException } from '../../common/exceptions/api.exception';
import { TokenService } from '../../jwt/token.service';
import { RefreshTokensRepository } from '../refresh-tokens/refresh-tokens.repository';
import { UserRecord, UsersRepository } from '../users/users.repository';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { RegisterDto } from './dto/register.dto';

const BCRYPT_ROUNDS = 12;

export interface AuthResponse {
  userId: string;
  email: string;
  emailVerified: boolean;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface RefreshResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

const REFRESH_TOKEN_INVALID_OR_REUSED = (): ApiException =>
  new ApiException(
    HttpStatus.UNAUTHORIZED,
    'REFRESH_TOKEN_INVALID_OR_REUSED',
    'El refresh token no es válido, expiró o ya fue usado.',
  );

// Mismo código/mensaje sin importar si el email no existe o la
// contraseña no matchea — evita enumeración de cuentas (spec 5.5), mismo
// principio que `password-reset/request` (siempre 202).
const AUTH_INVALID_CREDENTIALS = (): ApiException =>
  new ApiException(
    HttpStatus.UNAUTHORIZED,
    'AUTH_INVALID_CREDENTIALS',
    'Correo o contraseña incorrectos.',
  );

const EMAIL_ALREADY_EXISTS = (): ApiException =>
  new ApiException(
    HttpStatus.CONFLICT,
    'EMAIL_ALREADY_EXISTS',
    'Ya existe una cuenta con ese correo.',
  );

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly refreshTokensRepository: RefreshTokensRepository,
    private readonly tokenService: TokenService,
  ) {}

  async register(dto: RegisterDto): Promise<AuthResponse> {
    const existing = await this.usersRepository.findByEmail(dto.email);
    if (existing) {
      throw EMAIL_ALREADY_EXISTS();
    }

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);

    let user: UserRecord;
    try {
      user = await this.usersRepository.createWithPassword({
        email: dto.email,
        passwordHash,
        displayName: dto.displayName,
      });
    } catch (error) {
      // El chequeo de arriba tiene una ventana de carrera real: dos
      // registros concurrentes con el mismo email en distinto case
      // ("Rider@x.com"/"rider@x.com") pueden pasar ambos el `findByEmail`
      // antes de que cualquiera haya insertado — el índice único
      // `users_email_lower_unique` (migración 0002) es quien realmente
      // cierra la carrera; acá solo se traduce su `23505` al mismo error
      // de contrato que el chequeo rápido de arriba.
      if (isPgUniqueViolation(error)) {
        throw EMAIL_ALREADY_EXISTS();
      }
      throw error;
    }

    return this.issueSession(user.id, user.email, user.emailVerified, ['user']);
  }

  async login(dto: LoginDto): Promise<AuthResponse> {
    const user = await this.usersRepository.findByEmail(dto.email);

    if (!user || !user.passwordHash) {
      throw AUTH_INVALID_CREDENTIALS();
    }

    const passwordMatches = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordMatches) {
      throw AUTH_INVALID_CREDENTIALS();
    }

    const roles = await this.usersRepository.findRoleNames(user.id);
    return this.issueSession(user.id, user.email, user.emailVerified, roles);
  }

  /**
   * `POST /auth/refresh` — spec sección 5.2. Genera el token nuevo ANTES
   * de intentar la rotación (operación local, sin costo si se descarta) y
   * delega toda la decisión atómica (rotar / detectar reuso / expirado /
   * no encontrado) a `RefreshTokensRepository.rotate`, que corre en una
   * única transacción con row lock — ver el docblock de ese método para
   * el razonamiento de concurrencia.
   */
  async refresh(dto: RefreshDto): Promise<RefreshResponse> {
    const oldTokenHash = this.tokenService.hashRefreshToken(dto.refreshToken);
    const newRefresh = this.tokenService.issueRefreshToken();

    const outcome = await this.refreshTokensRepository.rotate({
      oldTokenHash,
      newTokenHash: newRefresh.hash,
      newExpiresAt: newRefresh.expiresAt,
    });

    if (outcome.status === 'not_found' || outcome.status === 'expired') {
      throw REFRESH_TOKEN_INVALID_OR_REUSED();
    }

    if (outcome.status === 'reused') {
      this.logger.warn(
        `Refresh token reuse detectado para user_id=${outcome.userId} — todos sus refresh tokens activos fueron revocados.`,
      );
      throw REFRESH_TOKEN_INVALID_OR_REUSED();
    }

    const user = await this.usersRepository.findById(outcome.userId);
    if (!user) {
      // El usuario fue borrado entre el lock y esta lectura (soft delete
      // concurrente) — mismo código genérico, no hay nada más específico
      // que comunicarle a un cliente con un refresh token de una cuenta
      // que ya no existe.
      throw REFRESH_TOKEN_INVALID_OR_REUSED();
    }
    const roles = await this.usersRepository.findRoleNames(user.id);

    const accessToken = this.tokenService.signAccessToken({
      userId: user.id,
      roles,
      emailVerified: user.emailVerified,
    });

    return {
      accessToken,
      refreshToken: newRefresh.token,
      expiresIn: this.tokenService.accessTokenExpiresIn,
    };
  }

  private async issueSession(
    userId: string,
    email: string,
    emailVerified: boolean,
    roles: string[],
  ): Promise<AuthResponse> {
    const accessToken = this.tokenService.signAccessToken({
      userId,
      roles,
      emailVerified,
    });
    const refresh = this.tokenService.issueRefreshToken();
    await this.refreshTokensRepository.create({
      userId,
      tokenHash: refresh.hash,
      expiresAt: refresh.expiresAt,
    });

    return {
      userId,
      email,
      emailVerified,
      accessToken,
      refreshToken: refresh.token,
      expiresIn: this.tokenService.accessTokenExpiresIn,
    };
  }
}
