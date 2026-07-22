import { Module } from '@nestjs/common';
import { RefreshTokensModule } from '../refresh-tokens/refresh-tokens.module';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { RefreshThrottleGuard } from './refresh-throttle.guard';

/**
 * `POST /auth/register`, `POST /auth/login` (C3) y `POST /auth/refresh`
 * con rotación + detección de reuso (C4) — contrato de
 * `docs/TECHNICAL_SPECIFICATION_M0_M1.md` sección 1.2 / 5.2. `TokenService`
 * no se provee acá — viene de `JwtModule` (global, ver `src/jwt/`).
 */
@Module({
  imports: [UsersModule, RefreshTokensModule],
  controllers: [AuthController],
  providers: [AuthService, RefreshThrottleGuard],
})
export class AuthModule {}
