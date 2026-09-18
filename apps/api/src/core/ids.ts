import { customAlphabet } from 'nanoid';

// Lowercase + digits only: ids appear in URLs, purls and filenames.
const alphabet = '0123456789abcdefghijklmnopqrstuvwxyz';
const nano = customAlphabet(alphabet, 22);

export type IdPrefix =
  | 'usr' | 'ses' | 'mlk' | 'idn' | 'org' | 'mem' | 'inv'
  | 'itg' | 'prj' | 'repo' | 'scan' | 'cmp' | 'dep' | 'sbom'
  | 'cv' | 'asm' | 'evd' | 'rep' | 'inc' | 'iev' | 'irp'
  | 'cac' | 'ctx' | 'usg' | 'pay' | 'sub' | 'key' | 'whk' | 'whd'
  | 'ntf' | 'aud' | 'job' | 'jev' | 'anl' | 'shr' | 'ref' | 'pk' | 'pln' | 'cpn'
  | 'ctl';

/** Creates a prefixed, URL-safe, sortable-enough identifier. */
export function newId(prefix: IdPrefix): string {
  return `${prefix}_${nano()}`;
}

/** Short, human-quotable token used for magic links, invites and share links. */
export const newToken = customAlphabet(alphabet, 32);

/** Human-friendly referral code, e.g. `cra-7f3k9q`. */
export const newReferralCode = customAlphabet(alphabet, 8);

export function slugify(input: string): string {
  const base = input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  const suffix = customAlphabet(alphabet, 5)();
  return base ? `${base}-${suffix}` : suffix;
}
