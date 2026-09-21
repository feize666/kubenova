const assert = require('node:assert/strict');
const net = require('node:net');
const { sendNotificationEmail } = require('../dist/src/monitoring/notification-email');

(async () => {
  const sockets = new Set();
  let peerClosed = false;
  const server = net.createServer(socket => {
    sockets.add(socket);
    // Finish the greeting, then keep EHLO's multiline response incomplete.
    socket.write('220 localhost ready\r\n');
    const timer = setInterval(() => socket.write('250-still waiting\r\n'), 250);
    socket.on('data', () => {});
    socket.on('error', () => {});
    socket.on('close', () => { clearInterval(timer); sockets.delete(socket); peerClosed = true; });
  });
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    Object.assign(process.env, { SMTP_HOST: '127.0.0.1', SMTP_PORT: String(server.address().port), SMTP_SECURE: 'false', SMTP_FROM: 'sender@example.test' });
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASSWORD;
    const start = Date.now();
    await assert.rejects(sendNotificationEmail('recipient@example.test', { title: 'Timeout', message: 'Never sent' }), /Email notification delivery failed/);
    assert.ok(Date.now() - start < 6500, 'caller deadline exceeded');
    await new Promise(resolve => setTimeout(resolve, 200));
    assert.equal(peerClosed, true, 'timed-out transport must close the actual peer connection');
    console.log('PASS real trickling SMTP connection closes at deadline');
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
