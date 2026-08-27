import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Fails at boot rather than at the first write. The image runs as uid 1000
 * (`node`), so a bind-mounted directory owned by another uid — a host account
 * that is not 1000 — is readable but not writable, and the bot would look
 * healthy until a capture or a `/trending subscribe` tried to persist something.
 */
export async function ensureWritableDir(dir: string): Promise<void> {
  const probe = join(dir, `.write-probe-${process.pid.toString()}`);
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(probe, 'ok', 'utf8');
    await unlink(probe);
  } catch (cause) {
    const code = (cause as NodeJS.ErrnoException).code;
    if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS') {
      const uid = process.getuid?.() ?? -1;
      const gid = process.getgid?.() ?? -1;
      throw new Error(
        `${dir} is not writable by uid ${String(uid)}:${String(gid)} — ` +
          `on the host, either \`sudo chown -R ${String(uid)}:${String(gid)} <the mounted directory>\` ` +
          `or run the container as the owning user (\`user: "$(id -u):$(id -g)"\` in docker-compose.yml)`,
        { cause },
      );
    }
    throw cause;
  }
}
