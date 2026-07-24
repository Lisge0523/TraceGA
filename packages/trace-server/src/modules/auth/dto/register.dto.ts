import { IsEmail, IsMobilePhone, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator'

export class RegisterDto {
  @IsString()
  @MinLength(2)
  @MaxLength(64)
  username: string

  @IsEmail({}, { message: '邮箱格式不正确' })
  @MaxLength(128)
  email: string

  @Matches(/^1[3-9]\d{9}$/, { message: '手机号格式不正确' })
  phone: string

  @IsString()
  @MinLength(8)
  @MaxLength(64)
  @Matches(/^(?=.*[a-zA-Z])(?=.*\d).{8,}$/, {
    message: '密码至少8位，且包含字母和数字',
  })
  password: string

  @IsOptional()
  @IsString()
  @MaxLength(32)
  role?: string
}
