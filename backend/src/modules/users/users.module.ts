import { Module } from '@nestjs/common';
import { RefreshTokensModule } from '../refresh-tokens/refresh-tokens.module';
import { UsersController } from './users.controller';
import { UsersRepository } from './users.repository';
import { UsersService } from './users.service';

/**
 * `GET/PATCH/DELETE /users/me` (spec 1.2), protegidos por `JwtAuthGuard`
 * — `UsersRepository` se sigue exportando: `AuthModule` lo necesita para
 * `register`/`login`/`refresh`.
 */
@Module({
  imports: [RefreshTokensModule],
  controllers: [UsersController],
  providers: [UsersRepository, UsersService],
  exports: [UsersRepository],
})
export class UsersModule {}
