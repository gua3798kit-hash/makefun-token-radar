// Self-check of the token-radar-01 gate's seven rows against an output directory, plus determinism.
// Node 22, standard library only. Not part of the entry's run: a tool for whoever builds or reviews it.
//
//   node tools/check.ts <output dir> <snapshot.json>
//
// It mirrors the published gate rules (RULES.txt, "The gate"); the sealed scorer remains the authority.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { buildDossier } from '../vendor/makefun-board.ts';

const [outDir, snapFile] = process.argv.slice(2);
if (!outDir || !snapFile) {
  process.stderr.write('usage: node tools/check.ts <output dir> <snapshot.json>\n');
  process.exit(2);
}

const results: [string, boolean, string][] = [];
const NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
const URL_IN_ATTR = /\s[\w:-]+\s*=\s*["']?\s*https?:\/\//i;
const URL_IN_CSS = /https?:\/\//i;
const URL_IN_IMPORT = /(?:import\s*(?:[^'"]*from\s*)?|export\s[^'"]*from\s*|require\s*\(\s*|import\s*\(\s*)['"]https?:\/\//;

function walk(dir: string, rel = ''): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p, `${rel}${n}/`) : [`${rel}${n}`];
  });
}

// 1. dashboard_files
{
  const dir = join(outDir, 'dashboard');
  const files = walk(dir);
  let bytes = 0;
  let issue = '';
  for (const f of files) {
    const body = readFileSync(join(dir, f), 'utf8');
    bytes += statSync(join(dir, f)).size;
    if (!f.split('/').every((part) => NAME.test(part))) issue ||= `${f}: bad name`;
    if (f.endsWith('.html')) {
      const styles = [...body.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]!).join('');
      const tags = body.replace(/<!--[\s\S]*?-->/g, '').match(/<[a-z][^>]*>/gi) ?? [];
      if (tags.some((t) => URL_IN_ATTR.test(t)) || URL_IN_CSS.test(styles)) issue ||= `${f}: network address in markup`;
    }
    if (f.endsWith('.css') && URL_IN_CSS.test(body.replace(/\/\*[\s\S]*?\*\//g, ''))) issue ||= `${f}: network address in CSS`;
    if (/\.(m?js)$/.test(f) && URL_IN_IMPORT.test(body)) issue ||= `${f}: network import`;
  }
  const has = (re: RegExp) => files.some((f) => re.test(f));
  if (!files.includes('index.html')) issue ||= 'no index.html';
  if (!has(/\.css$/) || !has(/\.js$/)) issue ||= 'needs a .css and a .js';
  if (files.length > 400 || bytes > 4 * 1024 * 1024) issue ||= `${files.length} files, ${bytes} bytes`;
  results.push(['dashboard_files', !issue, issue || `${files.length} files, ${bytes} bytes`]);
}

// 2-5. board_file, sorted_by_value, coverage, farm_steps
const snap = JSON.parse(readFileSync(snapFile, 'utf8')) as { protocols: { slug: string }[]; watchlist: string[] };
const raw = JSON.parse(readFileSync(join(outDir, 'board.json'), 'utf8'));
const rows = (Array.isArray(raw) ? raw : raw.rows) as { slug: string; name: string; rank: number; implied_value_usd: number; farm_steps: string[] }[];
{
  const known = new Set(snap.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  let issue = '';
  if (rows.length < 100 || rows.length > 4000) issue = `${rows.length} rows`;
  for (const r of rows) {
    if (typeof r.slug !== 'string' || /\s/.test(r.slug) || !known.has(r.slug)) issue ||= `invented slug ${r.slug}`;
    if (seen.has(r.slug)) issue ||= `duplicate ${r.slug}`;
    seen.add(r.slug);
    if (typeof r.name !== 'string' || !r.name) issue ||= `${r.slug}: empty name`;
    if (!Number.isSafeInteger(r.rank) || r.rank < 1) issue ||= `${r.slug}: rank ${r.rank}`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd < 1 || r.implied_value_usd > 1e14) issue ||= `${r.slug}: value ${r.implied_value_usd}`;
    if (!Array.isArray(r.farm_steps)) issue ||= `${r.slug}: no farm_steps`;
  }
  if (statSync(join(outDir, 'board.json')).size > 8 * 1024 * 1024) issue ||= 'over 8 MiB';
  results.push(['board_file', !issue, issue || `${rows.length} rows`]);

  const byRank = [...rows].sort((a, b) => a.rank - b.rank);
  let order = byRank.every((r, i) => r.rank === i + 1) ? '' : 'ranks are not exactly 1..N';
  for (let i = 1; i < byRank.length && !order; i++) if (byRank[i]!.implied_value_usd > byRank[i - 1]!.implied_value_usd) order = `rank ${i + 1} worth more than rank ${i}`;
  if (new Set(rows.map((r) => r.implied_value_usd)).size === 1) order ||= 'all values equal';
  results.push(['sorted_by_value', !order, order || `rank 1 ${byRank[0]!.implied_value_usd} .. rank ${byRank.length} ${byRank.at(-1)!.implied_value_usd}`]);

  const missing = snap.watchlist.filter((s) => !seen.has(s));
  results.push(['coverage', missing.length === 0, missing.length ? `missing ${missing.join(', ')}` : `${snap.watchlist.length}/${snap.watchlist.length}`]);

  const lens = rows.flatMap((r) => r.farm_steps.map((s) => s.trim().length));
  const badRow = rows.find((r) => r.farm_steps.length < 3 || r.farm_steps.length > 12 || r.farm_steps.some((s) => s.trim().length < 20 || s.trim().length > 600));
  results.push(['farm_steps', !badRow, badRow ? `${badRow.slug}` : `step lengths ${Math.min(...lens)}..${Math.max(...lens)}`]);
}

// 6. screenshots
{
  const dir = join(outDir, 'screenshots');
  const names = readdirSync(dir).filter((n) => !n.startsWith('.')).sort();
  let issue = names.length < 3 || names.length > 4 ? `${names.length} images` : '';
  const dims: string[] = [];
  for (const n of names) {
    const b = readFileSync(join(dir, n));
    let w = 0, h = 0;
    if (b[0] === 0x89 && b.toString('latin1', 1, 4) === 'PNG') { w = b.readUInt32BE(16); h = b.readUInt32BE(20); }
    else if (b[0] === 0xff && b[1] === 0xd8) {
      for (let i = 2; i < b.length - 9;) {
        const marker = b[i + 1]!, len = b.readUInt16BE(i + 2);
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) { h = b.readUInt16BE(i + 5); w = b.readUInt16BE(i + 7); break; }
        i += 2 + len;
      }
    } else issue ||= `${n}: not PNG/JPEG`;
    if (!NAME.test(n)) issue ||= `${n}: bad name`;
    if (b.length > 524_288) issue ||= `${n}: ${b.length} bytes`;
    if (Math.max(w, h) > 1440 || Math.min(w, h) < 800) issue ||= `${n}: ${w}x${h}`;
    dims.push(`${n} ${w}x${h} ${Math.round(b.length / 1024)}KB`);
  }
  results.push(['screenshots', !issue, issue || dims.join(', ')]);
}

// 7. dossier_matches
{
  const want = Buffer.from(buildDossier(outDir, { text_max_bytes: 65_536 }));
  const got = readFileSync(join(outDir, 'dossier.json'));
  const text = JSON.parse(got.toString('utf8')).text as string;
  const ok = want.equals(got) && got.length <= 1.5 * 1024 * 1024;
  results.push(['dossier_matches', ok, `${got.length} bytes, text ${Buffer.byteLength(text)} of 65536${/left out|not shown/.test(text) ? ' (CUT)' : ', nothing cut'}`]);
}

for (const [name, ok, detail] of results) process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(16)} ${detail}\n`);
process.exit(results.every((r) => r[1]) ? 0 : 1);
