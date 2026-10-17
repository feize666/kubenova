import test from 'node:test';
import assert from 'node:assert/strict';
import { isMobileContextColumn } from './mobile-context';
test('context columns are shown once in the mobile summary, not repeated as metadata',()=>{
  for(const identity of ['namespace','namespaceName','名称空间','命名空间','clusterId','clusterName','集群'])assert.equal(isMobileContextColumn(identity),true);
  for(const identity of ['name','replicas','namespaceSelector','clusterIP','serviceName'])assert.equal(isMobileContextColumn(identity),false);
});
