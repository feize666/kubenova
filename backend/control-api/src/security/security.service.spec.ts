import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { SecurityService } from './security.service';
import type { UsersService } from '../users/users.service';

describe('security event write authorization', () => {
  const service = () => new SecurityService({} as UsersService);

  it.each([undefined, 'viewer', 'read-only', 'user'])('rejects role %s before accessing events', (role) => {
    const instance = service();
    expect(() => instance.resolveEvent({ role } as never, 'missing-event')).toThrow(ForbiddenException);
  });

  it('rejects an unauthenticated actor', () => {
    expect(() => service().resolveEvent(undefined, 'missing-event')).toThrow(ForbiddenException);
  });

  it('does not mutate an existing open event when a viewer attempts resolution', () => {
    const instance = service();
    const event = instance.getEvents({ status: 'open' }).items[0];
    expect(event).toBeDefined();
    const before = { ...event };
    expect(() => instance.resolveEvent({ role: 'read-only' }, event.id)).toThrow(ForbiddenException);
    expect(instance.getEvents({}).items.find(item => item.id === event.id)).toEqual(before);
  });

  it.each(['platform-admin', 'cluster-operator'])('allows role %s to reach event validation', (role) => {
    expect(() => service().resolveEvent({ role } as never, 'missing-event')).toThrow(NotFoundException);
  });
});
