# 05 — one real collision and one that cannot be judged

Four courses, two overlapping pairs, and the two pairs must get **different
verdicts**.

**HIS 2100 vs MUH 2051 — `CONFLICT`.** Both full term, both MW, 14:00–15:15 against
14:30–15:45. Forty-five minutes of genuine overlap every Monday and Wednesday. In
practice this usually means the paste was misread rather than that the student is
registered for two classes at once, which is why it is reported prominently and
before anything is saved.

**REL 3170 vs PHI 2100 — `CANNOT TELL`.** Identical days and identical times, but one
is first-half and the other second-half, so they very probably never meet.
*Probably.* FSU's Registrar publishes session date ranges for summer terms only, so
the shipped Fall 2026 calendar carries `sessionsStatus: "not-published"` with an
empty `sessions` array, and neither course's real dates can be established.

**Reporting this pair as "no conflict" is the failure this fixture tests for.** It
would be a claim the data cannot support, and the test asserts that no verdict
anywhere in this fixture is `no-conflict`. Two `unmapped-session` warnings record
why.

A student can resolve it for their own schedule by supplying the real dates:
`partOfTerm: "custom"` with a `dateRange`, which the schema requires together.
Nobody may fill that in on their behalf.

## Must not happen

- Any verdict of `no-conflict` anywhere in this fixture.
- The half-term pair reported as a real collision.
- The full-term pair missed.
- The half-term courses silently expanded to the full term to make the comparison
  work.
