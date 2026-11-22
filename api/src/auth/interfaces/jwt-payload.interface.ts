export interface JwtPayload {
  sub: string;       // User ID
  email: string;
  jti: string;       // Unique JWT ID used for instant revocation/blacklisting
  iat?: number;
  exp?: number;
}
