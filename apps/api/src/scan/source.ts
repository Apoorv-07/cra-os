import { gunzipSync } from 'node:zlib';
import { extract as tarExtract } from 'tar-stream';
import { Readable } from 'node:stream';
import { env } from '../env.js';
import { AppError } from '../core/errors.js';
import { createGitHubAppJwt, decryptSecret } from '../core/crypto.js';
import { log } from '../core/logger.js';

/**
 * Repository source access.
 *
 * Security posture:
 *  - We request **read-only, contents-only** access. The GitHub App is
 *    configured with `contents: read` and `metadata: read` and nothing else.
 *  - We never clone, never install dependencies, and never execute repository
 *    code. Only dependency manifests and a small set of policy files are read.
 *  - Extraction is bounded by file count, per-file size and total size, and
 *    paths are filtered against an allow-list before they are parsed.
 */

const API = env.GITHUB_API_BASE;
const JSON_ACCEPT = 'application/vnd.github+json';

/** Hard limits that keep hostile or pathological repositories cheap. */
export const SCAN_LIMITS = {
  maxFiles: 80,
  maxFileBytes: 2 * 1024 * 1024,
  maxTotalBytes: 12 * 1024 * 1024,
  maxTarballBytes: 40 * 1024 * 1024,
  maxPathDepth: 6,
} as const;

export interface RepoRef {
  owner: string;
  repo: string;
  ref?: string;
  installationId?: string;
  /** OAuth/PAT token, used when there is no App installation (dev + GitLab-less flows). */
  accessToken?: string;
}

async function ghFetch(path: string, token: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Accept: JSON_ACCEPT,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'cra-compliance-os',
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  });
  return res;
}

/** Mints a short-lived installation token from the GitHub App credentials. */
export async function installationToken(installationId: string): Promise<string> {
  const appId = env.GITHUB_APP_ID;
  const privateKey = env.GITHUB_APP_PRIVATE_KEY;
  if (!appId || !privateKey) {
    throw AppError.integration(
      'GitHub App credentials are not configured.',
      'Set GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY, or connect with OAuth for development.',
    );
  }

  const jwt = createGitHubAppJwt(appId, privateKey.includes('\\n') ? privateKey.replace(/\\n/g, '\n') : privateKey);
  const res = await fetch(`${API}/app/installations/${encodeURIComponent(installationId)}/access_tokens`, {
    method: 'POST',
    headers: { Accept: JSON_ACCEPT, Authorization: `Bearer ${jwt}`, 'User-Agent': 'cra-compliance-os' },
  });

  if (!res.ok) {
    const body = await res.text();
    log.error('github installation token failed', { status: res.status, body: body.slice(0, 300) });
    throw AppError.integration(
      'Could not obtain a GitHub installation token.',
      'The installation may have been revoked or uninstalled. Reconnect the integration.',
    );
  }

  const json = (await res.json()) as { token: string; expires_at?: string };
  return json.token;
}

/** Resolves the credential to use for a repository, preferring App tokens. */
export async function tokenFor(repo: RepoRef, encryptedOAuthToken?: string | null): Promise<string> {
  if (repo.accessToken) return repo.accessToken;
  if (repo.installationId) return installationToken(repo.installationId);
  if (encryptedOAuthToken) {
    try {
      return decryptSecret(encryptedOAuthToken);
    } catch {
      /* fall through */
    }
  }
  throw AppError.integration(
    'This repository has no usable GitHub credential.',
    'Reconnect the GitHub integration, or run a scan from an uploaded archive.',
  );
}

export interface GitHubRepoSummary {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  default_branch: string;
  html_url: string;
  language: string | null;
  description: string | null;
  pushed_at: string | null;
  owner: { login: string };
}

export async function listInstallationRepositories(installationId: string): Promise<GitHubRepoSummary[]> {
  const token = await installationToken(installationId);
  const out: GitHubRepoSummary[] = [];
  let page = 1;

  // Bounded pagination: 5 pages of 100 is 500 repos, plenty for our segment.
  while (page <= 5) {
    const res = await ghFetch(`/installation/repositories?per_page=100&page=${page}`, token);
    if (!res.ok) {
      if (res.status === 404) break;
      throw AppError.integration(`GitHub returned ${res.status} while listing repositories.`);
    }
    const json = (await res.json()) as { repositories?: GitHubRepoSummary[]; total_count?: number };
    const batch = json.repositories ?? [];
    out.push(...batch);
    if (batch.length < 100) break;
    page += 1;
  }
  return out;
}

/** Repositories visible to an OAuth user token (personal + org, with push access first). */
export async function listUserRepositories(accessToken: string): Promise<GitHubRepoSummary[]> {
  const out: GitHubRepoSummary[] = [];
  let page = 1;
  while (page <= 5) {
    const res = await ghFetch(`/user/repos?per_page=100&page=${page}&sort=updated&affiliation=owner,organization_member`, accessToken);
    if (!res.ok) throw AppError.integration(`GitHub returned ${res.status} while listing your repositories.`);
    const batch = (await res.json()) as GitHubRepoSummary[];
    out.push(...batch);
    if (batch.length < 100) break;
    page += 1;
  }
  return out;
}

export async function getRepository(accessToken: string, owner: string, repo: string): Promise<GitHubRepoSummary> {
  const res = await ghFetch(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, accessToken);
  if (!res.ok) {
    if (res.status === 404) throw AppError.notFound('Repository');
    throw AppError.integration(`GitHub returned ${res.status} for ${owner}/${repo}.`);
  }
  return (await res.json()) as GitHubRepoSummary;
}

export interface TreeEntry {
  path: string;
  type: 'blob' | 'tree';
  size?: number;
}

export async function listTree(ref: RepoRef, token: string): Promise<TreeEntry[]> {
  const branch = ref.ref ?? 'HEAD';
  const res = await ghFetch(
    `/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
    token,
  );
  if (!res.ok) {
    throw AppError.integration(
      `Could not list files in ${ref.owner}/${ref.repo} (HTTP ${res.status}).`,
      'The ref may not exist, or the installation may have lost access.',
    );
  }
  const json = (await res.json()) as { tree?: TreeEntry[]; truncated?: boolean };
  return json.tree ?? [];
}

/** Fetches a single file's contents, decoded from base64 when possible. */
export async function fetchFile(ref: RepoRef, token: string, path: string): Promise<string | null> {
  const res = await ghFetch(
    `/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}/contents/${path
      .split('/')
      .map(encodeURIComponent)
      .join('/')}?ref=${encodeURIComponent(ref.ref ?? 'HEAD')}`,
    token,
  );
  if (!res.ok) return null;
  const json = (await res.json()) as { content?: string; encoding?: string; size?: number };
  if (!json.content) return null;
  if (json.encoding === 'base64') {
    return Buffer.from(json.content.replace(/\n/g, ''), 'base64').toString('utf8');
  }
  return json.content;
}

/**
 * Downloads and filters a repository tarball.
 * Used for uploaded archives and as a fallback when the trees API is limited.
 */
export async function extractTarball(
  gzip: Buffer,
  filter: (path: string, size: number) => boolean,
): Promise<Map<string, string>> {
  if (gzip.byteLength > SCAN_LIMITS.maxTarballBytes) {
    throw AppError.badRequest('That archive is too large to scan.');
  }

  let tar: Buffer;
  try {
    tar = gunzipSync(gzip);
  } catch {
    throw AppError.badRequest('That file is not a valid gzip archive.');
  }

  const files = new Map<string, string>();
  let totalBytes = 0;

  await new Promise<void>((resolve, reject) => {
    const extractor = tarExtract();

    extractor.on('entry', (header, stream, next) => {
      const rawPath = header.name.replace(/^[^/]+\//, ''); // drop the top-level dir
      const chunks: Buffer[] = [];
      let size = 0;

      stream.on('data', (raw: unknown) => {
        const chunk = raw as Buffer;
        size += chunk.byteLength;
        if (size <= SCAN_LIMITS.maxFileBytes && totalBytes + size <= SCAN_LIMITS.maxTotalBytes) {
          chunks.push(chunk);
        }
      });

      stream.on('end', () => {
        if (header.type === 'file' && filter(rawPath, size) && files.size < SCAN_LIMITS.maxFiles) {
          const content = Buffer.concat(chunks);
          files.set(rawPath, content.toString('utf8'));
          totalBytes += content.byteLength;
        }
        next();
      });

      stream.on('error', reject);
      stream.resume();
    });

    extractor.on('finish', resolve);
    extractor.on('error', reject);
    Readable.from(tar).pipe(extractor);
  });

  return files;
}

export async function downloadTarball(ref: RepoRef, token: string): Promise<Buffer> {
  const res = await fetch(
    `${API}/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}/tarball/${encodeURIComponent(ref.ref ?? 'HEAD')}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'cra-compliance-os',
      },
      redirect: 'follow',
    },
  );
  if (!res.ok) throw AppError.integration(`Could not download repository archive (HTTP ${res.status}).`);
  return Buffer.from(await res.arrayBuffer());
}

/** Completes the GitHub OAuth code exchange. */
export async function exchangeOAuthCode(code: string): Promise<{
  accessToken: string;
  login: string;
  accountId: string;
  avatarUrl: string | null;
  email: string | null;
  name: string | null;
}> {
  const clientId = env.GITHUB_CLIENT_ID;
  const clientSecret = env.GITHUB_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw AppError.integration(
      'GitHub OAuth is not configured on this deployment.',
      'Set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET to enable "Continue with GitHub".',
    );
  }

  const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
  });
  const tokenJson = (await tokenRes.json()) as { access_token?: string; error?: string };
  if (!tokenJson.access_token) {
    throw AppError.integration(`GitHub OAuth failed: ${tokenJson.error ?? 'unknown error'}`);
  }

  const userRes = await ghFetch('/user', tokenJson.access_token);
  const user = (await userRes.json()) as Record<string, any>;

  return {
    accessToken: tokenJson.access_token,
    login: String(user.login ?? ''),
    accountId: String(user.id ?? ''),
    avatarUrl: typeof user.avatar_url === 'string' ? user.avatar_url : null,
    email: typeof user.email === 'string' ? user.email : null,
    name: typeof user.name === 'string' ? user.name : null,
  };
}
