const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

try {
  let files;
  try { files = JSON.parse(process.env.BACKUP_CONFIG_FILES || 'null'); }
  catch { throw Error('BACKUP_CONFIG_FILES must be a JSON array of file paths'); }
  if (!Array.isArray(files) || !files.length || files.length > 32 || new Set(files).size !== files.length) throw Error('Select 1-32 distinct configuration files');
  if (!process.env.RESTIC_REPOSITORY?.startsWith('s3:')) throw Error('Configuration backup requires an offsite S3 repository');
  const password = fs.realpathSync(process.env.RESTIC_PASSWORD_FILE || '');
  for (const file of files) {
    if (typeof file !== 'string' || !path.isAbsolute(file) || /[\r\n\0]/.test(file)) throw Error('Configuration paths must be absolute');
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16 * 1024 * 1024 || fs.realpathSync(file) !== path.resolve(file)) throw Error('Only regular, non-symlink configuration files up to 16 MiB are allowed');
    if (fs.realpathSync(file) === password) throw Error('Do not back up the repository password into its own repository');
  }
  const backup = spawnSync('restic', ['backup', '--tag', 'kubenova-configuration', '--', ...files], { stdio: 'inherit' });
  if (backup.status !== 0) process.exitCode = backup.status || 1;
  else {
    const retention = spawnSync('restic', ['forget', '--tag', 'kubenova-configuration', '--group-by', 'host,paths,tags', '--keep-daily', '7', '--keep-weekly', '4'], { stdio: 'inherit' });
    process.exitCode = retention.status ?? 1;
  }
} catch (error) {
  // Avoid echoing environment contents or file data when configuration fails.
  console.error(error.code ? 'Configuration backup file validation failed' : error.message);
  process.exitCode = 1;
}
