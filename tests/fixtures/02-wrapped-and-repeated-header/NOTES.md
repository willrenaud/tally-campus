# 02 — wrapped lines and a repeated header

Two adversarial features, both of which look exactly like ordinary data.

**Wrapped titles.** SPC 2608's title runs across three lines. The continuation lines
carry no course number, no days and no time, and that absence is the only signal
that they are continuations rather than rows. The expected title is the whole thing:
`Public Speaking: Theory and Practice for the Contemporary Speaker`. ENC 1101's title
wraps across two lines in the same way.

**A header repeated mid-paste.** The source paginated, so the
`Class Nbr  Course  Sec …` header appears twice with a `- page 1 of 2 -` marker
between. An importer that scans for rows without tracking that it has already seen
the header emits a course called "Course" with a section of "Sec".

## Must not happen

- Any meeting whose title contains `Course` or `Class Nbr`.
- SPC 2608 imported with a truncated title.
- The page marker imported as anything at all.
- Four blocks becoming five or six.
