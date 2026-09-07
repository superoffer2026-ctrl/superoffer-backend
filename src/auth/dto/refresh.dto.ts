import { IsNotEmpty, IsOptional, IsString, ValidateIf } from 'class-validator';

/**
 * Login returns the token as `refresh_token`, so that is the canonical field to
 * send it back in. `refreshToken` is accepted too — every other request body in
 * this API is camelCase, and a client that normalises its casing should not get
 * a 400 for it.
 */
export class RefreshDto {
  @ValidateIf(o => o.refreshToken === undefined || o.refreshToken === null)
  @IsString()
  @IsNotEmpty({ message: 'refresh_token is required' })
  refresh_token?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'refreshToken must not be empty' })
  refreshToken?: string;
}
