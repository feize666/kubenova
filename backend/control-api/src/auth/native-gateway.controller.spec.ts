import { Test } from '@nestjs/testing';
jest.mock('@kubernetes/client-node',()=>({}));
import { PassThrough } from 'node:stream';
import request from 'supertest';
import { NativeGatewayController } from './native-gateway.controller';
import { NativeGatewayService } from './native-gateway.service';
import { ResponseEnvelopeInterceptor } from '../common/interceptors/response-envelope.interceptor';

describe('native gateway HTTP boundary',()=>{
  let app:any;
  const open=jest.fn();
  const discover=jest.fn(async()=>({kind:'APIGroupList',apiVersion:'v1',groups:[]}));
  beforeEach(async()=>{
    open.mockReset().mockImplementation(async()=>{
      const stream=new PassThrough() as any;stream.statusCode=200;stream.headers={'content-type':'application/json','set-cookie':'must-not-forward=1'};
      stream.end('{"kind":"PodList","items":[]}');return stream;
    });
    const module=await Test.createTestingModule({controllers:[NativeGatewayController],providers:[{provide:NativeGatewayService,useValue:{open,discover}}]}).compile();
    app=module.createNestApplication();app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());await app.init();
  });
  afterEach(async()=>app.close());
  it('returns discovery without the console envelope or a resource stream',async()=>{
    const response=await request(app.getHttpServer()).get('/api/native/clusters/c/apis').set('Authorization','Bearer fixture').expect(200);
    expect(response.body).toEqual({kind:'APIGroupList',apiVersion:'v1',groups:[]});
    expect(open).not.toHaveBeenCalled();
  });
  it('streams Kubernetes JSON unwrapped and forwards only explicit inputs',async()=>{
    const response=await request(app.getHttpServer()).get('/api/native/clusters/c/api/v1/namespaces/ai/pods?watch=true').set('Authorization','Bearer fixture').set('Impersonate-User','system:admin').expect(200);
    expect(response.body).toEqual({kind:'PodList',items:[]});expect(response.headers['set-cookie']).toBeUndefined();
    expect(open.mock.calls[0][0]).toMatchObject({clusterId:'c',token:'fixture',target:'/api/v1/namespaces/ai/pods?watch=true'});
    expect(open.mock.calls[0][0]).not.toHaveProperty('headers');
  });
  it('denies missing bearer and unsupported writes before service execution',async()=>{
    await request(app.getHttpServer()).get('/api/native/clusters/c/api/v1/namespaces/ai/pods').expect(401);
    await request(app.getHttpServer()).post('/api/native/clusters/c/api/v1/namespaces/ai/pods').set('Authorization','Bearer fixture').send({}).expect(403);
    expect(open).not.toHaveBeenCalled();
  });
  it('does not expose upstream errors or credentials',async()=>{
    open.mockRejectedValueOnce(Error('secret https://private?token=private'));
    const response=await request(app.getHttpServer()).get('/api/native/clusters/c/api/v1/namespaces/ai/pods').set('Authorization','Bearer fixture').expect(503);
    expect(response.body.kind).toBe('Status');expect(JSON.stringify(response.body)).not.toContain('private');
  });
});
