import { RefreshTokensRepository } from '../refresh-tokens/refresh-tokens.repository';
import { UserRecord, UsersRepository } from './users.repository';
import { UsersService } from './users.service';

describe('UsersService', () => {
  const baseUser: UserRecord = {
    id: 'user-1',
    email: 'rider@ridepro.com',
    passwordHash: 'hash',
    displayName: 'Rider',
    photoUrl: null,
    ftp: 250,
    weightKg: '70.50', // pg devuelve NUMERIC como string
    premium: false,
    emailVerified: true,
    authProvider: 'password',
    firebaseUid: null,
    createdAt: new Date('2026-01-10T08:00:00Z'),
  };

  function buildService(overrides?: {
    findById?: jest.Mock;
    findRoleNames?: jest.Mock;
    updateProfile?: jest.Mock;
  }) {
    const usersRepository = {
      findByEmail: jest.fn(),
      findById: overrides?.findById ?? jest.fn().mockResolvedValue(baseUser),
      createWithPassword: jest.fn(),
      findRoleNames: overrides?.findRoleNames ?? jest.fn().mockResolvedValue(['user']),
      updateProfile: overrides?.updateProfile ?? jest.fn().mockResolvedValue(baseUser),
      softDelete: jest.fn(),
    } as unknown as jest.Mocked<UsersRepository>;

    const refreshTokensRepository = {
      create: jest.fn(),
      rotate: jest.fn(),
      revokeAllForUser: jest.fn(),
    } as unknown as jest.Mocked<RefreshTokensRepository>;

    return { service: new UsersService(usersRepository, refreshTokensRepository), usersRepository, refreshTokensRepository };
  }

  describe('getProfile', () => {
    it('mapea weightKg (string de pg) a number y resuelve el rol de mayor privilegio', async () => {
      const { service } = buildService({
        findRoleNames: jest.fn().mockResolvedValue(['user', 'admin']),
      });

      const profile = await service.getProfile('user-1');

      expect(profile).toEqual({
        id: 'user-1',
        email: 'rider@ridepro.com',
        displayName: 'Rider',
        photoUrl: null,
        ftp: 250,
        weightKg: 70.5,
        premium: false,
        role: 'admin', // mayor privilegio que 'user'
        createdAt: baseUser.createdAt,
      });
    });

    it('responde AUTH_TOKEN_MISSING_OR_INVALID si el usuario no existe (borrado)', async () => {
      const { service } = buildService({ findById: jest.fn().mockResolvedValue(null) });

      await expect(service.getProfile('user-ghost')).rejects.toMatchObject({
        code: 'AUTH_TOKEN_MISSING_OR_INVALID',
      });
    });
  });

  describe('updateProfile', () => {
    it('delega los campos al repositorio y devuelve el perfil actualizado', async () => {
      const updateProfile = jest.fn().mockResolvedValue({ ...baseUser, displayName: 'Rider Pro' });
      const { service, usersRepository } = buildService({ updateProfile });

      const profile = await service.updateProfile('user-1', { displayName: 'Rider Pro' });

      expect(usersRepository.updateProfile).toHaveBeenCalledWith('user-1', {
        displayName: 'Rider Pro',
        ftp: undefined,
        weightKg: undefined,
      });
      expect(profile.displayName).toBe('Rider Pro');
    });

    it('responde AUTH_TOKEN_MISSING_OR_INVALID si el usuario no existe', async () => {
      const { service } = buildService({ updateProfile: jest.fn().mockResolvedValue(null) });

      await expect(service.updateProfile('user-ghost', {})).rejects.toMatchObject({
        code: 'AUTH_TOKEN_MISSING_OR_INVALID',
      });
    });
  });

  describe('deleteAccount', () => {
    it('hace soft delete y revoca todos los refresh tokens del usuario', async () => {
      const { service, usersRepository, refreshTokensRepository } = buildService();

      await service.deleteAccount('user-1');

      expect(usersRepository.softDelete).toHaveBeenCalledWith('user-1');
      expect(refreshTokensRepository.revokeAllForUser).toHaveBeenCalledWith('user-1');
    });
  });
});
