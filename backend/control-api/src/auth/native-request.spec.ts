import { classifyNativeRequest } from './native-request';

describe('native Kubernetes request boundary', () => {
  it.each([
    ['GET', '/api/v1/namespaces/apps/pods', 'pods', 'list', undefined],
    ['GET', '/apis/apps/v1/namespaces/apps/deployments/web', 'deployments', 'get', undefined],
    ['GET', '/api/v1/namespaces/apps/pods?watch=true', 'pods', 'watch', undefined],
    ['GET', '/api/v1/namespaces/apps/pods/web/log?follow=true', 'pods', 'get', 'logs'],
    ['POST', '/api/v1/namespaces/apps/pods/web/exec?command=sh', 'pods', 'create', 'exec'],
    ['GET', '/api/v1/namespaces/apps/secrets/key', 'secrets', 'get', 'secrets'],
  ])('classifies %s %s', (method, target, resource, verb, capability) => {
    expect(classifyNativeRequest(method, target)).toMatchObject({ namespace: 'apps', resource, verb, capability });
  });
  it.each([
    '/api/v1/pods', '/api/v1/nodes', '/api/v1/namespaces/apps',
    '/api/v1/namespaces/apps/pods/web/proxy',
    '/api/v1/namespaces/apps/serviceaccounts/default/token',
    '/apis/rbac.authorization.k8s.io/v1/namespaces/apps/rolebindings',
    '/api/v1/namespaces/apps/pods/../secrets',
    '/api/v1/namespaces/apps%2fother/pods',
    '/api/v1/namespaces/apps/pods//web',
    '/api/v1/namespaces/apps/pods?watch=true&watch=false',
    '/api/v1/namespaces/apps/pods?watch=invalid',
    'https://other/api/v1/namespaces/apps/pods',
    '/api/v1/namespaces/apps/pods#fragment',
  ])('denies ambiguous or unsupported path %s', target => {
    expect(() => classifyNativeRequest('GET', target)).toThrow();
  });
  it('does not permit writes until admission controls are integrated', () => {
    expect(() => classifyNativeRequest('POST', '/api/v1/namespaces/apps/pods')).toThrow();
    expect(() => classifyNativeRequest('DELETE', '/api/v1/namespaces/apps/pods/web')).toThrow();
  });
});
