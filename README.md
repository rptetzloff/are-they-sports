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

Those scoring plays land in the **artifacts** and nowhere else. The `scoring_play`
table has existed since the first migration, holds zero rows, and `load.mjs` never
writes to it — so box scores are not a rendering job over data already present.
They need the play-by-play fetched again, a loader path that does not exist, and
then a page.

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
site nav, answering 404, for as long as the nav existed, because the link went in
ahead of the page. Every link the nav emits is now resolved through the real
router, and a test guards the guard with a route that genuinely does not
exist — otherwise a check that returned true for everything would pass on the nav
that shipped the 404.

That test then caught the other half of building the page it was complaining
about. `/coaches` and `/managers` are the only routes whose NAME comes from the
sport, and the reachability helper parsed paths without saying which club it
held — so the leaders page was routable in the server and unroutable in the
test. Anything checking routes has to carry the club the way the server does,
which is [a club is a sport and an id](CLAUDE.md) arriving through a test helper.

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

That check found a crash that had been in every deployment: `/records` on a
freshly migrated database read `leagues[0].league`, and there is no `leagues[0]`
when no club has games. It killed the process, so every request after it was
refused too. The league routes answer **503** now, naming the load command,
because a scope resolving sixty-two clubs and finding games for none of them is
a data gap and this repo reports those rather than rendering something that looks
complete and is empty.

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

## One nav grammar

Every nav that steps through an ordered list is the same builder: seasons on a
club page, seasons and periods on a schedule, seasons on the standings. There
were four of these, written at different times in two grammars, and a schedule
page carried three at once — seasons at the top, days in the middle, seasons
again at the foot — with two of the three using identical glyphs on different
axes. Nothing but the value between the arrows said which was which.

```
SEASON  |‹  ‹‹  ‹   1998   ›  ››  ›|
DAY     |‹  ‹‹  ‹  Wed, Jun 15  ›  ››  ›|
```

**One chevron family.** The same glyph at the same weight throughout: a bar
marks the ends, doubling means ten. The club page used to mix U+22D8, U+00AB and
U+2039 for first, back-ten and back-one — and the first of those is a
*mathematical* symbol drawn to different proportions, so it never matched the
other two at any size, which is what made the row read as three unrelated
buttons.

**Every row is named**, so a page can carry two and neither is ambiguous. That
name also replaces the old "1998 Season" in the middle, which said the same thing
in the one place it could not be scanned.

**Ends are dimmed in place, not dropped.** The club page dropped them, so the row
changed width as you moved through the seasons — which reads as a rendering fault
rather than a boundary.

The ten-jump appears only above twenty items. It earns its place across a hundred
seasons and is clutter on four.

## A played season is written down, not worked out again

The record book for 1962 is the same answer on every request, in every
container, forever. It was being recomputed for all of them.

`league_summary` stores the result, keyed by the inputs it came from:

```
scope | sport | view      | season | version              | payload
all   | nfl   | records   | 0      | abc123|mlb/ANA@2026… | 33KB
all   | mlb   | standings | 2026   | abc123|mlb/ANA@2026… | 6KB
```

Three layers, cheapest first: the in-process memo, the stored summary, the
computation. A fresh process serves `/records` in **113ms instead of 2,400** —
it reads one 33KB row and never touches a game.

**A stale summary is not served, it is not FOUND.** The version is every club's
franchise and the stamp its rows were last observed at, plus the build that
computed it. A game changing moves a stamp, the version stops matching, and the
row is ignored and replaced. Verified against a real write: flipping a Brewers
win to a loss in Postgres took the standings from 85-52 to 84-53 with the
summary already stored.

The build is in the version because **a change to how records are computed moves
no stamp at all.** Without it, a deploy that fixed a records bug would keep
serving the bug out of this table — which is the failure this repo has already
had twice through a cache.

The scope is in the key because `/records` is four clubs under
`division:nfl/nfc-north` and thirty-two under `sport:nfl`. Two deployments
sharing a database would otherwise serve each other's record books.

### The ordering is the whole trick

The first version stored summaries and was barely faster, because the handler
loaded every club's games *before* it could work out the version — 471,453 rows
to discover that the answer was already written down. A fresh process still took
1,517ms to serve something it did not need to compute.

The version now comes from the database rather than from loaded rows, and the
rows are loaded lazily, only when a summary is missing. The season list is stored
too, for the same reason: picking which season the standings default to needs to
know which seasons were played, and computing *that* reads everything.

### It is still a cache

`TRUNCATE league_summary` loses nothing. Nothing hand-edits it, every row names
its inputs, and the whole table rebuilds on the next request that misses. That is
the test this file sets for derived data, and it is the reason this is not a
source of record.

What is NOT stored as a query: the sequence-dependent parts of the record book —
streaks, best and worst starts, lopsided wins. Those depend on
`rules.streaksSpanSeasons`, which is `true` for football and `false` for baseball
and is declared in the sport adapter. Expressing them in SQL would write that
rule a second time in a second language, and this file's own example of the cost
is that merging those two implementations "would silently rewrite one record
book". They are computed in JavaScript, once, and the *result* is stored.

## Share buttons

A `<details>` on the club page, like the club switcher, holding six links:
message, email, Bluesky, X, Facebook, Reddit. Messaging first and not
alphabetical — these sites are read on phones, where a text is how a game gets
shared with the person watching it too.

**No JavaScript, because sharing to a platform genuinely is a link.** Every
target is a URL with query parameters, so the whole feature is markup. What a
script would buy is copy-to-clipboard and the phone's native share sheet, and
neither can be a link — the URL is offered in a `readonly` field a reader can
select instead. Worse than a copy button, and it works with scripts off.
`readonly` rather than `disabled`, because a disabled input cannot be selected,
which would leave the fallback unable to do the one thing it exists for.

The text shared is the same pair the og tags and the card carry: the question as
the title, the answer as the text. Three places, one source, so a shared link
cannot say something the page does not.

Two details that are easy to get wrong and hard to notice:

- **`sms:?&body=`**, not `sms:?body=`. The stray ampersand after the empty
  recipient is what makes one link work on both iOS and Android, which otherwise
  disagree about the separator.
- **`&` in an href is `&amp;`.** The X and Reddit links join two parameters, and
  a bare ampersand in an attribute is an entity start. A mutation run caught
  this: the escape test only looked at the link field, so dropping `escapeHtml`
  from the href changed no result.

The icon names are checked against the pinned `@mdi/font` rather than
remembered — a name that does not exist renders as a blank box, which no test
here can see and no error reports. That check needs the network, so it is a
documented command in `lib/share.js` rather than part of the suite: a suite that
fails when a CDN is slow is one people learn to ignore.

## Social cards

`{club}/og/default.png`, `/og/{season}.png`, and one for each of records,
history, head-to-head and the leaders page. The club page points `og:image` at
its own, so a shared link shows the answer it is about rather than a house
picture.

One route rather than the six the two sites carry, because they are the same
picture with different words — and six routes would be six places for the words
to drift from the pages they describe. An invented slug is a 404 rather than a
card captioned `undefined`, and a club asking for the other sport's noun is
refused for the same reason the pages refuse it.

### The dependency, measured rather than recalled

| | |
|---|---|
| Debian vs Alpine base | **already paid** — the Dockerfile chose `node:24-slim` for exactly this |
| `@resvg/resvg-js` | 5MB `node_modules`, 4.2MB native binary, ~1s install |
| fonts | 810KB committed |
| **image total** | **354MB → 366MB** |

The lockfile carries all twelve platform binaries including `linux-x64-gnu`, so
`npm ci --omit=dev` works in the image even though the install ran on Windows —
checked, because a lockfile with only the host's binary is exactly how the
football site shipped one pinning `vite` and neither native package its cards
needed.

### The finding that shaped the design

**System font discovery does not work on the deployment image, and it does not
say so.** Measured on `node:24-slim`, rendering the same SVG:

| | PNG |
|---|---|
| no fonts, `loadSystemFonts: true` | 492 bytes |
| `fonts-dejavu-core` installed, same option | 492 bytes |
| explicit `fontFiles` | 3,968 bytes |

492 bytes is the background with the text **dropped** — a valid PNG, no error,
no warning. A renderer written against `loadSystemFonts` ships blank cards and
passes any test asserting only that a PNG came back. So the test asserts the
*difference* between rendering with fonts and without, and the fonts are always
passed explicitly.

That also kills the apt option: `fonts-liberation2` costs 21MB **and does not
work**, because discovery is what is broken rather than availability.

Fonts are Liberation Sans, metrically compatible with the Arial the stylesheet
already specifies, under SIL OFL 1.1 — the licence text ships beside them in
`data/fonts/LICENSE`, as that licence requires. `.gitattributes` marks `*.ttf`
binary explicitly: git's own detection would probably have been right, and
probably is not good enough for a file whose corruption shows up as a card with
no words on it.

`opentype.js` is **not** a dependency. Text is fitted with an average advance
width, which only has to be right about the long names — the test pins the
longest club name this repo carries against the card width.

## What a shared link looks like

Every page here previewed as **nothing**: no `og:` tags, no `twitter:` tags, no
description, no canonical. A club URL pasted into Slack or iMessage was a bare
link — whether or not a share button ever existed, which is why this comes before
the buttons rather than with them. People share these by copy-paste already.

The club page describes itself with the thing it exists to say:

```
og:title        Are the Brewers Undefeated?
og:description  NO. 2026 record 85-53.
og:url          https://.../mlb/brewers
```

No derivation produces that — the page knows the question and the answer, so it
passes its own description. Every other route gets one derived from the title it
already computes, because a preview with a title and no description is worse than
one with a plain sentence.

**Injected centrally, not threaded.** `page()` is called from thirteen places,
and this repo has twice shipped a page missing something wired per call site: the
leaders nav link answered 404 from every club page, and the data credit had to be
added to two pages by hand. A fourteenth page added later would silently have no
tags. So the tags go in where the response is sent, and every route gets them by
construction.

The title is read back out of the rendered HTML rather than passed a second time
— every page already computes a good one, and asking twice is how the tab and the
shared link come to disagree.

`og:url` is absolute and comes from `PUBLIC_ORIGIN` where it is set. That
machinery existed before anything emitted a tag, with a warning attached: without
it any `Host` header becomes canonical, which for a share card means a staging
deploy telling every reader that it **is** the site.

`summary_large_image` is claimed only when there is an image. There is not one
yet — the social cards need `@resvg/resvg-js` — so the card falls back to
`summary`, which is what it should do rather than promise a picture it has not
got.

## On this day

What the club did on today's date in other years, on the front page. It needs
nothing but games, which is why it was the cheap item on the parity list: no new
source, no migration, no fetch.

**The window is a sport rule that was declared long before anything read it.**
`rules.onThisDayWindowDays` is 0 for baseball and 3 for football, and the
difference is not a preference — a club playing 162 games has a game on almost
every calendar date, so an exact match fills the panel; a club playing 17 has
empty dates by the hundred, and an exact match shows nothing for most of the
year. The Brewers get 55 games on an exact date; the Packers get 14 across a
seven-day window.

So the heading changes with it. "On this date" where the match is exact,
"Around this date" where it is not — with a window, six of every seven games
shown are not on this date at all, and calling them an anniversary would be
wrong about most of the panel.

Three things it deliberately does not do:

- **The current season is excluded.** A game played an hour ago is already the
  answer at the top of the page; repeating it under a heading about other years
  reads as a mistake.
- **Unplayed fixtures are excluded.** A future season's game on today's date has
  no result, and a panel about what happened must not list what has not.
- **An empty panel says it is empty** rather than disappearing. An absent panel
  and a panel with no matches look identical, and only one of them means this
  club has never played on this date.

Dates are compared as `MM-DD` strings in UTC and the clock is read in the server
and passed in, never inside the compute function. A game's date is a plain
`YYYY-MM-DD`; parsing it makes it midnight UTC, and formatting that west of
Greenwich moves every game a day earlier — the same trap `lib/render.js` already
carries a warning about. Passing the date in is also what lets the year boundary
be tested without waiting for December 31.

## The data credit

Every page a reader lands on names where the data came from — the club front page
and the selector. This repo rendered no credit at all until now, and that was not
a missing nicety: most of these sources ask for attribution and **Retrosheet
requires it**, so the absence was a licence term going unmet for as long as
baseball had been loaded.

Credits are declared in `sports/<id>.js`, beside the sources they describe,
because that file already says where data comes from and a second list elsewhere
is the drift this repo keeps warning about. `lib/credits.js` merges them for the
sports **in scope** and adds the repo-wide ones.

**A deployment credits only what it uses.** A football-only site does not name
Retrosheet; a baseball-only one does not name FiveThirtyEight. Crediting a source
you do not use reads as carelessness at best, and a reader cannot tell it from a
false claim. Sources both sports use — ESPN's scoreboard — appear once.

The third tier is credited by everyone, because it is the easiest to forget:
nothing fetches it and no adapter declares it. Wikipedia for the coaches and
champions files, teamcolorcodes.com for the colours in the franchise histories.

### What each source actually requires

| source | licence | what it asks for |
|---|---|---|
| Retrosheet | — | a specific statement, appearing **prominently** |
| nflverse | CC BY 4.0 | attribution, a link to the licence, and an indication that the data was modified |
| FiveThirtyEight | MIT | the copyright notice retained |
| Wikipedia | CC BY-SA 4.0 | attribution and a licence mention |

Retrosheet's statement renders **in full, on its own, and undimmed** — their terms
say "prominently", and styling it to match the quiet credits above it would be
the design overruling a licence term without anyone deciding to. A test asserts
the whole sentence appears, not a prefix, because `includes` on the first clause
passes on a truncated notice; another asserts the CSS rule carries no `opacity`
and no `--muted`.

CC BY asks that modification be indicated, and everything here is modified —
games become a neutral row, plays are dropped unless they scored, records are
recomputed. Said once for the whole footer rather than per source, because
repeating it five times reads as boilerplate.

### Three of these were wrong, written from memory

Every licence claim in the first version of this was guessed and every guess was
committed:

- **Retrosheet's notice** ended with a postal address — `20 Sunset Rd., Newark,
  DE 19711` — that is not in their current terms, which give the website.
- **nflverse** was described as vaguely "asking to be cited". It is CC BY 4.0,
  with specific requirements.
- **FiveThirtyEight** was called Creative Commons. It is **MIT**, and requires a
  copyright notice for ABC News Internet Ventures.

Each was committed with a comment admitting it had not been checked, which is
not the same as checking it. Reading the two `LICENSE` files and asking about
the third took one round trip and produced the real text. The licences are pinned
by name in tests now, so a future guess cannot quietly replace them.

## Champions before there was a championship game

The database answered "who won this season" by finding championship **games**:
the load marks the last playoff game of a league and calls its winner champion.
That works from 1933 and cannot work before it. Twelve NFL seasons were decided
on the final standings and one by a tie-breaking playoff, so there was no game to
win — and Curly Lambeau's leaders row showed three titles where he won six, with
nothing in the data wrong.

`data/reference/nfl-champions.csv` is the third curated file, for the same reason
as the first two: nobody publishes this. 64 rows, 1920–1969, loaded into a
`championship` table alongside rows derived from games for 1970 onward.

| method | rows | |
|---|---|---|
| `championship game` | 51 | a scheduled final |
| `standings` | 12 | awarded on the final standings, or by vote |
| `playoff game` | 1 | 1932, a game played only to break a tie |

**The 51 derivable rows are kept deliberately.** The load's "last playoff game of
a league" rule had never been checked against anything, and these are an
independent source to check it with. 52 agree. The check earned its keep before
it was committed: three codes in the supplied file were wrong and **every one of
them resolved** — `CRA` is the Chicago Rockets, `NYY` the NFL New York Bulldogs,
`BDA` the Brooklyn Dodgers — so the AAFC champion and two runners-up were real
clubs and the wrong ones. Corrected to `CLE`, `NAA`, `BBA` against the games
themselves.

### Where a title shows

Everywhere a title is shown, which took a second pass. The table shipped with
exactly **one** consumer — the Titles column on the leaders page — so a
championship appeared in one place and nowhere else, which is not intuitive and
was reported from the running site.

| | |
|---|---|
| `/champions` | every champion the league has had, sortable, with how it was decided |
| club `/records` | the championship card, so the Packers' book lists 1929, 1930, 1931 |
| club `/history` | title markers on the chart — thirteen for Green Bay, not ten |
| leaders | the Titles column, as before |
| league `/records` | the Championships card — **added later, and it was the one this list missed** |

That last row is the point of writing this list down and the proof it was not
enough. Four consumers were enumerated and wired; the league-wide card was a
fifth, and it counted only titles decided by a GAME for months afterwards. It
read **Packers 10** against thirteen, **Bears 7** against nine and **Giants 7**
against eight, with the finals lost beside them counted across every era — so
the two numbers were not comparable and the card looked roughly even. Nothing
failed. `computeLeague` simply never passed `titles` through to `computeRecords`,
and a default of `[]` is silence.

### A title is a final won, and a final is a round

Three rules, each of which was wrong once and each of which cost real
championships:

**A title is a final WON, not a championship-round game won.** The Brewers won
three games of the 1982 World Series and lost it 4–3, and the chart marked 1982
with a title dot whose tooltip read "1982 — champions".

**A season is judged per ROUND, not across the season.** Eight clubs played two
finals in a season between 1966 and 1969, and four of them won their league
championship and then lost the Super Bowl — Kansas City 1966, Oakland 1967,
Baltimore 1968, Minnesota 1969. Adding a season's championship games together
makes those 1–1, which counts as neither a title nor a final lost. **Every one of
those league titles was missing**: the Chiefs showed five championships against
a published six, the Raiders three against four, the Colts four against five, and
the Vikings none against one.

**A title is not a winning postseason record.** Every Super Bowl loser wins two
or three playoff games to get there.

So the season's title is the most significant round it won — Green Bay 1966 is a
Super Bowl because they won both games, Kansas City 1966 is an AFL Championship
because they won that one and lost the other — and where it won none, the most
significant round it reached, which is what "lost Super Bowl" means on the
history table. One implementation, `finalOf`, shared by the chart, the table and
the record card, because there were two and they had already diverged.

`computeRecords` takes a `titles` option and **unions** it with what the games
already say. Passing nothing leaves the function exactly as it was, which is what
every test written before it relies on. A standings title has no record and no
opponent, and the record book prints "took NFL Championship on the standings"
rather than "won" over a blank score.

Baseball is derived into the same table — 121 World Series — because a page that
reads the table would otherwise be blank under an MLB scope, which is the "looks
complete, isn't" failure arriving by a new route. That is storing derived data,
and it is the same bargain `league_summary` and `game_leader` make: rewritten
every load, hand-edited never, identical after a drop and reload.

**A draw is not a win.** Deriving baseball's champions from
`(home = club) = (home_score > away_score)` counts a tied game as an *away* win,
because false = false is true. The 1912 World Series ran to eight games — game
two was called 6-6 for darkness — so Boston's 4-3 became 4-4 and that season came
out with **no champion at all** while the other 120 looked fine.

### Three things that are subtler than they look

**1932's game is linked but its round is not rewritten.** The Bears and the
Spartans finished level and played indoors at Chicago Stadium; the game is in the
data as `regular`, because at the time it *counted in the standings*. Marking it
a championship to make a join work would be editing history to suit the schema,
so it is linked on the pair of clubs the curated file names and `method` records
what it was.

**Super Bowls I–IV nearly went missing.** Keyed by season alone, the derived pass
skipped every season the curated file mentions — and 1966–69 each have a curated
NFL *and* AFL champion, so the four games that era is remembered for were
dropped. Green Bay's 1966 read "NFL Championship" with no Super Bowl beside it.
Keyed by season **and league**, with the pre-merger Super Bowl under `AFL-NFL`
because it belonged to neither.

**A club counts a season once.** Green Bay won the 1966 NFL Championship and then
Super Bowl I: two rows, one championship season. Counting rows gives Lombardi
seven where he won five. And the reverse trap — Kansas City won the 1966 AFL
Championship and *lost* Super Bowl I, Baltimore won the 1968 NFL Championship and
lost Super Bowl III — so where a season has a Super Bowl, only its winner is
champion of that season. Otherwise every league champion is, because 1946–49 and
1960–65 had two leagues and no game between them.

### Checking the era that has no games

Those twelve standings rows are the only ones nothing could check, and a mutation
run proved it: changing the 1929 champion from Green Bay to the Bears changed no
test result. But the title was awarded *on the standings*, so the champion should
top its own league — and nine of twelve do. The three that do not are each
documented in the row's own note, and the test **requires the note**:

| | |
|---|---|
| 1920 | Akron tied Buffalo on percentage; the title was voted on |
| 1925 | Pottsville finished ahead and was suspended |
| 1930 | the league excluded ties from percentage and this repo does not — Green Bay .769 to the Giants .765 |

The test counts clubs finishing *strictly* ahead rather than reading a sort
position, because 1924 is an exact tie between Cleveland and Duluth at .8333 and
whichever the sort happened to place first decided whether it passed.

## The championship noun is the club's word for TODAY

`nouns.championship` is "Super Bowl" and "World Series", and it is what the club
plays for now. Printed over a list that spans eras it is simply wrong: Green
Bay's 1936 read "Super Bowl", thirty years before there was one.

The name comes from the DATA — `championshipTitle` on the game, or the curated
row — and falls back to the manifest only where the data has no name to give.
That fallback is not a corner case: all 707 baseball championship rows carry a
null title, because Retrosheet says a game was in the World Series without
naming it. Football names all four of its rounds (Super Bowl, NFL Championship,
AFL Championship, AAFC Championship, plus APFA for 1921).

Three places printed the modern noun and now do not: the history table's Final
column, the record card's note under "Championship games", and the league-wide
Championships card, which grouped 27 Yankees titles under the literal word
"Championships".

**Plurals come from the name, not from a manifest noun.** Appending an "s"
produced "World Seriess" the moment those titles started carrying their name —
the same shape as the "2 clashs" this repo already records, arriving in a second
place. A name ending in "s" is already its own plural, which is true of every -s
proper noun and is not a special case for one league. A `championshipPlural`
noun would not have reached it either, because these names are data: `title` is
whatever the load wrote, and the next league brings its own word without editing
a file here.

### The history table says how the season ended

It used to print a single word for a title season and nothing at all otherwise,
so a season the club reached the final and lost looked exactly like a season it
missed the playoffs. The column is headed **Final** now and says three different
things: the round won (in the club's colour), the round lost (dimmed — reaching
the final is not a bad season, and `--loss` beside a 13–3 record says the wrong
thing), and "took NFL Championship" where the title was decided on the standings
and there was nobody to beat.

## Tables on a phone, and a screenshot that was lying

`npm run viewport 390 http://localhost:3000` opens every page at a phone width
and reports which ones scroll sideways, and which element is too wide.

It exists because the obvious way to check that is wrong.
**`chrome --headless --screenshot --window-size=390,900` does not give you a
390px viewport on Windows.** The window has a minimum width, so the page lays
out wider than asked and the image is cropped to the size requested — which
draws a clipped heading and a cut-off column on a page that is perfectly fine.
A list of four overflowing pages produced that way was wrong about two of them
and missed the worst one. Above roughly 500px the command is honest, which is
why the 1400px checks throughout this repo have held up.

`scripts/viewport.mjs` drives the same browser over the DevTools protocol and
sets `Emulation.setDeviceMetricsOverride`, then asks the page for
`document.documentElement.scrollWidth`. Node ships a WebSocket client, so it
adds no dependency. It answers the question a screenshot cannot: **which
element**. Every offender on every page turned out to be a `<table>`.

Measured at 390px before the fix:

| | |
|---|---|
| `/coaches` | 174px over |
| `/managers` | 76px |
| `/history` | 59px |
| `/vs` | 41px |

`/records`, `/schedule`, `/standings`, `/champions`, the club page and the
season page were all already fine — which is why this went unnoticed: the site
mostly fits, and a page that scrolls sideways moves its centred heading off
centre, so the visible symptom is a clipped title and the cause is three
elements down.

The fix is `overflow-x: auto` on `.panel` and `.record-card`. **On the
containers, not on a wrapper element**, so a table added later inherits it —
both sites use a `.h2h-table-wrap` and have exactly that to remember. Under
600px the cell padding tightens and cells stop wrapping: Lombardi's Titles cell
is "1961, 1962, 1965, 1966, 1967" and broke onto five lines, making his row five
rows tall while the column itself was scrolled out of sight, so a reader saw an
unexplained gap next to two coaches and nothing to explain it. Making the table
wider costs nothing once it is a scroll container.

Overflow clips positioned descendants, and the one thing that could have hit is
the standings modal — which is `position: fixed` and a **sibling** of these, not
a child. The focus ring on a record card is that element's own `box-shadow`, and
overflow does not clip an element's own shadow.

**Columns are kept rather than dropped.** The baseball site hides the coach
photo below 600px, which costs nothing because a photo is decoration; every
column here is a number somebody came for.

What the scroll does not have is an affordance — nothing says the table scrolls,
and neither site has one either. The pure-CSS scroll shadow was considered and
rejected: it needs an opaque cover colour matching the container, and `--panel`
is translucent black over the club's ground, so there is no colour to use.

After: **0 of 16 pages overflow at 320px, 360px, 390px and 1400px.** The last
number is the check that the fix changed nothing on a desktop.

`test/mobile.test.js` holds the part a test can hold, deliberately as two halves
that only mean something together — the stylesheet gives those containers a
horizontal scroll, and every table this repo renders is inside one of them.
Neither half alone stops a page overflowing. It cannot prove the rule *works*:
`overflow-x` could be misspelled into a property no browser has and both halves
would still pass. The browser measurement is the stronger check, it needs a
running server and a loaded database, so it is a script rather than a test.

## Sortable tables, without any JavaScript

Every `.league-table` — leaders, the all-time league record book, standings, a
club's season history and the head-to-head index — sorts by clicking a column
header. The header is a link
and the order is a `?sort=` query parameter the server reads, which is the same
shape as the `?format=json` already on every route.

**There was no client-side JavaScript in this repo and this did not add any** —
zero script tags, zero handlers, and the standings modal is a CSS `:target` on an
anchor. That was a measured fact about the code, not a stated policy: nothing
said browser JavaScript was unwelcome until sorting was built, and the first
version of this section wrongly described it as a rule the project already had.

Keeping it that way was a decision made here, on its own reasoning. Rendering
that happens in the browser is not reachable from `node --test`, which is how 118
tests passed on the football site while every past season rendered a 0-0 record.
Sorting on the server makes the order a pure function of the request, so a test
can assert it and a reader without JavaScript still gets it. The cost is a round
trip per click. A feature that genuinely needs a script should add one and say
why.

Three rules the tests pin, because each was wrong once:

- **A column decides its own first direction.** Nobody clicking "W" wants fewest
  wins and nobody clicking a name wants Z first, so `defaultDir` is per column.
  Clicking the column you are already sorted by reverses it.
- **The order is total.** Rows equal on the sorted column are broken apart by a
  stable key, because otherwise they fall back to whatever order the query
  returned — and a table that reshuffles two equal rows between requests looks
  broken in a way nobody can reproduce.
- **No sort parameter means no sorting.** Falling back to the first column
  re-sorted the all-time table and the standings alphabetically by club, taking
  away the win-percentage and standing orders those pages arrive in. A feature
  that adds an option must not remove the existing one.

Missing values sort last in both directions: a club with no value has not got a
very small one.

Switching clubs on the leaders page translates the noun. `/nfl/packers/coaches`
links to `/mlb/brewers/managers`, not to `/mlb/brewers/coaches` — which is what
it did at first, in both directions, because the switcher appends one path to
every club's base and every route below a club is spelled the same for every
club **except this one**. No reachability test caught it: they all build a
single-sport scope, where the two nouns never meet.

The **leaders page defaults to chronological, earliest first**, so it reads as
the club's history from the top. It was most wins first, which is what both live
sites do — and is the wrong default for a page that lists everyone who held the
job rather than ranking them. Wins are one click away. The standings **modal** is
deliberately not sortable: it lives inside a CSS `:target`, and a link in it
would navigate away and close it.

## Photographs are sidelined, by decision

Not a gap: a choice, taken on 2 September 2026 by the reviewer, in those words —
*"it's a lot of complexity for very little reward"*. It covers both places they
appear, the front-page gallery with its lightbox and the coach photos on the
leaders page.

The reason is worth recording because it is the shape of the cost. A photo is
not something this repo can derive: the sites read `image` and `imagePage` out of
their own coaches CSV, pointing at Wikimedia Commons. So it needs a fourth
reference file nobody publishes; per-image licence and attribution carried
alongside every URL, since Commons images are not uniformly licensed and several
require the photographer's name in the caption; a lightbox, which is the one
item on the parity list that genuinely cannot be done without a script; and
either a cache or a hot link to somebody else's server on every page view.

Against that: a picture of a coach, beside a table that already names him.

**This is "we decided not", not "we could not".** If it comes back, what it needs
first is the data — a licence-bearing column, curated the way the champions and
coaches files were — and not the rendering.

## Share, on every page that has something to say

Six links in a `<details>`, because sharing to a platform genuinely is a link.
The mechanism was built and tested long before this and wired into one page, so
the parity list carried "share on the page — gap" four separate times for four
pages using the same six lines.

It is now on the club page, the record book and each record's permalink,
head-to-head and each opponent, the history and the leaders. Each carries its
own sentence, and that sentence is the one its own meta description carries:
one source, so a shared link cannot say something the page does not.

**The shared URL drops the query string.** `?sort=w&dir=desc` is something
somebody did to the page rather than the page itself, and a link that arrives
with a stranger's sort applied reads as broken. That is the opposite call to the
head-to-head filters, where the query string IS the view and sharing it is the
whole point — the difference is whether the parameter changes what the page is
about or only how it is arranged.

Two things this cost, found by writing the copy rather than by any test:

- The history sentence said **"13 super bowls"** for a club with four, and
  **"0 world seriess"** for the Brewers. The era-noun mistake and the
  pluralisation bug, both fixed a fortnight earlier elsewhere, arrived together
  in new copy the moment somebody wrote a new sentence. It says "13
  championships" now and omits the clause at zero.
- The leaders page put its share row between the switcher and the site nav,
  where every other page puts it last. One page out of five in a different place
  is what nobody notices and everybody copies.

## Numbering the coaches, and two features neither site had

The leaders table opens with the club's own count: **1..N for the people who
held the job, and a fraction for somebody who only ever stood in.** Mike
McCarthy is Green Bay's fifteenth here and Joe Philbin is 15.1, so the official
count survives and the column still sorts as a number.

**Per person, where both sites number per stint.** That is a deliberate
difference. Ray McLean stood in for Green Bay in 1953 and was the head coach in
1958, and the club counts him once. The football site's `computeCoaches` numbers
each span and then keys it back to `byCoach.get(s.name)` — the coach's whole
career — so a man with two spans gets two rows carrying identical totals.

Three rules, each with a test:

- **Numbered by arrival, not by the order the rows are in.** This page is
  sortable; numbering the array as handed over renumbers everyone the moment
  somebody clicks "W".
- **Numbered before anything is filtered.** Hiding the stand-ins and finding
  McCarthy renumbered from 15 to 14 would be the page contradicting the club.
- **The input order is returned unchanged.** The caller sorts. Returning arrival
  order would silently undo the reader's chosen column.

The count is what this repo knows, which for football before 1999 is not the
whole story: Green Bay comes out with sixteen regulars where the club says
fifteen, because Hugh Devore's 1953 spell is an interim the curated file does
not mark. The page already says interims are only marked from 1999.

### Hiding the stand-ins is a link

`?interim=hide` leaves the people who held the job, which is the list a club
publishes. Both sites use a checkbox remembered in `localStorage`; a link needs
no script and makes the filtered view a URL somebody can send. What it costs is
that the choice does not follow the reader to the next club, which the sites'
version does.

Two details that were wrong first and are pinned by tests: the count comes from
the **unfiltered** set, or the link vanishes the moment it is used and there is
no way back; and every other query parameter survives, or hiding a stand-in
throws away the column somebody sorted by.

Drawn only where there is a stand-in to hide — the same call the head-to-head
"current franchises" control makes.

### Two audit rows were things neither site does

The parity list carried "points for / against" and "per-coach slug and detail
view" as gaps on this page. Both were written from memory, and reading the sites
is what settled them:

- `computeCoaches` totals `pf` and `pa` and **the table never renders them**.
  Neither site shows the columns.
- **There is no per-coach route on either site.** `/coaches` and `/managers` are
  the only ones; the slug exists to key a lightbox.

Removed rather than built. Building them would be inventing a difference, which
is the rule the audit is supposed to enforce.

What is genuinely still missing from this page is **photos** — and that is a
data gap before it is a rendering one, since nothing in this repo holds a photo
URL for a coach.

## Coach eras on the history chart

Alternating translucent bands behind the line, each labelled with a surname and
each naming itself in full on hover. Two things a reader gets from them that the
table cannot give: which stretch of the chart belongs to whom, and how long each
man lasted, read as width.

**Bands are STINTS, not careers.** The leaders table is one row per person and
that is right for a record book — Harvey Kuenn's 1975 and his 1982–83 are one
career. A band is a period of time, and one band spanning 1975 to 1983 draws
straight over Alex Grammas, George Bamberger, Buck Rodgers and Rene Lachemann,
who held the job for seven of those nine years between them. `leaderStints`
cuts the game rows into unbroken spells per club.

Those rows arrive already folded: `game_leader.leader` is who HELD the job and
`ran` is who managed the game when that was somebody else, so an ejection does
not chop a season into stints. Without that fold this would be unusable — Phil
Garner's 2006 Astros are `Cooper(1) Garner(37) Cooper(1)` in the raw data.

### Three placement rules, each of which was wrong once

**Positioned by index, not by season.** `chartGeometry` spaces points evenly
however far apart their seasons are, so a club with a gap has a chart where 1942
and 1946 are neighbours. Bands computed from season numbers drift off the line
they sit under.

**A band ends where the next one starts.** A stint's last season is one the next
man also worked, so drawing each to its own bounds overlaps every boundary by a
year.

**Half a slot either side**, because a point is the middle of its season and a
band covers the whole of it. Without that the final band is zero wide whenever
the last coach has a single season — the boundary and the chart's right edge are
the same x — which is how Pat Murphy disappeared off the first version.

A season with more than one man in it is **split evenly between them**. That is
an approximation and a deliberate one: the exact answer is available for the
counted era, where stints carry first and last game dates, and is not available
at all for football before 1999, where the curated file knows only seasons.
Splitting by count is one rule for both, never produces a zero-width band, and
puts the boundary in the middle of a season that was genuinely divided. The
baseball site positions by exact date and the football site by whole season, so
this sits between them.

### The tooltip is a `<title>`, and needs no script

Both sites wire a `mousemove` handler and an absolutely positioned div to say
"Vince Lombardi, 1959–1967". SVG has had a native `<title>` element for that the
whole time. What theirs buys is styling and placement; what it costs is a
tooltip that does not exist with scripts off.

The per-season hover on the line itself is a different thing, is still a gap,
and does still need a script.

### Labels fit their own band or are not drawn

Only the surname — "Vince Lombardi" does not fit a nine-season band — and
co-coaches keep both, because the 1953 Packers were Devore and McLean and
dropping either names the wrong man.

A fixed pixel threshold does not work. At 34px both "Gregg" and "Infante"
cleared it in adjacent four-season bands and rendered touching, so the chart
read **"Gregg Infante"** as one man. The test is now the label's own estimated
width against its own band, using the social card's `textWidth` — measured
against Liberation Sans rather than guessed, and wrong in the safe direction, so
it drops a label that would just have fitted rather than drawing one that just
does not.

Two names run together is worse than one name missing: the band is still there
and still names itself on hover.

## Interim coaches, and a flag that meant something else

The leaders table marks a stand-in with an asterisk, and the headline count
excludes them: "16 coaches plus 1 interim". Both sites report it that way, and
so does a club — Green Bay's fifteenth head coach is Matt LaFleur whether or not
somebody covered four games along the way.

**The flag is derived from the games, and the source file's own flag is not
usable.** `data/sources/sportsdata/coaches/nfl_coaches.csv` carries one, produced
by `build_coach_tenures.py` from the rule "at most 60 games, followed by somebody
else, in an adjacent season". That describes a coach who was **fired** as
accurately as one who stood in. Measured over the 1999–2025 tenures it flags 57
people and **24 of them were permanent head coaches**:

> Al Groh, Marty Schottenheimer, Art Shell, Bobby Petrino, Cam Cameron, Lane
> Kiffin, Josh McDaniels (twice), Jim Mora, Hue Jackson, Mike Mularkey, Aaron
> Kromer, Rob Chudzinski, Jim Tomsula, Ben McAdoo, Chip Kelly, Steve Wilks,
> Freddie Kitchens, David Culley, Urban Meyer, Lovie Smith, Nathaniel Hackett,
> Frank Reich, Jerod Mayo.

The Wikipedia scrape is no better — `nfl_coaches_wiki.csv` marks 1 of 627 — and
the curated `data/reference/nfl-coaches.csv` carries the column with `FALSE` on
all 382 rows, because it was created and never populated.

### The rule

**They never took this club into a season.** Every game they are on record for
came after somebody else had already opened that year.

It was written as two conditions — "began mid-season AND did not open the
following season" — and a mutation run showed the second could not fail.
Deleting it changed no result, because a stand-in who is given the job opens the
next season and the first condition catches him there. Jason Garrett took over
Dallas in November 2010 and opened 2011; that is what clears him, and the second
clause was restating it. Doug Marrone, Mike Tice, Dave McGinnis, Leslie Frazier,
Dick LeBeau and Tom Cable are the same shape.

It selects **exactly 33 of the source file's 57**, a strict subset, and every one
of the 24 dropped is a permanent head coach.

**Per club, not per person.** Steve Wilks opened 2018 for Arizona and stood in
for Carolina in 2022, and both are true; a page about one club says the one that
is true there. Merged across clubs the conservative answer wins — somebody who
ever held the job properly is not an interim.

### What it misses, said out loud

- **Football before 1999** has no per-game source, so nothing can be derived and
  the curated file says nothing. The page says so: *"Interim coaches are marked
  from 1999, where the per-game record starts."* The year is read from the rows'
  `basis`, not hardcoded — 1999 is football's boundary and would be a lie in any
  other sport.
- **A season-long absence.** Aaron Kromer opened 2012 for New Orleans while Sean
  Payton served a season-long suspension, so he passes the opener test and is
  not marked. That case is `creditFillIns`, and this is not it.
- **The last season on record.** A stand-in there is marked, because there is no
  following season to clear them — which is what every source says about them at
  the time, and unmarks itself on the next load if they open the next one.

### Still to do

Retrosheet publishes an authoritative per-club manager list with official
numbers — `managers.csv`, which the baseball site reads and this repo does not
fetch. That would replace the derivation for baseball outright, and it also
carries the numbering the parity list still wants (1..N with a manager's second
stint as 8.1). The numbering needs a row per stint, and this table is a row per
person, so it is a bigger change than a column.

## Head-to-head, and filters without a script

`/vs` lists every opponent a club has played; `/vs/{slug}` is one of them in
full. Both sites carry three controls the index here did not have — a name
filter, a venue, and a game type — plus a fourth on football, "current
franchises only".

They are query parameters and a GET form: `?q=bear&venue=home&type=regular`.
The sites wire an `input` event and two `change` handlers and re-render in the
browser; here the filtered view is a URL, which makes it a link somebody can
send, a bookmark that still works, and a thing `node --test` can assert. **The
price is an Apply button**, because a `<select>` cannot submit its own form
without a script. That is the honest trade and it is one click.

Two directions of the same bug are pinned by tests: the sort travels through the
form as hidden fields, and `sortHref` already carried the filters the other way.
Without either, applying a filter throws away the column the reader chose, or
sorting throws away the filter.

**Venue and type filter the GAMES; name and current-only filter the OPPONENTS.**
Not a detail — a home-only record cannot be recovered from an all-venues one, so
the first pair re-runs `computeHeadToHead` over the subset the way the sites do,
while the second pair leaves every number alone. The unfiltered totals are
computed either way, because two things need them: the "23 of 61" count, and the
opponent lookup — a filtered index must still resolve `/vs/{slug}` for an
opponent its own filter hides, or the link a reader just followed 404s.

### "Current franchises" is derived, and neither site's rule ported

The football site hardcodes thirty-one names, which goes stale the next time a
club moves. The baseball site derives it from the games — current if the
opponent appears in the latest season present — which is only safe where
everybody plays everybody. A football club meets fourteen of the other
thirty-one in a season, so that rule would call twenty-eight franchises defunct.

`currentFranchises()` reads the franchise history table instead: **a franchise is
current if its latest era is the latest era anyone has.** Football writes an end
season on every row and the live ones read 2026; baseball leaves the end blank on
an open era; both fall out of one comparison with a blank sorting last.

Measured: **32 of 119 football franchises, 30 of 30 baseball ones.** That second
number is why the baseball site has no such checkbox, and this page draws the
control only where it would narrow something — a control that can never change
the table is worse than no control.

### The opponent page was the bigger half

`h2h-core.js` is 118 lines on the football site and 206 on the baseball one, and
`computeOpponentDetail` is most of the difference. `/vs/{slug}` here was a game
list; it now carries the splits (overall, last ten, home, away, regular,
postseason), the longest run either way, shutouts in both directions, the score
differential, and a by-era table — "Chicago Staleys 0–1, Chicago Bears 109–97–6".

Nothing in it is baseball, so football gets it too, which is the point of the
adapter seam. Three things it says are worth stating because the obvious version
of each is wrong:

- **A 0–0 tie is not a shutout.** Checking only the score counts a drawn game as
  both a shutout win and a shutout loss, and football has real ones.
- **"Last 10" is dropped when there have been ten or fewer**, where it would
  repeat the overall row under a different heading.
- **A single-era opponent gets no era table**, for the same reason.

The site renders all of this as a focus card injected above the table, closable,
pushed into browser history. That is how a single-page app gets a shareable
address. This repo already has the address, so it is simply the page.

## The leaders page, and a claim that was two-thirds wrong

`/coaches` for football and `/managers` for baseball — one page, and the noun
comes from `nouns.leaderPlural` in the sport adapter rather than a branch.

This repo said for months that the page "needs a curated coaches/managers table
nobody publishes". That was checked rather than assumed, and it survives for
exactly one era of one sport:

| | source | coverage |
|---|---|---|
| baseball, 1871– | Retrosheet game logs, fields 90 and 92 | 217,906 of 225,713 final games, 96.5% |
| football, 1999– | nflverse `schedules.csv`, `home_coach` / `away_coach` | 7,548 of 7,548 rows, no misses |
| football, 1920–1998 | **nothing.** FiveThirtyEight's file has no coach column | curated |

The baseball managers had been sitting in a file the loader was not reading, and
the modern football coaches in two columns of a file it *was* reading. Only
`data/reference/nfl-coaches.csv` had to be written, and it is the same kind of
file as `nfl-franchise-history.csv` for the same reason.

**A leader is a person, not a name.** nflverse writes `Jim Mora` for
Indianapolis in 1999 and Atlanta in 2004, and those are a father and a son. Key
the page on the string and it serves one coach with an eleven-year career and
three clubs — no error, no failing test. Retrosheet solved this long ago by
publishing a manager id, unique across all 1,490 (id, name) pairs in the logs;
football has no such column anywhere, so `leaderId` is assigned. That is [a club
is a sport and an id](CLAUDE.md) arriving with a different noun.

**Two kinds of number, and the page says which.** A counted record is recomputed
from `game` and cannot drift. A stated one is transcribed from Wikipedia and
cannot be rechecked. They are added and never reconciled, which is safe because
the eras do not overlap — and a test asserts that rather than a comment claiming
it. A career straddling 1999 is one row marked *part stated*.

**Regular season and postseason are separate columns**, because the sources
disagree about whether they are one. Retrosheet and nflverse count playoff games
inside W/L and Wikipedia does not: of 175 NFL tenures the two describe in common,
161 reconcile once the postseason is pulled out of the derived side. Bobby Cox is
2213–1774 in Retrosheet and 2149–1709 on Wikipedia, and the difference is exactly
his postseason.

### Getting the game logs to the database

Managers come from Retrosheet's `gl*.txt`, and there is a deadlock worth naming:
the container cannot reach a local directory, and on a deployment whose database
is not reachable from outside, a load run from the machine that *has* the files
cannot reach the database. Neither side can do the job alone.

So the logs are fetchable. Point `MLB_GAMELOGS_URL` at a base URL — one object
per file, which is how they already sit in a bucket — and the load pulls the
seasons the database actually holds, plus the four postseason files. It costs
160 requests and 228MB a load.

Two smaller shapes were measured and rejected: a concatenated `gl*.txt.gz` at
33MB, and a derived managers extract at **1.6MB** (471,214 rows, a 142:1
reduction — the same size as the eight-column `gameinfo.csv` slice, by
coincidence). Both were rejected because they add a step to repeat each year
when Retrosheet publishes, and a derived file that can silently fall behind its
source.

`MLB_GAMELOGS_DIR` still takes a local directory, and **either variable accepts
either form** — pointing `_DIR` at a URL is what a person tries first, and it
used to fail an `existsSync` check and report "no game logs at http://...",
which is true, useless, and indistinguishable from the variable being unset.

Fetching by name is the one thing a local directory does better. A glob cannot
miss a file; a list of names can, and did — `gldv.txt` was left out, the load
reported 132 files and no error, and 1,026 division-series attributions were
simply absent. 0.2%, invisible in any total, found by loading the same data
twice and comparing. `gameLogNames` is a pure function now, with a test that
pins all four rounds.

Missing logs are never fatal. The load reports the gap, loads every game, and
the leaders page says "No one on record."

### Who held the job, not who ran the game

Retrosheet names the manager of record for each game, which means it names the
bench coach who took over on an ejection. That is the truth about the game and
the wrong answer for a coaching record: Bobby Cox came out **2493–1998** against
a published 2504–2001, and the difference was Bobby Dews and Pat Corrales
covering games he was thrown out of.

So `game_leader` has two columns. `leader` is who held the job and is what every
number on the page counts; `ran` is who actually managed it, when that was
somebody else, and is NULL on all but 2,488 baseball rows.

**The fold is not a game count.** A stint is credited back only when one person
managed a game before it and after it *and* managed more of that season than the
stand-in did. A firing fails the first test at any length, so an interim who
took over always keeps their own row. The second test is what stops the rule
inverting: a manager's season is chopped into runs by every ejection, so Phil
Garner's 2006 Astros reads `Cooper(1) Garner(37) Cooper(1)` — adjacency alone
calls *Garner* the stand-in and hands his season to his own bench coach.

The length backstop was swept against twelve managers' published career records
rather than chosen, in total games of drift:

| 15 | 30 | 36 | 40 | **45** | 50 |
|---|---|---|---|---|---|
| 648 | 535 | 435 | 435 | **350** | 385 |

Fifteen is too small — Don Zimmer managed the first 36 games of 1999 while Joe
Torre was treated for cancer, and without them Torre is 21 wins short. Fifty is
too big — Bob Coleman managed 46 games of the 1943 Braves after Casey Stengel
was hit by a taxi, and every published record credits Coleman. The line sits
between a 36-game absence and a 46-game one.

With it, Cox, Torre, Sparky Anderson and Bruce Bochy all reproduce their
published career records **exactly**. Football folds nothing at all: nflverse
names the head coach of record for every game and never the assistant who stood
in, which is measured rather than assumed.

### What it does not cover, said here so nobody measures it twice

- **MLB 2026.** Retrosheet publishes game logs annually; the season being played
  is not in them. 2,058 final games have no manager and will get one.
- **The Negro Leagues.** `gameinfo.csv` includes them — about 8,220 games,
  concentrated in 1937–1949 — but Retrosheet publishes those as `.EBR` event
  files under `alldata/ngl_b`, not as game logs. No page is wrong, because none
  of those clubs is in any scope. Closing it means an EBR parser, not a wider
  glob.
- **Fifteen pre-1999 football tenures have no record at all.** The 1942–45 Bears
  had co-head coaches, and a handful of mid-season changes cannot be split by a
  season span. Their counts are blank *on purpose* and the page shows the coach
  with no numbers, which is the honest version of a table that would otherwise
  invent them.
- ~~**Pre-1933 NFL titles.**~~ **Closed** — see *Champions before there was a
  championship game* below. Lambeau's 1929, 1930 and 1931 now appear.
- **Connie Mack's first three seasons.** He managed Pittsburgh in 1894–96 and
  `gameinfo.csv` begins in 1897, so he is about 130 wins short of his published
  total. A coverage gap, not an attribution one.

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
| `MLB_GAMELOGS_URL` | base URL for Retrosheet's `gl*.txt` game logs, one object per file, for `npm run load mlb`. Signed automatically when `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` are set. |
| `MLB_GAMELOGS_DIR` | the same thing as a local directory, for a load running where the files are. Either variable accepts either form. |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_REGION` | credentials for a private bucket. Any host that is not GitHub is signed when these are set; an unsigned GET against a private bucket returns 403. |

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
