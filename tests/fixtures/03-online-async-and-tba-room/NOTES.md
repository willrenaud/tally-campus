# 03 — two different kinds of "no room"

This fixture exists for one distinction, and collapsing the two halves of it is the
most common schedule-import bug there is.

**POS 2041 is online and asynchronous.** Days `TBA`, time `TBA`, room `ONLINE`. It
gets `deliveryMode: "online-asynchronous"`, `location: null`, and **no** `daysOfWeek`,
`startTime` or `endTime` at all — not blank ones, absent ones. A blank time is still
a time as far as a conflict check is concerned, and that is where phantom conflicts
come from. It must **not** get `locationTba`: this class has no room, rather than a
room nobody has announced yet.

**STA 2023 meets in BEL, room unannounced.** Room `TBA`, building known. The building
is kept, `room` is omitted entirely, and a `missing-room` warning is recorded.
Routing to BEL works perfectly well; only "which door, which floor" degrades. Storing
the literal string `"TBA"` in `room` would show a student "BEL TBA" as though TBA
were a room number.

So the review reports **zero** unresolved locations here. A TBA room is not an
unresolved location.

The delivery mode of POS 2041 is inferred rather than stated — the source never says
"asynchronous" — so an `assumed-delivery-mode` warning records that it was inferred
and confirmed rather than read.

## Must not happen

- `location: { buildingCode: "ONLINE" }` or `"WEB"`, ever.
- `room: "TBA"`.
- `locationTba` on the online course.
- The asynchronous course carrying days or times.
- The TBA-room course being reported as location-unresolved.
