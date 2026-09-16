import { statSync } from 'node:fs';
import { join } from 'node:path';

export const RISKY = [
  [/(^|\/)\.env(\..*)?$/, 'env file'],
  [/\.(pem|key|p12|pfx)$/i, 'key material'],
  [/credential/i, 'credential file'],
  [/secret/i, 'secret file'],
  [/(^|\/)node_modules\//, 'dependency directory'],
  [/(^|\/)(dist|build)\//, 'build output'],
  [/\.log$/, 'log file'],
];

export function riskyReason(path) {
  const hit = RISKY.find(([re]) => re.test(path));
  return hit ? hit[1] : null;
}

export function isLarge(root, path, limit = 5 * 1024 * 1024) {
  try { return statSync(join(root, path)).size > limit; } catch { return false; }
}
