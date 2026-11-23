// Pre-token radar, a token-radar-01 entry. Node 22, standard library only.
//
// Reads the sealed snapshot (/input/snapshot.json, or --input <file|dir>), ranks every protocol that
// records no token by implied value, and writes /output: board.json (the gate's rows), data.js (the raw
// snapshot the page reads), dashboard/ and screenshots/ (copied), then dossier.json via the vendored
// make.fun library.
//
// The model lives in dashboard/model.js so the page and this program run the very same code: main.ts
// evaluates it in a node:vm context, the page loads it as a script. Both runs write identical bytes:
// nothing here reads the clock, the environment (besides the output path) or a random source.
//
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createContext, runInContext } from 'node:vm';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

interface Protocol {
  slug: string; name: string; category: string | null; chains: string[]; tvl_usd: number;
  change_7d: number | null; mcap_usd: number | null; listed_at: string | null; gecko_id: string | null; symbol: string | null;
}
interface Snapshot { as_of: string; source: string; floor_usd: number; protocols: Protocol[]; watchlist: string[] }
interface Row { slug: string; name: string; rank: number; implied_value_usd: number; farm_steps: string[] }

function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  return eq === undefined ? fallback : eq.slice(name.length + 3);
}

function fail(message: string): never {
  process.stderr.write(`pre-token radar: ${message}\n`);
  process.exit(1);
}

/** The snapshot, checked for the shape the model relies on. */
function readSnapshot(file: string): Snapshot {
  const s = JSON.parse(readFileSync(file, 'utf8')) as Snapshot;
  if (typeof s.as_of !== 'string' || !Array.isArray(s.protocols) || !Array.isArray(s.watchlist)) fail(`${file} is not a token-radar snapshot`);
  for (const p of s.protocols) {
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Array.isArray(p.chains)) fail(`protocol ${JSON.stringify(p.slug)} is malformed`);
  }
  return s;
}

/** dashboard/model.js, evaluated the way a browser would: it sets RadarModel on its global. */
function loadModel(): { build: (s: Snapshot) => unknown; boardRows: (r: unknown) => Row[] } {
  const sandbox: Record<string, unknown> = {};
  sandbox.globalThis = sandbox;
  createContext(sandbox);
  runInContext(readFileSync(join(here, 'dashboard', 'model.js'), 'utf8'), sandbox, { filename: 'dashboard/model.js' });
  const model = sandbox.RadarModel as ReturnType<typeof loadModel> | undefined;
  if (!model) fail('dashboard/model.js did not define RadarModel');
  return model;
}

/** Why the gate would refuse these rows, or null: the same seven-row rules, checked before writing. */
function gateIssue(rows: Row[], snap: Snapshot): string | null {
  if (rows.length < 100 || rows.length > 4000) return `${rows.length} rows (the gate takes 100 to 4000)`;
  const known = new Set(snap.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  for (const [i, r] of rows.entries()) {
    if (!known.has(r.slug)) return `${r.slug} is not in the snapshot`;
    if (seen.has(r.slug)) return `${r.slug} appears twice`;
    seen.add(r.slug);
    if (r.rank !== i + 1) return `row ${i} has rank ${r.rank}`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 1e14) return `${r.slug} has implied value ${r.implied_value_usd}`;
    if (i > 0 && r.implied_value_usd > rows[i - 1]!.implied_value_usd) return `${r.slug} outranks a cheaper row`;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const step of r.farm_steps) {
      const n = step.trim().length;
      if (n < 20 || n > 600) return `${r.slug} has a ${n}-character farm step`;
    }
  }
  if (rows[0]!.implied_value_usd === rows[rows.length - 1]!.implied_value_usd) return 'every row has the same implied value';
  const missing = snap.watchlist.filter((s) => !seen.has(s));
  return missing.length ? `watchlist not covered: ${missing.join(', ')}` : null;
}

/** Copy a directory's plain files (no dot names) into `to`; returns the names copied. */
function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const names = readdirSync(from).filter((n) => !n.startsWith('.') && statSync(join(from, n)).isFile()).sort();
  for (const n of names) copyFileSync(join(from, n), join(to, n));
  return names;
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) fail(`no snapshot at ${inputFile}: pass --input <snapshot.json|dir> or mount /input`);
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snap = readSnapshot(inputFile);
const model = loadModel();
const rows = model.boardRows(model.build(snap));
const issue = gateIssue(rows, snap);
if (issue) fail(`the board would fail the gate: ${issue}`);

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ as_of: snap.as_of, model: 'pre-token radar / peer-multiple v1', rows }, null, 1)}\n`);
// The page reads the snapshot itself and recomputes the board with dashboard/model.js.
writeFileSync(join(out, 'data.js'), `window.SNAPSHOT = ${JSON.stringify(snap)};\n`);

const pages = copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3 || shots.length > 4) fail(`screenshots/ holds ${shots.length} images: hand in 3 or 4`);

writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, { text_max_bytes: 65_536, screenshots: { max: 4, max_bytes: 524_288 }, dashboard: { max_files: 400, max_bytes: 4_194_304 } }),
);

const inWatch = rows.filter((r) => snap.watchlist.includes(r.slug)).length;
process.stdout.write(
  `pre-token radar: ${snap.protocols.length} protocols in the snapshot, ${rows.length} pre-token rows ranked, ` +
    `watchlist ${inWatch}/${snap.watchlist.length}\n` +
    `pre-token radar: wrote board.json, data.js, dashboard/ (${pages.length} files), screenshots/ (${shots.length}) and dossier.json to ${out}\n`,
);
