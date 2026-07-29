import { Body, Controller, Headers, HttpCode, HttpStatus, Ip, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthUser } from '../../common/auth/auth-user.interface';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { AuthResponse, AuthService, RefreshResponse } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { LogoutDto } from './dto/logout.dto';
import { RefreshDto } from './dto/refresh.dto';
import { RegisterDto } from './dto/register.dto';
import { FIREBASE_TOKEN_MISSING } from './firebase-exchange.errors';
import { RefreshThrottleGuard } from './refresh-throttle.guard';

// 5 req / 15 min / IP — spec sección 1.2, tabla de `POST /auth/register`.
const AUTH_THROTTLE = { default: { limit: 5, ttl: 15 * 60 * 1000 } };

// Más amplio que login/register (Fase 3 §E, documento de diseño Fase 1):
// el exchange también cubre el camino de recuperación cuando el refresh
// normal falla definitivamente, así que se llama más seguido en uso
// legítimo — no debilita el bucket global (100/60s, `app.module.ts`),
// que se sigue aplicando encima como defensa en profundidad.
// Fase 4.2 Parte 2: subido de 20 a 60 — esta es solo la Capa 1 (IP, sin
// distinguir identidad todavía, porque acá el token puede ser inválido).
// La protección real por identidad ahora vive en `AuthService`
// (Capas 2 y 3, ver `exchangeFirebaseToken`), así que este bucket puede
// ser más generoso sin debilitar la defensa contra abuso por identidad.
const FIREBASE_EXCHANGE_THROTTLE = { default: { limit: 60, ttl: 15 * 60 * 1000 } };

function extractBearerToken(authorization?: string): string {
  if (!authorization?.startsWith('Bearer ')) {
    throw FIREBASE_TOKEN_MISSING();
  }
  const token = authorization.slice('Bearer '.length).trim();
  if (!token) {
    throw FIREBASE_TOKEN_MISSING();
  }
  return token;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @Throttle(AUTH_THROTTLE)
  register(@Body() dto: RegisterDto): Promise<AuthResponse> {
    return this.authService.register(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  // La spec no fija un número exacto para `login` (solo documenta que
  // `429 RATE_LIMITED` es una respuesta posible) — se aplica el mismo
  // límite que `register` por ser el mismo tipo de endpoint público
  // sensible a fuerza bruta (sección 5.5), decisión explícita, no un dato
  // literal del contrato.
  @Throttle(AUTH_THROTTLE)
  login(@Body() dto: LoginDto): Promise<AuthResponse> {
    return this.authService.login(dto);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  // Sin @Throttle/ThrottlerGuard acá — ver RefreshThrottleGuard, el
  // límite de esta ruta es "por token", no por IP.
  @UseGuards(RefreshThrottleGuard)
  refresh(@Body() dto: RefreshDto): Promise<RefreshResponse> {
    return this.authService.refresh(dto);
  }

  /**
   * `POST /auth/firebase/exchange` (Fase 3) — sin body, sin `JwtAuthGuard`
   * (ese guard es exclusivo de tokens YA emitidos por este backend; acá
   * el `Authorization: Bearer` trae un ID token de Firebase, verificado
   * dentro de `AuthService.exchangeFirebaseToken`, no por un guard
   * reutilizable — es la única ruta que acepta ese tipo de token).
   */
  @Post('firebase/exchange')
  @HttpCode(HttpStatus.OK)
  @Throttle(FIREBASE_EXCHANGE_THROTTLE)
  exchangeFirebase(
    @Headers('authorization') authorization: string | undefined,
    @Ip() ip: string,
  ): Promise<AuthResponse> {
    const idToken = extractBearerToken(authorization);
    return this.authService.exchangeFirebaseToken(idToken, ip);
  }

  /** `POST /auth/logout` (Fase 3 §C) — sí protegido por `JwtAuthGuard`
   * (necesita saber de quién es la sesión para no revocar el token de
   * otro usuario, ver `RefreshTokensRepository.revokeOne`). */
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  logout(@CurrentUser() user: AuthUser, @Body() dto: LogoutDto): Promise<void> {
    return this.authService.logout(user.userId, dto.refreshToken);
  }
}
