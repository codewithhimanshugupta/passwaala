import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Public } from '../common/public.decorator';
import { CurrentUser } from '../common/current-user.decorator';
import { AuthPayload } from './auth-payload';
import { AuthService } from './auth.service';
import { RequestOtpDto } from './dto/request-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import { ResetCredentialsDto } from './dto/reset-credentials.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('signup')
  @HttpCode(HttpStatus.OK)
  signup(@Body() dto: SignupDto) {
    return this.auth.signup(dto.phone, dto.name, dto.password, dto.pin, dto.appType, dto.msg91Token);
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto.phone, dto.credential, dto.appType, dto.method);
  }

  @Public()
  @Post('request-otp')
  @HttpCode(HttpStatus.OK)
  requestOtp(@Body() dto: RequestOtpDto): { sent: true } {
    return this.auth.requestOtp(dto.phone, dto.appType);
  }

  @Public()
  @Post('verify-otp')
  @HttpCode(HttpStatus.OK)
  verifyOtp(@Body() dto: VerifyOtpDto) {
    return this.auth.verifyOtp(dto.phone, dto.appType, dto.msg91Token, dto.code);
  }

  @Public()
  @Post('reset-credentials')
  @HttpCode(HttpStatus.OK)
  resetCredentials(@Body() dto: ResetCredentialsDto) {
    return this.auth.resetCredentials(
      dto.phone, dto.appType, dto.msg91Token, dto.newPassword, dto.newPin,
    );
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@CurrentUser() user: AuthPayload): Promise<{ ok: true }> {
    await this.auth.closeAllShops(user.sub);
    return { ok: true };
  }
}
