import { Module } from '@nestjs/common';
import { FirebaseAdminModule } from '../../firebase/firebase-admin.module';
import { RefreshTokensModule } from '../refresh-tokens/refresh-tokens.module';
import { UsersModule } from '../users/users.module';
import { AuditLogRepository } from './audit-log.repository';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { RefreshThrottleGuard } from './refresh-throttle.guard';

/**
 * `POST /auth/register`, `POST /auth/login` (C3), `POST /auth/refresh`
 * con rotación + detección de reuso (C4), `POST /auth/firebase/exchange`
 * y `POST /auth/logout` (Fase 3 del puente Firebase → NestJS →
 * PostgreSQL) — contrato de `docs/TECHNICAL_SPECIFICATION_M0_M1.md`
 * sección 1.2 / 5.2. `TokenService` no se provee acá — viene de
 * `JwtModule` (global, ver `src/jwt/`).
 */
@Module({
  imports: [UsersModule, RefreshTokensModule, FirebaseAdminModule],
  controllers: [AuthController],
  providers: [AuthService, RefreshThrottleGuard, AuditLogRepository],
})
export class AuthModule {}
