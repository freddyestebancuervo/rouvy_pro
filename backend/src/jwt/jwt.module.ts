import { Global, Module } from '@nestjs/common';
import { TokenService } from './token.service';

/** Global — ver el docblock de `TokenService` para por qué no vive dentro
 * de `AuthModule`. */
@Global()
@Module({
  providers: [TokenService],
  exports: [TokenService],
})
export class JwtModule {}
