import { readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';

const backupName = /^kubenova-update-[a-f0-9-]+\.(?:sql|dump)$/i;
const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;

export async function pruneRetainedBackups(directory, { now = Date.now(), minimumRetained = 3 } = {}) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isFile() || !backupName.test(entry.name)) continue;
    const file = join(directory, entry.name);
    files.push({ file, mtime: (await stat(file)).mtimeMs });
  }
  files.sort((a, b) => b.mtime - a.mtime);
  const removed = [];
  for (const [index, file] of files.entries()) {
    if (index >= minimumRetained && file.mtime < now - thirtyDaysMs) {
      await rm(file.file);
      removed.push(file.file);
    }
  }
  return { retained: files.length - removed.length, removed };
}
