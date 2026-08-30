# 04 — a building that does not ship

**The assertion this fixture exists for: the import SUCCEEDS.**

BUL 3310 meets in WCB 1010. `WCB` — the Herbert Wertheim Center for Business
Excellence — is not in `buildings.json` and cannot be until someone can source a
coordinate for it. `DATA-GAPS.md` §4 has the detail: no OpenStreetMap polygon under
FSU's address or under any matching name, and the address alone returns two
candidates about 1.5 km apart.

It is a 24-classroom building and students are timetabled into it constantly. So an
unknown building code is the **expected** case, not an exceptional one, and every
other part of the import has to survive it:

- the meeting is kept, with `buildingCode: "WCB"` exactly as printed and the original
  string preserved in `buildingCodeRaw`;
- the room `1010` survives — the building being unknown says nothing about the room;
- an `unknown-building-code` warning records precisely what will not work;
- the other two courses resolve and behave completely normally.

## Must not happen

- The import failing, or the schedule being rejected.
- BUL 3310 being dropped, or quietly turned into an online class.
- `WCB` being "corrected" to a shipped building whose name looked similar.
- The student being told to add it to `buildings.json` — an unsourced coordinate is
  the one thing this project will not ship, and a guessed one puts them on the wrong
  side of campus.
