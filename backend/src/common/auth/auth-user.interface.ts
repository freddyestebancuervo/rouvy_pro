import { Request } from 'express';

export interface AuthUser {
  userId: string;
  roles: string[];
  emailVerified: boolean;
}

export interface AuthenticatedRequest extends Request {
  user: AuthUser;
}
