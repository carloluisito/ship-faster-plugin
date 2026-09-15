const cache = new Map();

export function normalizePath(p) {
  let s = String(p).replace(/\\/g, '/').replace(/\/{2,}/g, '/');
  while (s.startsWith('./')) s = s.slice(2);
  return s;
}

export function compileGlob(pattern) {
  const hit = cache.get(pattern);
  if (hit) return hit;
  let pat = normalizePath(pattern.trim());
  let dirOnly = false;
  if (pat.endsWith('/')) { dirOnly = true; pat = pat.slice(0, -1); }
  let anchored = false;
  if (pat.startsWith('/')) { anchored = true; pat = pat.slice(1); }
  if (pat.includes('/')) anchored = true;
  const body = globToRegexSource(pat);
  const prefix = anchored ? '^' : '^(?:.*/)?';
  const suffix = dirOnly ? '/.+$' : '$';
  const re = new RegExp(prefix + body + suffix);
  cache.set(pattern, re);
  return re;
}

function globToRegexSource(pat) {
  let out = '';
  let i = 0;
  while (i < pat.length) {
    const ch = pat[i];
    if (ch === '*') {
      if (pat[i + 1] === '*') {
        const before = i === 0 || pat[i - 1] === '/';
        const after = i + 2 >= pat.length || pat[i + 2] === '/';
        if (before && after) {
          if (i + 2 >= pat.length) { out += '.*'; i += 2; continue; }
          out += '(?:.*/)?';
          i += 3;
          continue;
        }
        out += '.*';
        i += 2;
        continue;
      }
      out += '[^/]*';
      i++;
      continue;
    }
    if (ch === '?') { out += '[^/]'; i++; continue; }
    if (ch === '{') {
      const close = pat.indexOf('}', i);
      if (close !== -1) {
        const alts = pat.slice(i + 1, close).split(',').map((a) => globToRegexSource(a));
        out += `(?:${alts.join('|')})`;
        i = close + 1;
        continue;
      }
    }
    out += /[.+^$()|[\]\\{}]/.test(ch) ? `\\${ch}` : ch;
    i++;
  }
  return out;
}

export function matchGlob(pattern, path) {
  return compileGlob(pattern).test(normalizePath(path));
}

export function anyMatch(patterns, path) {
  const p = normalizePath(path);
  return (patterns || []).some((g) => compileGlob(g).test(p));
}

export function filterPaths(patterns, paths) {
  return paths.filter((p) => anyMatch(patterns, p));
}
