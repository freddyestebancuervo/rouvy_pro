import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),

    // Rate limiting global — ver spec sección 5.5 ("Rate limiting"). Los
    // límites específicos por endpoint (5 req/15min en /auth/register,
    // etc.) se afinan por ruta en la tarea C3 con `@Throttle()`; esto es
    // solo el límite por defecto de respaldo para cualquier endpoint que
    // no lo declare explícitamente.
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }]),

    AuthModule,
    UsersModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
