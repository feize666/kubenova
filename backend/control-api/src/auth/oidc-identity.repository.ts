import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../platform/database/prisma.service';

@Injectable()
export class OidcIdentityRepository {
  constructor(private readonly prisma: PrismaService) {}

  async subjectForUser(issuer: string, userId: string): Promise<string> {
    const identities = await this.prisma.externalIdentity.findMany({
      where: { issuer, userId, user: { isActive: true } }, select: { subject: true }, take: 2,
    });
    if (identities.length !== 1) throw new UnauthorizedException('OIDC identity unavailable');
    return identities[0].subject;
  }

  // Call only after ID-token signature, issuer, audience and nonce validation.
  async resolve(issuer: string, subject: string) {
    if (!issuer || !subject) throw new UnauthorizedException('OIDC identity unavailable');
    const identity = await this.prisma.externalIdentity.findUnique({
      where: { issuer_subject: { issuer, subject } },
      select: { user: { select: { id: true, email: true, name: true, role: true, isActive: true, authzVersion: true, mfaEnabled: true } } },
    });
    if (!identity?.user.isActive) throw new UnauthorizedException('OIDC identity unavailable');
    return identity.user;
  }
}
