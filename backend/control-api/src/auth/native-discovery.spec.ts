import { nativeDiscovery } from './native-discovery';

describe('native discovery catalog',()=>{
  const rows=[
    {group:'',version:'v1',kind:'Pod',resource:'pods',namespaced:true,verbsJson:['get','list','watch','create','delete']},
    {group:'',version:'v1',kind:'Secret',resource:'secrets',namespaced:true,verbsJson:['get','list','watch']},
    {group:'',version:'v1',kind:'Node',resource:'nodes',namespaced:false,verbsJson:['get','list']},
    {group:'apps',version:'v1',kind:'Deployment',resource:'deployments',namespaced:true,verbsJson:['get','list','watch','patch']},
    {group:'rbac.authorization.k8s.io',version:'v1',kind:'Role',resource:'roles',namespaced:true,verbsJson:['get']},
  ];
  it('shows only supported namespaced APIs and strips mutation verbs',()=>{
    expect(nativeDiscovery('/api/v1',rows,[])).toEqual({apiVersion:'v1',kind:'APIResourceList',groupVersion:'v1',resources:[{name:'pods',singularName:'',namespaced:true,kind:'Pod',verbs:['get','list','watch']}]});
    const groups=nativeDiscovery('/apis',rows,[]) as any;
    expect(groups.groups.map((g:any)=>g.name)).toEqual(['apps']);
    expect(nativeDiscovery('/apis/apps/v1',rows,[])).toMatchObject({groupVersion:'apps/v1',resources:[{name:'deployments',verbs:['get','list','watch']}]});
  });
  it('accepts client discovery timeout while rejecting ambiguous or unrelated queries',()=>{
    expect(nativeDiscovery('/api/v1?timeout=32s',rows,[])).toMatchObject({kind:'APIResourceList',groupVersion:'v1'});
    for(const query of ['timeout=32s&timeout=1s','watch=true','timeout=bad','timeout=32s#fragment']) {
      expect(()=>nativeDiscovery(`/api/v1?${query}`,rows,[])).toThrow();
    }
  });
  it('includes secrets only when explicitly permitted and never invents absent resources',()=>{
    expect(nativeDiscovery('/api/v1',rows,['secrets'])).toMatchObject({resources:[{name:'pods'},{name:'secrets'}]});
    expect(()=>nativeDiscovery('/apis/batch/v1',rows,[])).toThrow();
    expect(()=>nativeDiscovery('/api/v1?watch=true',rows,[])).toThrow();
  });
});
