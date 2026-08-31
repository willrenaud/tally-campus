# 04 — a building that does not ship

**The assertion this fixture exists for: the import SUCCEEDS.**

BUL 3310 meets in UCB 1010. `UCB` — University Center B — is not in `buildings.json`.
`DATA-GAPS.md` §4 has the detail: it and its neighbours ring Doak Campbell Stadium
roughly a kilometre southwest of the academic core, and admitting them would stretch
the walk graph across a gap with no sourced path. Deferred rather than rejected.

> **This fixture used `WCB` until 0.6.0**, when the Wertheim Center was finally given
> a sourced coordinate and shipped. The fixture was repointed rather than deleted,
> because the unknown-building path still needs a live example — only 33 of FSU's
> 500-plus buildings ship, so a student hitting it is ordinary. **If `UCB` is ever
> added, repoint this fixture again.**

An unknown building code is the **expected** case, not an exceptional one, and every
other part of the import has to survive it:

- the meeting is kept, with `buildingCode: "UCB"` exactly as printed and the original
  string preserved in `buildingCodeRaw`;
- the room `1010` survives — the building being unknown says nothing about the room;
- an `unknown-building-code` warning records precisely what will not work;
- the other two courses resolve and behave completely normally.

## Must not happen

- The import failing, or the schedule being rejected.
- BUL 3310 being dropped, or quietly turned into an online class.
- `UCB` being "corrected" to a shipped building whose name looked similar.
- The student being told to add it to `buildings.json` — an unsourced coordinate is
  the one thing this project will not ship, and a guessed one puts them on the wrong
  side of campus.
