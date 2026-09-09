#!/usr/bin/env node
/**
 * Mutation-test the SKILL TEXT assertions in tests/run-tests.mjs.
 *
 *   node tools/mutate-skill-text.mjs        # or: npm run mutate
 *
 * ==================================================================
 * WHY THIS EXISTS
 * ==================================================================
 *
 * Section 12 of the suite asserts things ABOUT TEXT -- that no command uses a
 * prose shorthand, that no example holds a real date or a quotable course count.
 * Assertions over text are unusually easy to write so that they can never fail:
 * one over-anchored regex that matches nothing passes forever and guards nothing,
 * and it looks identical to a passing test.
 *
 * That is not hypothetical. It happened twice while writing section 12:
 *
 *   1. A command detector anchored to the start of a line found no commands at all
 *      in import-schedule -- whose six commands live in a markdown table -- and
 *      reported the skill as unable to do anything.
 *   2. The looser replacement required a quote after `node`, so `node ./scripts/x.mjs`
 *      was not recognised as a command and skipped the rooting check silently. A
 *      relative path is precisely the defect that check exists to catch.
 *
 * Only the second was found, and only because of this harness.
 *
 * So every assertion in section 12 is verified by REINTRODUCING the defect it
 * guards, running the full suite, and requiring a failure. Passing here means the
 * guards have teeth -- not merely that the files happen to be clean today. Each
 * file is restored immediately afterwards, in a finally block.
 *
 * Add a mutation whenever you add an assertion to section 12. An assertion with no
 * mutation is an assertion nobody has ever seen fail.
 */
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const S = 'plugins/nole-schedule/skills/';
const MUT = [
  ['$P used as a path', S + 'import-schedule/SKILL.md',
    (t) => t.replace('`node "${CLAUDE_PLUGIN_ROOT}"/scripts/current-term.mjs`', '`node "$P"/current-term.mjs`')],
  ['unbraced $CLAUDE_PLUGIN_DATA', S + 'whats-next/SKILL.md',
    (t) => t.replace('--data-dir "${CLAUDE_PLUGIN_DATA}"', '--data-dir "$CLAUDE_PLUGIN_DATA"')],
  ['a numeric course tally', S + 'import-schedule/SKILL.md',
    (t) => t.replace('> **`<term>`** — `<N>` courses', '> **`<term>`** — 5 courses')],
  ['a real building code in an example', S + 'whats-next/SKILL.md',
    (t) => t.replace('in ZZZ 0000', 'in WCB 2703')],
  ['a real deadline date, spoken form', S + 'deadlines/SKILL.md',
    (t) => t.replace('is the late-drop deadline', 'is 13 November, the late-drop deadline')],
  ['a command not rooted at CLAUDE_PLUGIN_ROOT', S + 'parking/SKILL.md',
    (t) => t.replace('node "${CLAUDE_PLUGIN_ROOT}"/scripts/where-to-park.mjs --building <CODE> --json',
                     'node ./scripts/where-to-park.mjs --building <CODE> --json')],
  ['the gate deleted', S + 'check-conflicts/SKILL.md',
    (t) => t.replace('## STOP. No script, no answer.', '## Some other heading')]
];

let allCaught = true;
for (const [name, file, fn] of MUT) {
  const orig = fs.readFileSync(file, 'utf8');
  const mutated = fn(orig);
  if (mutated === orig) { console.log('SKIP (mutation did not apply): ' + name); allCaught = false; continue; }
  fs.writeFileSync(file, mutated);
  let caught = false;
  let detail = '';
  try {
    execFileSync(process.execPath, ['tests/run-tests.mjs'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    caught = true;
    const out = (err.stdout || '');
    const m = out.match(/^ {2}FAIL .*$/m);
    detail = m ? m[0].trim() : '(failed, reason not parsed)';
  } finally {
    fs.writeFileSync(file, orig);
  }
  console.log((caught ? 'CAUGHT  ' : 'MISSED  ') + name + (caught ? '  ->  ' + detail : ''));
  if (!caught) allCaught = false;
}
if (allCaught) {
  console.log(`\nAll ${MUT.length} mutations caught.`);
  process.exit(0);
}
/* Exit non-zero, or npm run test:all reports success over a guard with no teeth --
 * which is the same failure this whole file exists to prevent, one level up. */
console.log('\nSOME MUTATIONS NOT CAUGHT. A section-12 assertion cannot fail, so it guards nothing.');
process.exit(1);
