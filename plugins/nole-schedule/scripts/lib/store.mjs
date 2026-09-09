/**
 * Reading and writing the one per-user document. Node builtins only.
 *
 * THE RE-IMPORT POLICY, which is the only interesting thing in this file:
 *
 *   A re-import REPLACES the stored schedule for its term. It never merges.
 *
 * Merging is the tempting behaviour and it is wrong. A student re-imports precisely
 * because something changed, and the most common change is a DROP -- they dropped a
 * course, swapped a lab section, or moved to a different lecture. Merge keeps the
 * dropped class, and the student then gets told for weeks to walk to a room they no
 * longer have any business being in. A deletion is invisible to a merge; only a
 * replacement can express it.
 *
 * Replacement's own risk is that a bad import destroys a good schedule, so the file
 * being replaced is copied into schedules/archive/ first, and the five most recent
 * archives per term are kept. That is enough to undo a mistake and small enough not
 * to become storage nobody manages. Note that ${CLAUDE_PLUGIN_DATA} is deleted when
 * the plugin is uninstalled, so none of this is a backup -- a re-import must always
 * remain possible, and nothing here is treated as archival.
 *
 * A re-import whose source checksum matches what is already stored writes NOTHING
 * and says so, so pasting the same schedule twice is a no-op rather than a new
 * archive entry.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const ARCHIVE_KEEP = 5;

export function dataRoot(explicit) {
  const dir = explicit || process.env.CLAUDE_PLUGIN_DATA;
  if (!dir) {
    throw new Error(
      'No data directory. Pass --data-dir <path>.\n\n' +
      'NOTE: CLAUDE_PLUGIN_DATA is NOT an environment variable in this process. Claude Code\n' +
      'substitutes ${CLAUDE_PLUGIN_DATA} into SKILL.md text before the model reads it; it does\n' +
      'not export it to the shell a script runs in. So a skill must pass the substituted path\n' +
      'as --data-dir, and a caller that expected to inherit it from the environment was\n' +
      'relying on something that has never been true. An earlier version of this message said\n' +
      'the opposite and sent at least one debugging session the wrong way.'
    );
  }
  return dir;
}

export const schedulesDir = (root) => path.join(root, 'schedules');
export const scheduleFile = (root, termCode) => path.join(schedulesDir(root), `${termCode}.json`);
export const archiveDir = (root) => path.join(schedulesDir(root), 'archive');

export function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

export function readSchedule(root, termCode) {
  const file = scheduleFile(root, termCode);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    // A corrupt stored file must not look like "no schedule yet": that would
    // silently replace something the student may still want back.
    throw new Error(`${file} exists but is not readable JSON (${err.message}). Move it aside before re-importing.`);
  }
}

export function listTerms(root) {
  const dir = schedulesDir(root);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''))
    .sort();
}

/** Summarise a stored schedule for the "here is what I am about to replace" message. */
export function summarise(doc) {
  if (!doc) return null;
  const meetings = Array.isArray(doc.meetings) ? doc.meetings : [];
  const sections = new Set(meetings.map((m) => `${m.courseCode}-${m.section}`));
  return {
    termCode: doc.termCode,
    courses: sections.size,
    meetings: meetings.length,
    courseCodes: [...new Set(meetings.map((m) => m.courseCode))].sort(),
    importedAt: doc.import?.importedAt ?? null,
    sourceFormat: doc.import?.sourceFormat ?? null,
    sourceChecksum: doc.import?.sourceChecksum ?? null,
    warnings: Array.isArray(doc.import?.warnings) ? doc.import.warnings.length : 0
  };
}

function archiveName(termCode, doc) {
  const stamp = (doc?.import?.importedAt || new Date().toISOString())
    .replace(/[:.]/g, '-')
    .replace(/\+.*$/, '')
    .replace(/Z$/, 'Z');
  return `${termCode}--${stamp}.json`;
}

function pruneArchive(root, termCode) {
  const dir = archiveDir(root);
  if (!fs.existsSync(dir)) return [];
  const mine = fs.readdirSync(dir)
    .filter((f) => f.startsWith(`${termCode}--`) && f.endsWith('.json'))
    .sort();
  const remove = mine.slice(0, Math.max(0, mine.length - ARCHIVE_KEEP));
  for (const f of remove) fs.rmSync(path.join(dir, f));
  return remove;
}

/** Write atomically: a crash mid-write must not leave a truncated schedule. */
function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

/**
 * Replace the stored schedule for doc.termCode.
 * Returns { action, file, archived, pruned, previous }.
 */
export function saveSchedule(root, doc, { force = false } = {}) {
  const termCode = doc.termCode;
  const file = scheduleFile(root, termCode);
  const previous = readSchedule(root, termCode);

  const incomingSum = doc.import?.sourceChecksum ?? null;
  const existingSum = previous?.import?.sourceChecksum ?? null;
  if (!force && previous && incomingSum && existingSum && incomingSum === existingSum) {
    return { action: 'unchanged', file, archived: null, pruned: [], previous: summarise(previous) };
  }

  let archived = null;
  if (previous) {
    archived = path.join(archiveDir(root), archiveName(termCode, previous));
    fs.mkdirSync(archiveDir(root), { recursive: true });
    fs.copyFileSync(file, archived);
  }

  writeAtomic(file, JSON.stringify(doc, null, 2) + '\n');
  const pruned = previous ? pruneArchive(root, termCode) : [];

  return {
    action: previous ? 'replaced' : 'created',
    file,
    archived,
    pruned,
    previous: summarise(previous)
  };
}
