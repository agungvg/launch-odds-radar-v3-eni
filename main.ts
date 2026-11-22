// Launch-Odds Radar v3 — entrypoint (Node 22, standard library only).
//
// Reads the sealed snapshot, fits the launch-odds model in lib/model.ts,
// writes the ranked board, the dashboard data, and the judge dossier.
// Run locally with:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
// In the grader the snapshot is at /input/snapshot.json and output is /output.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildBoard, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const TEXT_MAX_BYTES = 65_536;

function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  return eq === undefined ? fallback : eq.slice(name.length + 3);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`launch-odds-radar-v3: no snapshot at ${inputFile}\n`);
  process.exit(2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildBoard(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) {
  process.stderr.write(`launch-odds-radar-v3: board refused: ${issue}\n`);
  process.exit(1);
}
// Second integrity check, separate from the gate rows above: the four
// accounting groups must sum to the snapshot total, and the verdict
// counts must sum to the board length. A model that cannot account for
// its own universe is not handed in, even if the gate would take it.
const a = radar.accounting;
if (a.ranked + a.excludedPreToken + a.tokenRecordedNoMcap + a.traded !== a.total) {
  process.stderr.write(`launch-odds-radar-v3: accounting does not sum to ${a.total}\n`);
  process.exit(1);
}
const vc = radar.verdictCounts.Farm + radar.verdictCounts.Thin + radar.verdictCounts.Skip;
if (vc !== board.length) {
  process.stderr.write(`launch-odds-radar-v3: verdicts sum to ${vc}, board is ${board.length}\n`);
  process.exit(1);
}

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3) {
  process.stderr.write(`launch-odds-radar-v3: screenshots/ holds ${shots.length} images: hand in 3\n`);
  process.exit(1);
}
for (const name of shots) {
  if (!/^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/.test(name)) {
    process.stderr.write(`launch-odds-radar-v3: screenshots/${name}: bad name\n`);
    process.exit(1);
  }
}

writeFileSync(join(out, 'dossier.json'), buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: { max: 4, max_bytes: 524_288 }, dashboard: { max_files: 400, max_bytes: 4_194_304 } }));

const h = radar.holdouts;
process.stdout.write(
  `launch-odds-radar-v3: ${snapshot.protocols.length} protocols, watchlist ${snapshot.watchlist.length}, board ${board.length} rows\n` +
    `launch-odds-radar-v3: fit a=${radar.fit.a} b=${radar.fit.b} c=${radar.fit.c} global multiple ${radar.fit.globalMultiple} full miss x${radar.fit.fullMiss} vs naive x${radar.fit.fullNaive} (n=${radar.fit.tradedN})\n` +
    `launch-odds-radar-v3: ${h[0]!.name}: fitted x${h[0]!.fittedMiss} vs naive x${h[0]!.naiveMiss}\n` +
    `launch-odds-radar-v3: ${h[1]!.name}: fitted x${h[1]!.fittedMiss} vs naive x${h[1]!.naiveMiss}\n` +
    `launch-odds-radar-v3: accounting ${radar.accounting.ranked} ranked + ${radar.accounting.excludedPreToken} excluded pre-token + ${radar.accounting.tokenRecordedNoMcap} token-recorded no-mcap + ${radar.accounting.traded} traded = ${radar.accounting.total}\n` +
    `launch-odds-radar-v3: verdicts Farm ${radar.verdictCounts.Farm} Thin ${radar.verdictCounts.Thin} Skip ${radar.verdictCounts.Skip}\n` +
    `launch-odds-radar-v3: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, ${join(out, 'dashboard')}, ${join(out, 'screenshots')} (${shots.length}) and ${join(out, 'dossier.json')}\n`,
);
