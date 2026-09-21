const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');

const url = new URL(process.env.DATABASE_URL || 'postgresql://invalid');
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
assert.ok(process.env.PSQL_BIN, 'Set PSQL_BIN');
const schema = `notify_${randomUUID().replaceAll('-', '')}`;
const db = new PrismaClient();
let listener;
let output = '';
async function barrier() {
  const marker = randomUUID();
  listener.stdin.write(`SELECT '${marker}';\n`);
  const deadline = Date.now() + 5000;
  while (!output.includes(marker)) {
    if (Date.now() > deadline || listener.exitCode !== null) throw Error(`Listener failed: ${output}`);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  // Notifications are printed after each command, so a second round trip drains them.
  return marker;
}
(async () => {
  let created = false;
  try {
    await db.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`); created = true;
    await db.$executeRawUnsafe(`CREATE TABLE "${schema}"."User" (id text PRIMARY KEY, "authzVersion" integer, "isActive" boolean)`);
    await db.$executeRawUnsafe(`CREATE TABLE "${schema}"."AuthorizationChange" (id text PRIMARY KEY, "affectedUserId" text)`);
    const sql = fs.readFileSync(path.join(__dirname, '../prisma/migrations/20260920010000_authz_notifications/migration.sql'), 'utf8');
    // psql handles SQL function bodies without an ad hoc statement splitter.
    const env = { ...process.env, PGDATABASE: url.pathname.slice(1), PGHOST: url.hostname.replace(/^\[|\]$/g, ''), PGPORT: url.port || '5432', PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password) };
    for (const key of ['PGHOSTADDR', 'PGSERVICE', 'PGSERVICEFILE', 'PGOPTIONS']) delete env[key];
    const { spawnSync } = require('node:child_process');
    const setup = spawnSync(process.env.PSQL_BIN, ['-X', '-v', 'ON_ERROR_STOP=1'], { env, input: `SET search_path TO "${schema}";\n${sql}`, encoding: 'utf8' });
    assert.equal(setup.status, 0, setup.stderr);
    listener = spawn(process.env.PSQL_BIN, ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1'], { env });
    listener.stdout.on('data', chunk => { output += chunk; });
    listener.stderr.on('data', chunk => { output += chunk; });
    listener.stdin.write('LISTEN kubenova_authorization;\n'); await barrier();
    await db.$executeRawUnsafe(`INSERT INTO "${schema}"."User" VALUES ('fixture',1,true)`);
    await db.$executeRawUnsafe(`UPDATE "${schema}"."User" SET "authzVersion"=2 WHERE id='fixture'`);
    await barrier(); await barrier();
    assert.match(output, /"userId"\s*:\s*"fixture"/);
    output = '';
    await assert.rejects(db.$transaction(async tx => {
      await tx.$executeRawUnsafe(`UPDATE "${schema}"."User" SET "isActive"=false`);
      throw Error('rollback');
    }), /rollback/);
    await barrier(); await barrier();
    assert.ok(!output.includes('Asynchronous notification'), 'rollback must not publish');
    await db.$executeRawUnsafe(`INSERT INTO "${schema}"."AuthorizationChange" VALUES ('group-event',NULL)`);
    await barrier(); await barrier();
    assert.match(output, /"userId"\s*:\s*null/);
    console.log('PASS transactional PostgreSQL notifications: user change and group invalidation delivered; rollback silent');
  } finally {
    if (listener && listener.exitCode === null) { listener.stdin.end('\\q\n'); await new Promise(resolve => listener.once('exit', resolve)); }
    try { if (created) await db.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`); }
    finally { await db.$disconnect(); }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
