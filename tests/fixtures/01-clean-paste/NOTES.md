# 01 — a clean paste

The baseline. Six meeting blocks across five course sections, no wrapping, no
missing fields, every building in the shipped data.

## Why it is still worth a fixture

Two things here are quietly easy to get wrong.

**MAC 2311 is one section and two records.** The lecture meets MWF in LOV 0101 and
the recitation meets Thursday in LOV 0201. An importer that keys on the course
number collapses them and loses the Thursday room; one that keys on the class
number splits the section in two. The right answer is two meeting blocks sharing
`courseCode` and `section`, differing in `meetingType`.

**"Staff" is not an instructor.** Two rows list it. `instructors` becomes `[]` and a
`missing-instructor` warning is recorded — writing a person named Staff into the
document is exactly the kind of invented value the import rules forbid.

## Must not happen

- The `R` in the recitation's day column expanding to anything but Thursday.
- `12:30 PM - 1:20 PM` becoming `12:30`–`01:20` instead of `12:30`–`13:20`.
- The lecture and the recitation collapsing into one block.
