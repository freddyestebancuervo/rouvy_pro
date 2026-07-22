import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { DatabaseModule } from './database/database.module';
import { JwtModule } from './jwt/jwt.module';
import { AuthModule } from './modules/auth/auth.module';
import { EquipmentModule } from './modules/equipment/equipment.module';
import { UsersModule } from './modules/users/users.module';
import { WorkoutsModule } from './modules/workouts/workouts.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),

    // Rate limiting global — ver spec sección 5.5 ("Rate limiting"). Los
    // límites específicos por endpoint (5 req/15min en /auth/register,
    // etc.) se afinan por ruta con `@Throttle()`; esto es solo el límite
    // por defecto de respaldo (por IP) para cualquier endpoint que no lo
    // declare explícitamente — se sigue aplicando incluso a las rutas que
    // sí declaran uno propio (defensa en profundidad). El límite "20
    // req/15min/TOKEN" de `POST /auth/refresh` (spec 1.2) NO se modela
    // como un segundo bucket nombrado acá a propósito: `ThrottlerGuard`
    // evalúa TODOS los buckets registrados en `forRoot()` contra TODAS
    // las rutas (ver `onModuleInit` de `@nestjs/throttler`), así que un
    // bucket "por token" con fallback a IP terminaría aplicándose también
    // a endpoints sin refresh token de por medio. Se implementa aparte,
    // acotado a esa única ruta — ver `RefreshThrottleGuard`.
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }]),

    DatabaseModule,
    JwtModule,
    AuthModule,
    UsersModule,
    EquipmentModule,
    WorkoutsModule,
  ],
  controllers: [AppController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
