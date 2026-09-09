#!/usr/bin/env node
/**
 * Freeze the plugin into dist/marketplace/ so it can be installed and tested
 * WITHOUT the install tracking the working tree.
 *
 *   node tools/pack-plugin.mjs          # or: npm run pack
 *   node tools/pack-plugin.mjs --json
 *
 * ==================================================================
 * WHY THIS EXISTS
 * ==================================================================
 *
 * A directory-source marketplace entry resolves a skill's base directory to the
 * directory it points at, not to a versioned copy under ~/.claude/plugins/cache/.
 * Adding this repository as a marketplace therefore points the installed plugin
 * straight at the working tree: a half-finished edit to SKILL.md or to a script is
 * live in the "installed" plugin the moment it is saved, and a test run cannot
 * tell you whether the shipped copy works, only whether the working copy does.
 *
 * That is fine while writing a skill and useless while testing one. The two
 * candidate fixes were to document a procedure or to change how installation
 * works for testing. This is the second, because a documented procedure that
 * depends on remembering to run it is the same class of thing as a safety rule
 * written in prose -- see the rest of this project's opinion about those.
 *
 * So: pack copies plugins/nole-schedule into dist/marketplace/, a directory nobody
 * edits, and you install THAT. dist/ is gitignored. The working tree is then free
 * to change without the installed copy moving underneath the test, and the two can
 * be compared deliberately by re-packing.
 *
 * ------------------------------------------------------------------
 * THE PROCEDURE
 * ------------------------------------------------------------------
 *
 *   1.  npm run pack
 *   2.  In Claude Code:  /plugin marketplace add <the absolute path this prints>
 *   3.                   /plugin install nole-schedule@tally-campus
 *   4.  Edit the working tree freely. The install does not follow it.
 *   5.  To test a change: npm run pack again, then  /plugin marketplace update
 *       tally-campus  and  /plugin update nole-schedule.
 *
 * ------------------------------------------------------------------
 * THE OTHER HALF OF THE PROBLEM, WHICH THIS DOES NOT FIX
 * ------------------------------------------------------------------
 *
 * A RUNNING SESSION CACHES SKILL TEXT. Re-packing and updating is not enough on
 * its own: the session keeps serving the SKILL.md it already loaded, and
 * /reload-plugins or a restart is required. This was verified the hard way in the
 * step 4 session, where a re-invocation after updating to 0.4.0 still served 0.3.0
 * instructions. PACK-INFO.json below carries a stamp for exactly this reason --
 * if what you are seeing does not match the stamp, you are looking at a cached
 * copy, not at a packing failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC_PLUGIN = path.join(REPO, 'plugins', 'nole-schedule');
const SRC_MARKETPLACE = path.join(REPO, '.claude-plugin', 'marketplace.json');
const DIST = path.join(REPO, 'dist');
const OUT = path.join(DIST, 'marketplace');
const asJson = process.argv.includes('--json');

if (!fs.existsSync(SRC_PLUGIN)) {
  console.error(`No plugin at ${SRC_PLUGIN}`);
  process.exit(2);
}

/* A pack is a REPLACEMENT, never a merge. A file deleted from the working tree
 * must disappear from the pack too, or the frozen copy quietly keeps shipping
 * something the repository no longer contains -- the same reasoning as the
 * re-import policy in scripts/lib/store.mjs. */
fs.rmSync(OUT, { recursive: true, force: true });

const files = [];
function copyTree(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) { copyTree(src, dst); continue; }
    if (!entry.isFile()) continue;
    const buf = fs.readFileSync(src);
    fs.writeFileSync(dst, buf);
    files.push({
      path: path.relative(REPO, src).replace(/\\/g, '/'),
      bytes: buf.length,
      sha256: crypto.createHash('sha256').update(buf).digest('hex')
    });
  }
}

copyTree(SRC_PLUGIN, path.join(OUT, 'plugins', 'nole-schedule'));

fs.mkdirSync(path.join(OUT, '.claude-plugin'), { recursive: true });
fs.copyFileSync(SRC_MARKETPLACE, path.join(OUT, '.claude-plugin', 'marketplace.json'));

const git = (...args) => {
  try { return execFileSync('git', args, { cwd: REPO, encoding: 'utf8' }).trim(); }
  catch { return null; }
};

const treeHash = crypto.createHash('sha256')
  .update(files.map((f) => `${f.path} ${f.sha256}`).sort().join('\n'))
  .digest('hex');

const manifest = JSON.parse(fs.readFileSync(path.join(SRC_PLUGIN, '.claude-plugin', 'plugin.json'), 'utf8'));

/* Written OUTSIDE dist/marketplace/, so the stamp never ships inside the plugin
 * and never becomes a file the marketplace has to know about. */
const info = {
  packedAt: new Date().toISOString(),
  pluginVersion: manifest.version,
  gitCommit: git('rev-parse', 'HEAD'),
  gitDirty: (git('status', '--porcelain') || '') !== '',
  fileCount: files.length,
  treeHash,
  marketplacePath: OUT,
  files
};
fs.writeFileSync(path.join(DIST, 'PACK-INFO.json'), JSON.stringify(info, null, 2) + '\n');

if (asJson) {
  console.log(JSON.stringify(info, null, 2));
  process.exit(0);
}

console.log(`Packed nole-schedule ${info.pluginVersion} -- ${info.fileCount} files, tree ${treeHash.slice(0, 12)}`);
console.log(`  commit: ${info.gitCommit ?? '(not a git checkout)'}${info.gitDirty ? '  DIRTY -- this pack does not match any commit' : ''}`);
console.log(`  stamp:  ${path.relative(REPO, path.join(DIST, 'PACK-INFO.json'))}`);
console.log('');
console.log('Install the FROZEN copy, not the working tree:');
console.log(`  /plugin marketplace add ${OUT}`);
console.log('  /plugin install nole-schedule@tally-campus');
console.log('');
console.log('After changing anything in plugins/nole-schedule:');
console.log('  npm run pack');
console.log('  /plugin marketplace update tally-campus');
console.log('  /plugin update nole-schedule');
console.log('  /reload-plugins        <- a running session caches skill text; this is not optional');
