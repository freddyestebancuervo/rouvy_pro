import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthResponse, AuthService, RefreshResponse } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { RegisterDto } from './dto/register.dto';
import { RefreshThrottleGuard } from './refresh-throttle.guard';

// 5 req / 15 min / IP — spec sección 1.2, tabla de `POST /auth/register`.
const AUTH_THROTTLE = { default: { limit: 5, ttl: 15 * 60 * 1000 } };

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
}
