const assert = require('node:assert/strict');
const { Client } = require('pg');
const { AuthorizationInvalidation } = require('../dist/src/common/authorization-invalidation');
const url = new URL(process.env.DATABASE_URL || 'postgresql://invalid');
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
const scope = `fixture_${require('node:crypto').randomUUID()}`;
let listener;
const db = new Client({ connectionString: url.toString() });
const waitAbort = signal => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(Error('Invalidation was not delivered')), 2000);
  if (signal.aborted) { clearTimeout(timer); resolve(); return; }
  signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
});
(async () => {
  try {
    await db.connect(); listener = await AuthorizationInvalidation.connect(url.toString(), scope);
    const first = listener.register('first', new Date(Date.now() + 60000));
    const other = listener.register('other', new Date(Date.now() + 60000));
    await db.query('SELECT pg_notify($1,$2)', ['kubenova_authorization', JSON.stringify({ schema: scope, userId: 'first' })]);
    await waitAbort(first.signal); assert.equal(other.signal.aborted, false);
    await db.query('SELECT pg_notify($1,$2)', ['kubenova_authorization', JSON.stringify({ schema: scope, userId: null })]);
    await waitAbort(other.signal);
    const expiring = listener.register('expiry', new Date(Date.now() + 25)); await waitAbort(expiring.signal);
    const open = listener.register('open', new Date(Date.now() + 60000));
    await listener.close(); await waitAbort(open.signal);
    assert.throws(() => listener.register('new', new Date(Date.now() + 60000)));
    // A unique application name confines termination to this test's dedicated listener.
    const listenerUrl = new URL(url);
    listenerUrl.searchParams.set('application_name', scope);
    listener = await AuthorizationInvalidation.connect(listenerUrl.toString(), scope);
    const interrupted = listener.register('interrupted', new Date(Date.now() + 60000));
    const targets = await db.query('SELECT pid FROM pg_stat_activity WHERE application_name=$1 AND datname=current_database() AND usename=current_user', [scope]);
    assert.equal(targets.rowCount, 1, 'exactly one isolated listener must be selected');
    const terminated = await db.query('SELECT pg_terminate_backend($1) AS stopped', [targets.rows[0].pid]);
    assert.equal(terminated.rows[0].stopped, true);
    await waitAbort(interrupted.signal);
    assert.equal(listener.available, false);
    assert.throws(() => listener.register('new', new Date(Date.now() + 60000)));
    console.log('PASS actual PostgreSQL LISTEN: targeted/global cancellation, expiry, normal close and server-forced disconnect deny new leases');
  } finally { await listener?.close().catch(() => {}); await db.end(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
