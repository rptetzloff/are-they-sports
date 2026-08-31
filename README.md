# are-they-sports

One codebase for team record sites, across leagues.

It grew out of two sites that answer a question about one club —
[arethepackersundefeated.com](https://arethepackersundefeated.com) and
[arethebrewersontv.com](https://arethebrewersontv.com) — which forked from each
other and drifted. Most of what they do is the same computation over different
vocabularies, so this is the version where a new team is a manifest rather than
a repository.

**Early. The data pipeline works and a server renders pages; the record and
box-score views are not ported yet.**

## The data model

Three tiers, and the split is the point.

**Sources are fetched, never committed.** One nflverse play-by-play season is
95MB; a Retrosheet slice is 388MB. They live in `data/sources/`, which is
gitignored, and exist only while a build runs.

**Artifacts are derived and committed.** They are what a site actually reads.
The reduction is large enough to change what is possible:

| | |
|---|---|
| 95MB of 2024 league play-by-play | → 4.7KB of Packers scoring plays |
| 388MB of Retrosheet play-by-play | → 0.84MB of Brewers scoring plays |

Three things happen in that: rows nobody displays are dropped (a site shows
plays that *scored*, not every snap), what remains is reindexed for lookup
rather than scanning, and brotli pays back the JSON verbosity. The first is the
big one.

**Reference data is curated and committed.** Franchise names and eras, which no
upstream publishes for football — see below.

## Sources

| sport | era | source |
|---|---|---|
| NFL | 1920–1998 results | [FiveThirtyEight nfl-elo-game](https://github.com/fivethirtyeight/nfl-elo-game) |
| NFL | 1999– results | [nflverse schedules](https://github.com/nflverse/nflverse-data) |
| NFL | 1999– play-by-play | nflverse |
| MLB | — | Retrosheet *(not yet ported)* |

FiveThirtyEight's own endpoints now 404 behind an ABC News redirect; the GitHub
copy is what survives. Before relying on it, it was cross-checked against their
separately published `nfl_elo.csv` recovered from the Wayback Machine: the two
agree on all 1,064 pre-1999 Packers games with zero differences in date,
opponent or score. The pipeline's output was then compared against the football
site's committed data — **1,534 of 1,534 played games match exactly** on result,
points for and points against.

## Database

Postgres 18 on the server; the schema also applies cleanly to 17. Reads happen
at request time, so `DATABASE_URL` is required wherever the server runs.

```
DATABASE_URL=postgres://user:pass@host:5432/ats npm run migrate
DATABASE_URL=... npm run load nfl
```

Both work **inside the deployed container**, which is usually where the database
is reachable from. `load` fetches the sources it needs if they are absent — the
image excludes `data/sources` because play-by-play is 95MB a season, but a game
load needs only schedules (2.1MB) and, for football, the pre-1999 seed (1.2MB).

`load mlb` is the exception: Retrosheet has no fetcher here, so the file has to
be put in place by hand. It says so rather than failing on an `open()`.

Order does not matter. A deployment against an empty database comes up healthy,
answers 503 on club routes naming the fix, and starts serving within thirty
seconds of a load — no redeploy.

`migrate` applies numbered files from `db/migrations` in order, each in its own
transaction, and records what it applied. Running it twice does nothing the
second time — the only property that makes it safe to point at a server. It also
stores a checksum per file and **refuses to run if an applied migration changed
on disk**, because a file and a database that disagree give every fresh
environment the edit and every existing one the original, with nothing reporting
a problem. An applied migration is history; change it with a new file.
`--dry-run` lists what would be applied.

Connection strings support `sslmode` — `?sslmode=require`, or
`?sslmode=no-verify` for a self-signed certificate. A database on the same
internal network needs neither.

### Provenance, and what a backup has to protect

Every row names its source, and `source.reproducible` says whether it could be
rebuilt. So the question is a query rather than an argument:

```sql
SELECT count(*) FROM game g JOIN source s ON g.source = s.id
 WHERE NOT s.reproducible;
```

Zero means the whole database can be thrown away and rebuilt from sources. It
returns to zero on its own, because an authoritative source supersedes a live
capture as soon as it publishes.

The upsert rule follows from that: a source may write if its authority is at
least as high, **or** if the existing row is not yet final. A live feed may
complete a scheduled game; it may not revise a finished one.

## Adding a club

A club manifest is its sport, its id, the codes the sources call it by, its
name, its colours and what it shouts before the season starts. Twelve lines.

```js
export const team = {
	sport: 'nfl',
	id: 'bears',
	sourceIds: ['CHI'],
	firstSeason: 1920,
	nouns: { team: 'Bears', fullName: 'Chicago Bears' },
	colors: { accent: '#c83803', base: '#0b162a', baseDeep: '#060d18' },
	copy: { seasonNotStarted: 'BEAR DOWN' },
};
```

Everything else — points, Super Bowl, coach, meetings, whether streaks span
seasons — comes from `sports/nfl.js`, because those are facts about football
rather than about Chicago. Any of them can be overridden. Then
`npm run build bears`.

## Names

Two sports, two answers, because only one has a source that publishes eras.

**Baseball resolves names by date.** Retrosheet's `CurrentNames.csv` carries
franchise code, name, and the exact span each applied, so a 1969 Brewers game is
labelled **Seattle Pilots** — which is what it was. `scripts/names.mjs` turns it
into `data/reference/mlb-names.csv`, collapsing rows that differ only by league
or division: 125 upstream rows become 88 name spans across 30 franchises.

**Football resolves to the current name, whatever the date.** No equivalent
source exists, so a 1995 Rams game says "Los Angeles Rams" even though it was
played in St. Louis. That is wrong as history and is exactly what
arethepackersundefeated.com has always done. `nameFor` returns `isHistorical` so
a caller can tell the two apart rather than a function quietly meaning two
things.

The two football sources also **disagree on codes for the same club**:
FiveThirtyEight writes `LAC`, `LAR`, `OAK`, `WSH`; nflverse writes `SD`, `STL`,
`LA`, `LV`, `WAS`. One club's games contain both, because the eras come from
different files, so `data/reference/nfl-names.csv` carries alias rows. Without
them five of the Packers' own opponent codes resolve to nothing.

Resolution is per sport, and it has to be: **`MIL` is the Milwaukee Badgers in
football and the Milwaukee Brewers in baseball.**

Every opponent either built club has ever played now resolves — 66 of 66 for the
Packers, 34 of 34 for the Brewers — and a test asserts it against the real
indices rather than against the tables agreeing with themselves.

## The franchise problem, solved

Retrosheet publishes `CurrentNames.csv` for baseball: code, name, start, end.
Nothing equivalent was published for football, so this repo spent a while
resolving NFL codes to *current* names whatever the date — a 1995 Rams game
labelled "Los Angeles Rams", which is what arethepackersundefeated.com still
does.

`data/reference/nfl-franchise-history.csv` is the file that did not exist.
Curated by hand: franchise, source code, league, city, name, seasons, and
colours. **264 rows, 119 franchises, 128 codes.**

So both sports resolve by era now and the asymmetry is gone:

| | |
|---|---|
| `CHI` in 1921 | Chicago Staleys |
| `DET` in 1930 | Portsmouth Spartans |
| `ARI` in 1925 | Chicago Cardinals |
| `LAR` in 1995 | St. Louis Rams |
| `WSH` in 2020 | Washington Football Team |

It also settles the alias problem structurally. The two football sources
disagree — FiveThirtyEight writes `LAC`/`LAR`/`OAK`/`WSH` where nflverse writes
`SD`/`STL`/`LA`/`LV`/`WAS` — and `franchiseAbbrv` maps every code to one
franchise, so 128 codes collapse to 119 clubs by join rather than by a fallback
chain.

The two sources key differently and neither can be derived from the other:
Retrosheet gives exact dates, the football history gives seasons, and an NFL
season crosses the new year — a January 2011 game belongs to the 2010 season. So
callers pass both and each resolver takes what it needs.

## Adding a club

A club manifest is its sport, its id, the codes the sources call it by, its
name, its colours and what it shouts before the season starts. Twelve lines.

```js
export const team = {
	sport: 'nfl',
	id: 'bears',
	sourceIds: ['CHI'],
	firstSeason: 1920,
	nouns: { team: 'Bears', fullName: 'Chicago Bears' },
	colors: { accent: '#c83803', base: '#0b162a', baseDeep: '#060d18' },
	copy: { seasonNotStarted: 'BEAR DOWN' },
};
```

Everything else — points, Super Bowl, coach, meetings, whether streaks span
seasons — comes from `sports/nfl.js`, because those are facts about football
rather than about Chicago. Any of them can be overridden. Then
`npm run build bears`.

## Names

Two sports, two answers, because only one has a source that publishes eras.

**Baseball resolves names by date.** Retrosheet's `CurrentNames.csv` carries
franchise code, name, and the exact span each applied, so a 1969 Brewers game is
labelled **Seattle Pilots** — which is what it was. `scripts/names.mjs` turns it
into `data/reference/mlb-names.csv`, collapsing rows that differ only by league
or division: 125 upstream rows become 88 name spans across 30 franchises.

**Football resolves to the current name, whatever the date.** No equivalent
source exists, so a 1995 Rams game says "Los Angeles Rams" even though it was
played in St. Louis. That is wrong as history and is exactly what
arethepackersundefeated.com has always done. `nameFor` returns `isHistorical` so
a caller can tell the two apart rather than a function quietly meaning two
things.

The two football sources also **disagree on codes for the same club**:
FiveThirtyEight writes `LAC`, `LAR`, `OAK`, `WSH`; nflverse writes `SD`, `STL`,
`LA`, `LV`, `WAS`. One club's games contain both, because the eras come from
different files, so `data/reference/nfl-names.csv` carries alias rows. Without
them five of the Packers' own opponent codes resolve to nothing.

Resolution is per sport, and it has to be: **`MIL` is the Milwaukee Badgers in
football and the Milwaukee Brewers in baseball.**

Every opponent either built club has ever played now resolves — 66 of 66 for the
Packers, 34 of 34 for the Brewers — and a test asserts it against the real
indices rather than against the tables agreeing with themselves.

## The franchise problem

Retrosheet publishes `CurrentNames.csv`: franchise code, name, start date, end
date. Nothing equivalent exists for football. nflverse's `teams.csv` covers 2002
onward and 35 codes; the results data reaches back to 1920 and uses 123.

`data/reference/nfl-franchises.csv` is a starting list, not a history. Names are
recovered by joining coded results against a site that already names its
opponents — which works, and produces dates that are **not franchise eras**.
The football site labels historical games with modern names, so the generator
emits rows like `ARI,Arizona Cardinals,1921-11-20` when they were the Chicago
Cardinals. The columns are `firstSeen`/`lastSeen` to say so.

Turning it into a real history means tracing each franchise by hand. The
`source` column marks which rows have had that: `derived` is a candidate,
`traced` has been checked, `unresolved` is a code with no name yet. 62 of 123
are unresolved today, all clubs the Packers never played — a number that falls
as teams are added, since a club the Packers never met probably played the
Bears.

## The season being played

Both sports. nflverse refreshes weekly and Retrosheet publishes annually, so
in-season results are days or months behind the authoritative source; the live
feed fills the gap and is superseded when the real one publishes.

```
npm run load nfl -- --live          # the season being played
npm run load mlb -- --live 2026     # a named one, backfilled
```

**The ids are the authoritative source's, not ESPN's.** Games are keyed on
`(sport, id)`, so an ESPN id would make the same game a second row rather than
replacing it. Football's are nflverse's `2024_22_KC_PHI` — season, week, away,
home, in **nflverse** codes, which are not the franchise codes: the Rams are
`LAR` here and `LA` there, Washington `WSH` and `WAS`. Checked against a whole
published season: **285 of 285 ids match**.

Two things about football that baseball does not have:

- **the season crosses the new year.** The 2024 season ends with a Super Bowl in
  February 2025, so January and February belong to the previous year's season
  and a backfill runs September through February.
- **the postseason week numbering does not line up.** ESPN restarts at 1 for the
  wild card; nflverse continues from 18 but skips the Pro Bowl, which ESPN
  counts as week 4. So ESPN weeks 1-3 are nflverse 19-21, ESPN week 5 is
  nflverse 22, and week 4 is not a game — it is also AFC against NFC, which the
  club check rejects anyway.

A live row may **finish** a game but not re-attribute one. nflverse publishes a
whole season's schedule before it starts, so 272 authoritative rows sit there as
`scheduled`; without that rule a refresh overwrote every one with an equally
scheduled ESPN row, adding nothing and turning 272 reproducible rows into
non-reproducible ones. Measured after: 285 games seen, **1 written** — the one
that needed finishing.



The server keeps it current itself, and paces itself from the schedule — a
season is six months of the year and a game day a few hours of it, so a fixed
interval is mostly requests that learn nothing.

| what the data says | how often |
|---|---|
| a game near today is not final | `LIVE_REFRESH_MS`, default **60s** |
| in season, nothing pending | 30 minutes |
| no games within a day either side | 6 hours |

`LIVE_REFRESH_MS=0` turns it off entirely.

A refresh is **three requests**, not nine: only the days that can still change.
Three rather than two because game dates are LOCAL and the clock is UTC — during
a US evening the UTC date has already rolled over, and a two-day window covered
local today and tomorrow while missing local yesterday, which is exactly when
last night's late game finishes.

```
live         refreshing mlb every 120s
live         mlb 2026: 2450 rows
```

**The request path never calls out.** The two live sites fetch ESPN from the
browser on every page load, which is why they are never stale — and it puts a
third party in the request path, needs client script this repo does not have,
and breaks when ESPN does. Here the timer writes to Postgres and the game cache
picks the rows up on its own, because it is already keyed on
`max(observed_at)`.

**One poller, however many containers.** A Postgres advisory lock decides which
replica refreshes; the rest are turned away rather than queued, so a refresh
already running is skipped instead of stacking up. Verified with two servers
against one database: one wrote five times, the other never.

The manual load still exists and is what a deployment wants if it would rather
schedule the work itself:



Retrosheet is authoritative and published annually — the file supplied on
2026-08-30 ends at the 2025 World Series. So on any day of a season the
authoritative source has nothing for it, and a club page answers about a season
that finished last November as though it were current.

```
npm run load mlb -- --live          # the season being played
npm run load mlb -- --live 2026     # a named one
```

A **day** at a time, and that is correctness rather than cost. `dates=YYYYMM`
returns a month in one request and the event timestamps are UTC, while
Retrosheet files the LOCAL date: a 7:05pm game in Texas is `2025-03-29T00:05Z`,
so reading the date off the event filed it a day late, collided it with the next
day's game, and the pair became a fake doubleheader. Only **76%** of a season's
ids matched what Retrosheet had published for the same games. `dates=YYYYMMDD`
returns that local day, and the figure is **99.75%** — the remainder are
suspended games the two sources genuinely file differently. Rows are written as `espn` — authority 10,
`reproducible = false` — and the upsert rule replaces them with Retrosheet's the
next time the annual file loads, so the count of non-reproducible rows returns
to zero on its own.

The game id is synthesised in **Retrosheet's** shape rather than using ESPN's,
because games are keyed on `(sport, id)`: an ESPN id would make the same game a
second row the moment Retrosheet published the season. That needs the club's
**era** code, not its franchise — `ATH202507040` is a game whose franchise is
`OAK` — which is what `espnAbbrv` in the franchise history provides, one more
`<provider>Abbrv` column.

Four things a live scoreboard carries that are not results, each found by
comparing a count against the real season:

- **spring training.** March 2026 is 321 preseason events against 76
  regular-season ones; loaded as games it gave the Brewers 26 games in March.
- **postponements.** `STATUS_POSTPONED` is also state `post` and carries 0-0, so
  reading the state stored thirteen of them as nil-nil finals. `completed` is
  the field that means finished.
- **the All-Star game**, which arrives as `AL` against `NL`, and **postseason
  fixtures** as `TBD` against `TBD`. Both were registered as clubs.
- **the month boundary.** `dates=202607` returns through August 1st and
  `dates=202608` starts there, so boundary games arrive twice and Postgres
  refuses an upsert whose own values repeat a key.

## Baseball data, and why its load runs differently

Football fetches its own sources: `scripts/load.mjs nfl` runs anywhere, including
inside the deployed container, because nflverse and FiveThirtyEight publish
stable URLs and the two files are 2.1MB and 1.2MB.

Baseball does not. Retrosheet publishes downloads rather than a release URL, so
there is nothing to hardcode — and on a host where the database is reachable
only from the server, the CSV and the database are never in the same place.

So the URL is **named rather than written**: `sports/mlb.js` declares
`env: 'MLB_SCHEDULES_URL'`, and the container fetches from wherever that points,
exactly as it fetches nflverse. A private host stays out of a public repository.

```powershell
$env:MLB_SCHEDULES_URL = 'https://…/mlb-games.csv.gz'
npm run load mlb
```

Object storage works: the URL is whatever serves the file, including a bucket on
the same host. **Upload it however you like** — `download` decides from the
first two bytes of the response, not from a declared flag, so an object stored
with `Content-Encoding: gzip` (which `fetch` transparently decompresses) and one
stored without it both arrive as CSV. That flag existed and was exactly the
wrong thing to trust: the file is identical either way and only the metadata
differs.

A **private** bucket works: set `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY`
(plus `S3_REGION`, default `us-east-1`) and the request is signed. Nothing has
to be made public and no presigned URL has to be refreshed.

Signed by hand, in `lib/sigv4.js`, rather than by `@aws-sdk/client-s3`. Measured:
the SDK is 26 packages and 15MB, which is real but not the reason. The reason is
that the SDK fetches an object through its own client, so the URL would have to
be split into endpoint, bucket and key, path-style addressing configured, and a
second code path maintained beside the plain-URL fetch football uses. Signing
adds a header to the request already being made.

**Public sources are never signed.** nflverse and FiveThirtyEight are open URLs,
and sending an S3 Authorization header to GitHub's CDN because a bucket was
configured for baseball would be a strange way to break football.

Anonymous read on that one object or prefix also works, and needs no
credentials — MinIO can scope a policy to a prefix rather than the whole pool. A
presigned URL works too but expires, which makes it a poor value for a
persistent environment variable.

Both ways of getting this wrong say so. An unreachable URL names the URL, the
cause and the variable to set, and deletes the partial file rather than leaving
something the next run would mistake for the source. An unreachable database
names the host, port and database — never the password — and exits 2 rather
than 1, so a wrapper can tell "the database is not there" from "the source is
not there".

Serve **only the eight columns the loader reads** — `gid, season, date,
gametype, hometeam, visteam, hruns, vruns` — gzipped. That is **1.6MB** against
the full file's 43MB; the other thirty-five columns are umpires, weather and
attendance that nothing here looks at. `data/sources/mlb-games.csv.gz` is built
by trimming `gameinfo.csv` and is gitignored like every other source.

With neither the variable nor the file, the load exits 1 naming the variable.
Putting the file at `data/sources/mlb/schedules.csv` by hand still works and
skips the fetch.

The file is Retrosheet's `gameinfo`: one row per game with both clubs, 226,221
rows covering 1897–2025.

**2,566 of those rows are not games between two clubs.** All-star and exhibition
games are skipped at load. They were invisible while the only baseball source
here was one club's slice — which contains neither — and the round mapping would
have filed every one of them as a *playoff* game, inflating the postseason record
of all thirty clubs. The all-star rows also name sides that are not clubs:
`NLS` and `ALS` for the two league squads, `ASE` and `ASW` for East and West.
223,655 games remain.

The coverage is much wider than the thirty current clubs: **117 franchises**, 87
of which the franchise history does not name, across 8,517 games —
nineteenth-century clubs, the Federal League, and the **Negro Leagues**, which
MLB recognised as major leagues in 2020 and Retrosheet carries as regular-season
games. `CUW` is the Cuban Stars (West), not an exhibition side; an earlier note
here said otherwise. None of them appear in any scope, because a scope is built
from the divisions table.

`championship` is a game type here and is **not** the title: it is the 1900
Chronicle-Telegraph Cup and its like, played before the World Series existed.
Only `worldseries` sets the championship round.

## Per-sport league pages

Under a scope covering more than one sport:

```
/records   /schedule   /schedule/2025   /standings   /standings/2025   stacked
/nfl/...   /nfl/...    /nfl/...         /nfl/...     /nfl/...          one sport
/mlb/...   /mlb/...    /mlb/...         /mlb/...     /mlb/...
```

Tabs across the top switch between them, and the qualified pages keep their
prefix on every link — a sport-qualified schedule that offered `/schedule/2023`
for the previous season would silently drop back to the stacked view.

A sport prefix is recognised only when the scope holds that sport, so
`/nfl/records` under `SCOPE=sport:mlb` is a 404 rather than an empty page. It
cannot shadow a club either: a club's path under a multi-sport scope is
`/{sport}/{club}`, and no club is called "records" or "schedule".

A single-sport scope has no tabs and no qualified routes, because there is
nothing to switch between.

## A scope covering two sports shows two leagues

`/records`, `/schedule` and `/standings` render **one block per sport**, never
merged. A
football season ranked against a baseball season is not a comparison, and the
earlier version did exactly that and printed a note admitting the lists compared
clubs that never played each other. The note was true and the page was still a
pile.

It also removes a rule that had to be fudged. Streaks span seasons in football
and stop at the season boundary in baseball; a merged league had to pick one.
Football is grouped by week and baseball by date; a merged schedule sorted 22
week-periods against 209 date-periods and claimed weeks were known because
*some* of the games had them. Per sport, each uses its own.

A single-sport scope is unlabelled and reads exactly as before, which is what
every existing deployment sees.

## Getting to the league pages

`/records`, `/schedule` and `/standings` are linked from the club selector at
the root, from each other, and from every club page's site nav — under a multi-club scope only,
because under `SCOPE=team:packers` those routes do not exist and linking to them
would be worse than not having them.

Worth saying because the first version had none of that. Both pages answered
200, every route test passed, and nothing anywhere pointed at them: a working
page nobody can reach. No test noticed, because every test already knew the URL.
`test/reachable.test.js` is the one that asks the other question.

It now asks both. "Is every route linked?" was the only question being asked, so
the opposite failure sat in plain sight: `/managers` was in **every** club page's
site nav, answering 404, for as long as the nav existed. The leaders page needs a
curated coaches/managers table nobody publishes, and the link went in ahead of
the page. Every link the nav emits is now resolved through the real router, and a
test guards the guard by asserting `/managers` still fails to resolve — otherwise
a check that returned true for everything would pass on the nav that shipped the
404.

The same gap ran the other way for `/standings`: it was linked from the club
selector and from the other league pages, and not from any club page, because
the club nav's league block listed records and schedule and was never revisited.

## Run the tests against an empty database too

`npm test` against a developer database and `npm test` in CI are different runs,
and each catches defects the other cannot. Both kinds have shipped:

- Three assertions passed only against an EMPTY database. They were written when
  the tables held nothing but the fixture, and silently became claims about the
  whole league once real data arrived — `count(*) WHERE home='WAS'` with no
  `sport` read 9,208 rather than 0 the moment baseball was loaded. Nobody saw
  them, because CI runs on an empty database.
- Then one passed only against a LOADED one, in the very commit that fixed those
  three: it inserted an `mlb` franchise without creating the `mlb` sport, which
  exists on a developer's machine from a real load and nowhere else. CI caught it
  within a minute.

A test resting on state it did not create is the same defect either way. To check
both, point `DATABASE_URL` at a second, empty database and run again:

```sh
createdb ats_ci                     # or CREATE DATABASE ats_ci
DATABASE_URL=...//ats_ci npm run migrate
DATABASE_URL=...//ats_ci npm test
```

Expect a lower pass count, not a lower fail count — the "loaded data" block skips
itself with a reason, which is how it says so out loud.

## What the league pages cost

Measured, because two different things were slow and only one of them showed up
in a server timing.

**`/records` was 235ms warm, and 232ms of that was one call.** The rows are
already cached per franchise and cost 0ms once read; `computeLeague` over 62
clubs and 471,453 rows ran again on every request, over data that changes a few
times a day. It is memoised now — 235ms to 2.6ms — along with the schedule and
the standings.

The memo is keyed on the clubs' own row stamps, not on a timer. `server.js`
records why: caching for the life of the process hid a playoff-flag correction
once and a franchise remapping once, and both times the site looked right and was
quietly wrong. The per-franchise game cache already tracks `max(observed_at)` and
re-reads when it moves, so this reads those same stamps and joins them — no extra
queries, and the memo is invalid the instant any club's rows are re-read,
including by the server's own live refresh. Verified against a real write: a
Brewers win edited to a loss in Postgres changed the standings page from 85-52 to
84-53 within the cache's check window, without a restart.

It is bounded at 64 entries, because the key carries the season and there are a
hundred and some of those per sport times three views. Unbounded would be a slow
leak that only shows on a long-lived deployment, which is the only kind this has.

**That was not the whole story**, and the rest only showed up on a deployment
with the live poller running. Three more costs, each measured:

*The staleness check scaled with the number of clubs, not with what changed.* The
game cache asked `max(observed_at)` once per franchise every thirty seconds —
429ms for the 236 franchises that have games, paid before a single row was read.
One query is 73ms.

*One changed game re-read a club's whole history.* The live refresh rewrites
today's games every sixty seconds and each write sets `observed_at`, so a club
playing today looks changed once a minute. The Brewers are 9,229 rows and the
feed touched one of them. Only rows observed since the cached stamp are fetched
now, and merged by game id. A stamp that moves BACKWARDS still reloads outright:
`max(observed_at)` can only fall if the row holding it was deleted, and nothing
about a deletion can be inferred from the rows that remain.

*The first visitor after every deploy paid the cold read.* 489,184 rows, about
two seconds. The cache is filled after `listen()` now, eight clubs at a time, so
the server answers `/healthz` throughout and nobody waits for it. Sequential is
1,475ms and unbounded parallel is 1,056ms; eight gets most of that and leaves the
pool room to serve pages.

| | before | after |
|---|---|---|
| first `/records` after boot | ~2,400ms | 412ms |
| warm | 3ms | 19ms |
| first request after the check window | 429ms+ | 4–153ms |
| boot warm (background) | — | 900ms |

**`/mlb/schedule` was 878KB of HTML.** 184 periods and 2,431 games in one
response. The server built it in 68ms, so no server timing showed anything wrong
— the cost was entirely the browser being handed most of a megabyte of DOM. The
page now renders one period, which is 26KB.

Which period: the one holding today, else the start of the season. Deliberately
not "the period nearest to today", which for every past season means its last —
landing on the World Series when someone asks for 1962 answers a question they
did not put. `?all=1` still renders the whole season, because sometimes that is
what is wanted; it is just no longer what everybody pays for.

A period is addressed by its own grouping key — `/nfl/schedule/2026/w3`,
`/mlb/schedule/2026/d2026-08-29` — so the URL segment and the group key cannot
drift apart. Asked for a period the season does not have, the route 404s and
lists the ones it does, rather than serving week 1 under a URL naming week 25.

## Standings

`/standings` is where every club in a division finished, for a season. The
baseball site fetches ESPN's standings endpoint into a modal, so it can only ever
show the season being played; computed from the games already in the database
this works for 1962 as well as for today, and makes no request at all.

Two decisions worth knowing about, because both look like bugs:

**Grouped by today's divisions, including for seasons that predate them.** The
1962 National League had no divisions, so a 1962 table under "NL Central" is a
grouping this repo imposes rather than one the season had. It is the same
decision a division scope makes — a division means today's clubs, each with its
whole history — and the page says so at the foot rather than presenting it
silently. A 2011 NL Central shows five clubs, not six, because the Astros were in
it that year and are grouped under today's AL West. Realignment history would fix
it and nobody publishes it, which is why `nfl-divisions.csv` is a snapshot.

**The season shown is the latest one PLAYED, not the latest one on record.** Next
season's fixtures are published months before a snap: 272 unplayed 2026 football
games were in the database in August 2026. Taking the last season with rows
headed the page "NFL 2026" over "no games on record for this season" — a season
every visitor would read as current.

Under a scope covering two sports the season is named on each league's block
rather than once at the top, because in August football's latest played season is
last winter's and baseball's is the one being played. One heading over both names
one of them and is wrong about the other.

Games back is half the sum of the win gap and the loss gap, which is the number
people mean: a club level on percentage but with games in hand is half a game
back. Ties count half, as everywhere else here, and the postseason is not in it —
a club that went 13-3 and won three playoff games did not finish 16-3.

### The record opens the division table

Clicking a club's record opens its division standings for that season, as a
modal. The baseball site does this by fetching ESPN's standings endpoint when the
modal opens, which is why it can only ever show the season being played; this is
computed from games already in the database, so the modal on a 1982 page shows
1982.

**No JavaScript.** This repo ships no client bundle, and adding one to open a box
would be a bad trade. The modal is the `:target` pseudo-class and nothing else —
the record is a link to a fragment, the modal is hidden until it matches, and the
scrim and the close are both links back to `#`. It is last in the document, so a
browser that never applies the stylesheet shows the table at the foot of the page
rather than over the top of it.

**Built from the database, not from the scope.** Under `SCOPE=team:mlb/brewers`
the Cubs and the Cardinals are not in the scope's table at all, but their games
are in the same database — and a standings table with one row in it is not a
standings table. The scope decides which clubs get pages, not which games exist.
Division-mates the deployment does not serve appear as plain text, because there
is no page here to link to and inventing one would be a 404 inside a table.

Every club in the table is named by the resolver, including the ones with a
manifest. Mixing the two sources gave a table reading "Chicago Cubs, St. Louis
Cardinals, Brewers"; the resolver is also season-aware, so an old season names
the clubs as they were called then.

The cost is five clubs' histories instead of one, which under a single-club scope
is 287ms on the first request of a process and 12-20ms after — the game cache and
the derived memo both apply. A club with no division on record, or a season it
did not play, gets no modal and the record stays plain text rather than linking
to an empty box.

## League-wide records

`/records` at the scope root is the record book for every club in scope, where
the scope holds more than one. Under `SCOPE=team:packers` the root *is* the
Packers, so `/records` is already their record book and there is no league view
to add.

It runs `computeRecords` per club and merges, rather than a second
implementation over pooled rows. The per-club rules are subtle and settled — a
tie ends a win streak, an unfinished season is excluded, streaks span seasons
per sport — and a parallel version would drift from them.

The part that is genuinely different is double counting, and it is not uniform.
Every game is in the data twice, once per club:

- a blowout **win** for one club is a **loss** for the other, so ranking each
  club's wins yields every game exactly once;
- a **tie** is a tie for both and appears twice, so it is deduplicated by game
  id — date plus opponent collides on a doubleheader;
- a **season** or a **streak** belongs to one club and cannot double.

## League-wide schedule

`/schedule` and `/schedule/{season}` show every club in scope, grouped into the
periods that sport plays in. Football groups by week and baseball by date, and
which one is `rules.schedulePeriod` in `sports/<id>.js` rather than a branch in
the renderer.

**Weeks are stored, never derived, and do not exist before 1999.** nflverse
carries a real `week` on all 7,548 of its games from 1999 on; the
FiveThirtyEight seed covering 1920-1998 has no week column at all.

Deriving one from dates looks obvious — seasons start in September, weeks are
seven days — and was measured against nflverse's own numbers across four clubs:
**wrong for 322 of 1,816 games, 17.7%**. A postponement shifts every week after
it, and 2001 lost its week 2 to September 11th and replayed it at the end of the
season. So a season whose games carry no week is grouped by date and says so.

A game between two clubs in scope is one fixture, deduplicated by game id. For
an ordinary game either club's perspective rebuilds the identical fixture;
neutral-site games are the exception, because a club-perspective row reports
`location: 'neutral'` and no longer records who was nominally home, so the lower
source code wins and the answer does not depend on scope order.

## Scope: what one deployment shows

A site is configured by a single `SCOPE`, which resolves to a set of clubs.

```
SCOPE=team:packers              one club     (arethepackersundefeated.com)
SCOPE=division:nfl/nfc-north    four
SCOPE=conference:nfl/nfc        sixteen
SCOPE=sport:nfl                 a league
SCOPE=all                       everything
```

The selector question answers itself, and it is the only branch: a scope holding
one club serves that club at `/` and has no selector; any other serves a
selector at `/` and gives each club a prefix. A single-club deployment keeps an
**empty** prefix, so `arethepackersundefeated.com/records/longest-streak` does
not become `/nfl/packers/records/...` on the cutover and no existing link or
og:image URL breaks.

A **division means today's clubs, each with its whole history.** NFC North is
Chicago, Detroit, Green Bay and Minnesota, and it shows Green Bay back to 1921
whether or not the division existed. It is not "who was in the NFC North in
1985", which would need realignment history nobody publishes. The consequence
worth stating: the NL Central includes the Brewers' 1969–1997 *American League*
seasons, because those are the Brewers' history and the Brewers are in the NL
Central now.

Membership lives in `data/reference/*-divisions.csv` — curated, current, and
carrying that warning in the file where a person editing it will see it.

A club in scope with no data is **reported, never dropped**. Boot logs name
every gap, `/healthz` counts them, and the club's own URL returns 503 saying
which file or build command is missing — rather than a site quietly presenting
two clubs as a whole league.

## Usage

```
npm run fetch packers                 # schedules + pre-1999 seed
npm run fetch packers -- --pbp 2024   # one play-by-play season
npm run build packers                 # derive committed artifacts (no longer read by the server)
npm test                              # no sources needed, ~190ms

SCOPE=team:packers npm run dev        # http://127.0.0.1:3000

git config core.hooksPath .githooks    # once per checkout, see below
```

`core.hooksPath` turns on `.githooks/pre-push`, which refuses a push to a
branch whose PR has already been merged. That has happened three times: the
push succeeds, CI passes, and the work is simply not in `dev`. It fails open
when `gh` is missing or offline, so it is a backstop rather than the rule —
the rule is in CLAUDE.md.

### Container

```
docker build -t are-they-sports .
docker run -p 3000:3000 -e SCOPE=division:nfl/nfc-north are-they-sports
```

| variable | |
|---|---|
| `SCOPE` | **required.** No default: a server that guessed would start, answer every route, and show the wrong clubs. |
| `DATABASE_URL` | **required.** Games are read at request time. Missing is fatal; unreachable is not — the server starts and answers 503 with the reason. |
| `PUBLIC_ORIGIN` | pins the origin in absolute links. Without it any `Host` header becomes canonical, which is how a preview domain publishes itself as the real one. |
| `STRICT_SCOPE` | `1` makes any unbuilt club in scope unhealthy. Unset, serving at least one club is healthy, because building clubs one at a time is how this repo works today. |
| `PORT` | defaults to 3000. |
| `BUILD_SHA` | stamped into `/healthz` as `build`. Coolify's `SOURCE_COMMIT` is read too. Unset reports `"unknown"` rather than guessing. |

The healthcheck is `/healthz`, and it reports the gap between what the scope
promised and what is built.

**Point your orchestrator's health check at `/healthz`, not `/`.** The root
answers 200 even when nothing in scope is built — it is a selector listing
unavailable clubs — so a check on `/` calls that deployment healthy. Only
`/healthz` returns 503.

The image carries `curl` for exactly one reason: Coolify defines its own health
check per application, that definition overrides the image's `HEALTHCHECK`, and
it is generated as a `curl` command with a `wget` fallback. `node:24-slim` ships
neither, nor `nc`, nor `python3` — so every platform health check against this
image failed while the site itself served fine. It costs 17MB.

`npm test` covers the pure parts — CSV parsing, both adapters' row functions,
the franchise table's collapse, season-range arguments — plus the seam itself:
one test asserts the two sports produce exactly the same row keys, and another
asserts the two manifests still disagree where they are supposed to. All 73 have
been mutation-tested, which is how the suite found a `seedGameRow` guard that
turned a half-recorded score into a tie.

## Layout

```
sports/     adapters: where data comes from, and how it becomes neutral rows
teams/      manifests: identity and colours; about a dozen lines each
scripts/    fetch, build, franchise table
lib/        csv, scope, routes, index reading, record core, rendering
server.js   the server; HTML, with ?format=json on every route
test/       unit tests; needs no fetched sources
data/
  sources/    fetched, gitignored
  indices/    derived, committed
  reference/  curated, committed
```

A sport adapter has two jobs: say where the data is, and turn it into rows the
core reads. Everything downstream is sport-agnostic. Where two sports genuinely
disagree — whether streaks span seasons, how wide an "on this day" window
should be, whether a championship is one game or a series — the difference is a
value in a manifest, not a branch in code.
