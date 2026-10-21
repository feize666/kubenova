export function postgresDumpConfig(databaseUrl, outputFile) {
  let parsed;
  try { parsed = new URL(databaseUrl); } catch { throw new Error('PostgreSQL DATABASE_URL 格式无效'); }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !parsed.hostname || !parsed.pathname || parsed.pathname === '/') throw new Error('仅支持带主机和数据库名的 PostgreSQL DATABASE_URL');
  const host = parsed.hostname;
  const port = parsed.port || '5432';
  const database = decodeURIComponent(parsed.pathname.slice(1));
  const username = decodeURIComponent(parsed.username || 'postgres');
  if (!database || /[\r\n]/.test(database + username + host + port)) throw new Error('PostgreSQL DATABASE_URL 包含无效字符');
  const escapePgpass = value => value.replaceAll('\\', '\\\\').replaceAll(':', '\\:').replace(/[\r\n]/g, '');
  const passwordLine = parsed.password
    ? `${escapePgpass(host)}:${escapePgpass(port)}:${escapePgpass(database)}:${escapePgpass(username)}:${escapePgpass(decodeURIComponent(parsed.password))}\n`
    : null;
  const args = ['--format=custom', '--no-owner', '--file', outputFile, '--host', host, '--port', port, '--username', username, database];
  const sslmode = parsed.searchParams.get('sslmode');
  return { args, passwordLine, sslmode };
}
