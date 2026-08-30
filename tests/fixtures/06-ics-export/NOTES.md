# 06 — an .ics export

Exercises `parse-ics.mjs` rather than a finished document, because a calendar file
cannot produce one: `deliveryMode`, `meetingType`, `section` and `partOfTerm` are
simply not in the format. The parser's job is to read honestly what is there and
raise a warning for everything that is not.

Five events, each carrying one trap:

| Event | Trap |
| --- | --- |
| ENC 1101 | `BYDAY=MO,WE,FR` and **two** `EXDATE` lines. Both exception dates must survive; keeping only the last is the easy bug, because most property parsers overwrite on repeat. |
| MAC 2311 | A `DESCRIPTION` folded across three lines, plus an escaped comma and semicolon. Unfolding joins on the leading space, removing it and inserting nothing. |
| BSC 2010L | `INTERVAL=2`, a biweekly lab. Read as weekly, a student attends on the wrong Wednesday half the time. |
| POS 2041 | **No `LOCATION` line at all.** That is a question, not evidence of an online class. It must produce a `missing-room` warning and a `locationHint` of `absent`. |
| Advising appointment | No course code in the `SUMMARY`. It must be flagged, never given a course code inferred from its neighbours. |

`UCA 3100` on the last event is also a building that does not ship. The parser
reports the hint and stops there; what to do about it belongs to the skill.

## Must not happen

- Timezone conversion. `DTSTART;TZID=America/New_York:20260824T090500` is local
  wall-clock and stays `09:05`. Converting it using the machine's own zone turns a
  9:05 class into an 8:05 class on a laptop set to Chicago.
- A weekday derived from a `Date` built out of a wall-clock time, which can land on
  the previous day. The parser builds it from the date alone, in UTC, for that
  reason.
- The advising appointment silently acquiring the course code of the event above it.
