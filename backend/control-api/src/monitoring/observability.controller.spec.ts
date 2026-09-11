import { ObservabilityController } from './observability.controller';

describe('ObservabilityController access boundaries', () => {
  const service = {
    listDataSources: jest.fn().mockResolvedValue({ items: [], total: 0, timestamp: new Date().toISOString() }),
    createDataSource: jest.fn(),
    getDataSourceScope: jest.fn(),
  } as any;
  const access = {
    assertCanRead: jest.fn().mockResolvedValue({ clusterId: 'cluster-a' }),
    assertCanMutate: jest.fn().mockResolvedValue({ clusterId: 'cluster-a' }),
    assertPlatformAdmin: jest.fn(),
  } as any;
  const req = (role = 'cluster-operator') => ({ user: { user: { id: 'u1', username: 'u1', role } } });

  beforeEach(() => jest.clearAllMocks());

  it('requires read access for a scoped data-source list', async () => {
    const controller = new ObservabilityController(service, access);
    await controller.listDataSources(req(), 'cluster-a');
    expect(access.assertCanRead).toHaveBeenCalledWith(req().user.user, 'cluster-a');
    expect(service.listDataSources).toHaveBeenCalledWith('cluster-a');
  });

  it('requires platform admin for an unscoped data-source list', async () => {
    const controller = new ObservabilityController(service, access);
    await controller.listDataSources(req('read-only'));
    expect(access.assertPlatformAdmin).toHaveBeenCalledWith(req('read-only').user.user);
  });

  it('requires cluster mutation access when creating a scoped source', async () => {
    const controller = new ObservabilityController(service, access);
    const body = { clusterId: 'cluster-a', kind: 'prometheus', name: 'p', endpoint: 'https://prom.example' } as any;
    await controller.createDataSource(req(), body);
    expect(access.assertCanMutate).toHaveBeenCalledWith(req().user.user, 'cluster-a');
    expect(service.createDataSource).toHaveBeenCalledWith(req().user.user, body);
  });
});
