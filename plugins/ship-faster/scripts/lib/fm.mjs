const OPEN = /^---\r?\n([\s\S]*?)(?:\r?\n)?---(?:\r?\n|$)/;

export function parseFrontmatter(text) {
  const m = OPEN.exec(text);
  if (!m) return { data: null, body: text, raw: null, errors: [] };
  const raw = m[1];
  const body = text.slice(m[0].length);
  const lines = raw.split(/\r?\n/);
  const data = {};
  const errors = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const lineNo = i + 2;
    if (!line.trim() || line.trim().startsWith('#')) { i++; continue; }
    const kv = /^([A-Za-z_][\w-]*):(?:\s+(.*))?$/.exec(line);
    if (!kv) { errors.push({ line: lineNo, message: `expected "key: value", got "${line}"` }); i++; continue; }
    const key = kv[1];
    const rest = (kv[2] || '').trim();
    if (rest === '') {
      const block = parseBlock(lines, i + 1, lineNo + 1, errors);
      if (block.value !== undefined) data[key] = block.value;
      i = block.next;
      continue;
    }
    if (rest.startsWith('[')) {
      const list = parseInlineList(rest, lineNo, errors);
      if (list !== undefined) data[key] = list;
    } else {
      data[key] = parseScalar(rest);
    }
    i++;
  }
  return { data, body, raw, errors };
}

function parseBlock(lines, start, startLineNo, errors) {
  let i = start;
  while (i < lines.length && !lines[i].trim()) i++;
  if (i >= lines.length || !/^\s+/.test(lines[i])) {
    return { value: null, next: i };
  }
  const first = lines[i];
  if (!/^\s+-\s/.test(first) && !/^\s+-$/.test(first)) {
    errors.push({ line: startLineNo + (i - start), message: 'nested map is not supported; use a block list or an inline list' });
    while (i < lines.length && /^\s+/.test(lines[i])) i++;
    return { value: undefined, next: i };
  }
  const indent = first.match(/^\s*/)[0].length;
  const items = [];
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    const lead = line.match(/^\s*/)[0].length;
    if (lead < indent) break;
    if (lead === indent && /^\s*-(\s|$)/.test(line)) {
      const rest = line.slice(indent + 1).trim();
      const kv = /^([A-Za-z_][\w-]*):(?:\s+(.*))?$/.exec(rest);
      if (kv) {
        const obj = {};
        obj[kv[1]] = parseScalar((kv[2] || '').trim());
        i++;
        while (i < lines.length) {
          const l = lines[i];
          if (!l.trim()) { i++; continue; }
          const ll = l.match(/^\s*/)[0].length;
          if (ll <= indent) break;
          const kv2 = /^\s+([A-Za-z_][\w-]*):(?:\s+(.*))?$/.exec(l);
          if (!kv2) { errors.push({ line: startLineNo + (i - start), message: `expected "key: value" inside list item, got "${l.trim()}"` }); i++; continue; }
          obj[kv2[1]] = parseScalar((kv2[2] || '').trim());
          i++;
        }
        items.push(obj);
        continue;
      }
      items.push(parseScalar(rest));
      i++;
      continue;
    }
    errors.push({ line: startLineNo + (i - start), message: `unexpected line in block list: "${line.trim()}"` });
    i++;
  }
  const kinds = new Set(items.map((x) => (x && typeof x === 'object' ? 'map' : 'scalar')));
  if (kinds.size > 1) errors.push({ line: startLineNo, message: 'block list mixes scalars and maps' });
  return { value: items, next: i };
}

function parseInlineList(rest, lineNo, errors) {
  const close = rest.lastIndexOf(']');
  if (close === -1) { errors.push({ line: lineNo, message: 'inline list is missing "]"' }); return undefined; }
  const inner = rest.slice(1, close);
  const items = [];
  let cur = '';
  let quote = null;
  for (let k = 0; k < inner.length; k++) {
    const ch = inner[k];
    if (quote) {
      cur += ch;
      if (ch === '\\' && quote === '"' && k + 1 < inner.length) { cur += inner[++k]; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue; }
    if (ch === ',') { items.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim() !== '' || items.length) items.push(cur);
  return items.map((s) => s.trim()).filter((s) => s !== '').map((s) => parseScalar(s));
}

function parseScalar(raw) {
  let s = raw;
  if (s.startsWith('"')) {
    const end = s.lastIndexOf('"');
    return s.slice(1, end).replace(/\\(["\\])/g, '$1');
  }
  if (s.startsWith("'")) {
    const end = s.lastIndexOf("'");
    return s.slice(1, end).replace(/''/g, "'");
  }
  const hash = s.indexOf(' #');
  if (hash !== -1) s = s.slice(0, hash).trim();
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (s === 'null' || s === '~' || s === '') return null;
  if (/^-?\d+$/.test(s)) return Number(s);
  return s;
}

const NEEDS_QUOTES = /[:#,\[\]{}"'\\]|^\s|\s$|^$|^-?\d+$|^(true|false|null|~)$/;
const NEEDS_QUOTES_FLOW = /[\s:#,\[\]{}"'\\]|^$|^-?\d+$|^(true|false|null|~)$/;

function scalarToYaml(v, isFlow = false) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  const s = String(v);
  const regex = isFlow ? NEEDS_QUOTES_FLOW : NEEDS_QUOTES;
  return regex.test(s) ? `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"` : s;
}

export function serializeFrontmatter(data) {
  const out = ['---'];
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      if (value.length && value.every((x) => x && typeof x === 'object')) {
        out.push(`${key}:`);
        for (const item of value) {
          const entries = Object.entries(item).filter(([, v]) => v !== undefined);
          entries.forEach(([k, v], idx) => out.push(`${idx === 0 ? '  - ' : '    '}${k}: ${scalarToYaml(v)}`));
        }
      } else {
        out.push(`${key}: [${value.map(v => scalarToYaml(v, true)).join(', ')}]`);
      }
      continue;
    }
    out.push(`${key}: ${scalarToYaml(value)}`);
  }
  out.push('---');
  return out.join('\n') + '\n';
}

export function updateFrontmatter(text, patch) {
  const parsed = parseFrontmatter(text);
  const merged = {};
  for (const [k, v] of Object.entries(parsed.data || {})) {
    if (k in patch) { if (patch[k] !== undefined) merged[k] = patch[k]; }
    else merged[k] = v;
  }
  for (const [k, v] of Object.entries(patch)) {
    if (!(k in merged) && v !== undefined && !(parsed.data && k in parsed.data)) merged[k] = v;
  }
  return serializeFrontmatter(merged) + parsed.body;
}
