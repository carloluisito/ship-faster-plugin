function skipQuoted(s, i, q) {
  i++;
  while (i < s.length && s[i] !== q) { if (q === '"' && s[i] === '\\' && i + 1 < s.length) i++; i++; }
  return i;
}

function findMatchingParen(s, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < s.length; i++) {
    const ch = s[i];
    if (ch === '\\' && i + 1 < s.length) { i++; continue; }
    if (ch === '"' || ch === "'") { i = skipQuoted(s, i, ch); continue; }
    if (ch === '(') depth++;
    else if (ch === ')') { depth--; if (depth === 0) return i; }
  }
  return -1;
}

function findMatchingBacktick(s, openIdx) {
  for (let i = openIdx + 1; i < s.length; i++) {
    const ch = s[i];
    if (ch === '\\' && i + 1 < s.length) { i++; continue; }
    if (ch === '"' || ch === "'") { i = skipQuoted(s, i, ch); continue; }
    if (ch === '`') return i;
  }
  return -1;
}

export function splitSegments(command) {
  const out = [];
  let cur = '';
  let quote = null;
  const s = String(command);
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quote !== "'" && ch === '$' && s[i + 1] === '(') {
      const close = findMatchingParen(s, i + 1);
      if (close !== -1) { out.push(...splitSegments(s.slice(i + 2, close))); i = close; continue; }
    }
    if (quote !== "'" && ch === '`') {
      const close = findMatchingBacktick(s, i);
      if (close !== -1) { out.push(...splitSegments(s.slice(i + 1, close))); i = close; continue; }
    }
    if (quote) {
      cur += ch;
      if (ch === '\\' && quote === '"' && i + 1 < s.length) { cur += s[++i]; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '\\' && i + 1 < s.length) { cur += ch + s[++i]; continue; }
    if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue; }
    if (ch === '\n' || ch === ';') { out.push(cur); cur = ''; continue; }
    if ((ch === '&' || ch === '|') && s[i + 1] === ch) { out.push(cur); cur = ''; i++; continue; }
    if (ch === '|') { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}

export function tokenize(segment) {
  const tokens = [];
  let cur = '';
  let has = false;
  let quote = null;
  const s = String(segment);
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quote) {
      if (ch === quote) { quote = null; continue; }
      if (ch === '\\' && quote === '"' && i + 1 < s.length) { cur += s[++i]; continue; }
      cur += ch;
      continue;
    }
    if (ch === '\\' && i + 1 < s.length) { cur += s[++i]; has = true; continue; }
    if (ch === '"' || ch === "'") { quote = ch; has = true; continue; }
    if (/\s/.test(ch)) { if (has || cur) { tokens.push(cur); cur = ''; has = false; } continue; }
    cur += ch;
    has = true;
  }
  if (has || cur) tokens.push(cur);
  return tokens;
}
