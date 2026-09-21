const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {PrismaClient}=require('@prisma/client');
const {Client}=require('pg');
const {NativeSettingsService}=require('../dist/src/auth/native-settings.service');
const url=new URL(process.env.DATABASE_URL||'postgresql://invalid');
assert.ok(['localhost','127.0.0.1','[::1]'].includes(url.hostname));
const schema='native_settings_'+randomUUID().replaceAll('-','');
const admin=new Client({connectionString:url.toString()});
url.searchParams.set('schema',schema);
const db=new PrismaClient({datasources:{db:{url:url.toString()}}});
let created=false;
(async()=>{
 try {
  await admin.connect();await admin.query(`CREATE SCHEMA "${schema}"`);created=true;
  await admin.query(`SET search_path TO "${schema}"`);
  await admin.query('CREATE TABLE "User" (id text PRIMARY KEY,role text,"isActive" boolean); CREATE TABLE "ClusterRegistry" (id text PRIMARY KEY,status text,"deletedAt" timestamp); CREATE TABLE "AuthorizationChange" (LIKE public."AuthorizationChange" INCLUDING DEFAULTS)');
  await admin.query(fs.readFileSync(path.join(__dirname,'../prisma/migrations/20260920020000_native_access_config/migration.sql'),'utf8'));
  await admin.query(`INSERT INTO "User" VALUES ('admin','platform-admin',true),('reader','user',true); INSERT INTO "ClusterRegistry" VALUES ('cluster','online',NULL)`);
  const service=new NativeSettingsService(db),actor={id:'admin',role:'platform-admin'};
  assert.deepEqual(await service.get(actor,'cluster'),{clusterId:'cluster',enabled:false,revision:0});
  const config={enabled:false,issuer:'https://sso.example/realms/main',audience:'kubectl',jwksUri:'https://sso.example/realms/main/certs',gatewayUrl:'https://gateway.example/native',revision:0};
  await assert.rejects(service.save({id:'reader',role:'platform-admin'},'cluster',config),error=>error.getStatus()===403);
  assert.equal(await db.nativeAccessConfig.count(),0);
  const saved=await service.save(actor,'cluster',config);assert.equal(saved.revision,1);
  const attempts=await Promise.allSettled([service.save(actor,'cluster',{...config,revision:1}),service.save(actor,'cluster',{...config,revision:1})]);
  assert.equal(attempts.filter(result=>result.status==='fulfilled').length,1);
  assert.equal(attempts.find(result=>result.status==='rejected').reason.getStatus(),409);
  assert.equal((await service.get(actor,'cluster')).revision,2);
  assert.equal(await db.authorizationChange.count(),2,'only committed saves create authorization changes');
  await admin.query(`UPDATE "User" SET "isActive"=false WHERE id='admin'`);
  await assert.rejects(service.save(actor,'cluster',{...config,revision:2}),error=>error.getStatus()===403);
  assert.equal((await db.nativeAccessConfig.findUnique({where:{clusterId:'cluster'}})).revision,2);
  console.log('PASS native settings PostgreSQL: default disabled, live administrator check, persisted revision, concurrent stale-save denial and transactional authorization audit. Isolated schema only.');
 } finally {
  await db.$disconnect();
  if(created) await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
  await admin.end();
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
