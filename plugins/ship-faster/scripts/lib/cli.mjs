// Switches never take a value, so `carry --json a.txt b.txt` keeps a.txt as a path instead of the value of --json.
const SWITCHES = new Set(['json', 'brief', 'continue', 'here', 'check', 'force', 'dry-run']);

export function parseArgs(argv) {
  const out = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') { out._.push(...argv.slice(i + 1)); break; }
    if (!a.startsWith('--')) { out._.push(a); continue; }
    const eq = a.indexOf('=');
    if (eq !== -1) { setFlag(out.flags, a.slice(2, eq), a.slice(eq + 1)); continue; }
    const key = a.slice(2);
    const next = argv[i + 1];
    if (!SWITCHES.has(key) && next !== undefined && !next.startsWith('--')) { setFlag(out.flags, key, next); i++; }
    else setFlag(out.flags, key, true);
  }
  return out;
}

function setFlag(flags, key, value) {
  flags[key] = key in flags ? [].concat(flags[key], value) : value;
}

export function flagList(flags, key) {
  if (!(key in flags)) return [];
  return [].concat(flags[key]).map(String);
}

export function readStdinJson(timeoutMs = 1500) {
  if (process.stdin.isTTY) return Promise.resolve(null);
  return new Promise((resolve) => {
    let data = '';
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      // An stdin pipe nobody closes keeps the event loop alive; release it or the hook never exits.
      try {
        process.stdin.pause();
        process.stdin.removeAllListeners();
        process.stdin.on('error', () => {});
        if (typeof process.stdin.unref === 'function') process.stdin.unref();
      } catch {}
      resolve(value);
    };
    const timer = setTimeout(() => finish(safeParse(data)), timeoutMs);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { data += c; });
    process.stdin.on('end', () => finish(safeParse(data)));
    process.stdin.on('error', () => finish(null));
  });
}

function safeParse(text) {
  if (!text || !text.trim()) return null;
  try {
    const v = JSON.parse(text);
    return v && typeof v === 'object' ? v : null;
  } catch { return null; }
}

export function emit(result, flags = {}) {
  const ok = result.ok !== false;
  if (flags.json) {
    process.stdout.write(JSON.stringify(result) + '\n');
    process.exitCode = 0;
    return;
  }
  const lines = result.summary !== undefined ? [].concat(result.summary) : [ok ? 'ok' : `error: ${result.error}`];
  process.stdout.write(lines.join('\n') + '\n');
  process.exitCode = ok ? 0 : 1;
}

export function fail(error, flags = {}, extra = {}) {
  emit({ ok: false, error, ...extra }, flags);
}

export function runMain(fn) {
  const { _, flags } = parseArgs(process.argv.slice(2));
  Promise.resolve()
    .then(() => fn(_, flags))
    .then((result) => { if (result) emit(result, flags); })
    .catch((e) => fail(String((e && e.message) || e), flags));
}
