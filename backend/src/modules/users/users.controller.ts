import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Patch, UseGuards } from '@nestjs/common';
import { AuthUser } from '../../common/auth/auth-user.interface';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { DeleteAccountDto } from './dto/delete-account.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UserProfileResponse, UsersService } from './users.service';

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  getMe(@CurrentUser() user: AuthUser): Promise<UserProfileResponse> {
    return this.usersService.getProfile(user.userId);
  }

  @Patch('me')
  updateMe(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateProfileDto,
  ): Promise<UserProfileResponse> {
    return this.usersService.updateProfile(user.userId, dto);
  }

  @Delete('me')
  @HttpCode(HttpStatus.ACCEPTED)
  async deleteMe(@CurrentUser() user: AuthUser, @Body() _dto: DeleteAccountDto): Promise<void> {
    // `_dto` solo existe para que `ValidationPipe` exija `confirm: true`
    // antes de llegar acá (doble confirmación, spec 1.2) — el valor en sí
    // no se usa.
    await this.usersService.deleteAccount(user.userId);
  }
}
