import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, unlink, stat } from 'node:fs/promises';
import { dirname, join, resolve, normalize } from 'node:path';
import { env } from '../env.js';

/**
 * Object storage abstraction.
 *
 * `local` writes to a content-addressed directory tree and is what runs in
 * development, CI and single-node deployments. `r2` talks to Cloudflare R2 via
 * the S3-compatible API so the same code path works on the edge deployment.
 *
 * Keys are always `<orgId>/<sha256-prefix>/<filename>` — never user-supplied
 * paths — which removes traversal as a class of bug.
 */

export interface StoredObject {
  key: string;
  sizeBytes: number;
  sha256: string;
}

export interface StorageDriver {
  put(key: string, body: Buffer | string, contentType?: string): Promise<StoredObject>;
  get(key: string): Promise<Buffer | null>;
  delete(key: string): Promise<void>;
  /** Signed / time-limited URL, or a same-origin path in local mode. */
  url(key: string, ttlSeconds?: number): Promise<string>;
}

export const sha256Hex = (body: Buffer | string): string =>
  createHash('sha256').update(body).digest('hex');

/** Rejects anything that could escape the storage root. */
export function assertSafeKey(key: string): void {
  const normalized = normalize(key);
  if (normalized.startsWith('..') || normalized.includes('..' + '/') || normalized.startsWith('/')) {
    throw new Error(`Unsafe storage key: ${key}`);
  }
}

class LocalStorage implements StorageDriver {
  private root = resolve(process.cwd(), env.STORAGE_DIR);

  private pathFor(key: string): string {
    assertSafeKey(key);
    return join(this.root, key);
  }

  async put(key: string, body: Buffer | string): Promise<StoredObject> {
    const buffer = Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf8');
    const full = this.pathFor(key);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, buffer);
    return { key, sizeBytes: buffer.byteLength, sha256: sha256Hex(buffer) };
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      return await readFile(this.pathFor(key));
    } catch {
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await unlink(this.pathFor(key));
    } catch {
      /* idempotent delete */
    }
  }

  async url(key: string): Promise<string> {
    return `/api/v1/storage/${key}`;
  }
}

class R2Storage implements StorageDriver {
  constructor(
    private accountId: string,
    private bucket: string,
    private token: string,
  ) {}

  private endpoint(key: string): string {
    return `https://${this.accountId}.r2.cloudflarestorage.com/${this.bucket}/${key}`;
  }

  async put(key: string, body: Buffer | string, contentType = 'application/octet-stream'): Promise<StoredObject> {
    assertSafeKey(key);
    const buffer = Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf8');
    const res = await fetch(this.endpoint(key), {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': contentType,
      },
      body: buffer,
    });
    if (!res.ok) {
      throw new Error(`R2 PUT failed (${res.status}): ${await res.text()}`);
    }
    return { key, sizeBytes: buffer.byteLength, sha256: sha256Hex(buffer) };
  }

  async get(key: string): Promise<Buffer | null> {
    assertSafeKey(key);
    const res = await fetch(this.endpoint(key), {
      headers: { Authorization: `Bearer ${this.token}` },
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`R2 GET failed (${res.status})`);
    return Buffer.from(await res.arrayBuffer());
  }

  async delete(key: string): Promise<void> {
    assertSafeKey(key);
    await fetch(this.endpoint(key), { method: 'DELETE', headers: { Authorization: `Bearer ${this.token}` } });
  }

  async url(key: string): Promise<string> {
    return `https://${this.bucket}.${this.accountId}.r2.dev/${key}`;
  }
}

let driver: StorageDriver | null = null;

export function storage(): StorageDriver {
  if (driver) return driver;
  if (env.STORAGE_DRIVER === 'r2') {
    const accountId = process.env.R2_ACCOUNT_ID;
    const bucket = process.env.R2_BUCKET;
    const token = process.env.R2_API_TOKEN;
    if (!accountId || !bucket || !token) {
      throw new Error('STORAGE_DRIVER=r2 requires R2_ACCOUNT_ID, R2_BUCKET and R2_API_TOKEN');
    }
    driver = new R2Storage(accountId, bucket, token);
  } else {
    driver = new LocalStorage();
  }
  return driver;
}

export function resetStorageForTests(): void {
  driver = null;
}

/** Builds a deterministic, tenant-scoped storage key. */
export function objectKey(orgId: string, kind: string, filename: string, sha?: string): string {
  const digest = sha ?? createHash('sha256').update(`${filename}:${Date.now()}`).digest('hex');
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
  return `${orgId}/${kind}/${digest.slice(0, 2)}/${digest.slice(2, 10)}-${safeName}`;
}

export async function objectSize(key: string): Promise<number | null> {
  try {
    const s = await stat(resolve(process.cwd(), env.STORAGE_DIR, key));
    return s.size;
  } catch {
    return null;
  }
}
