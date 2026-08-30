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

## A scope covering two sports shows two leagues

`/records` and `/schedule` render **one block per sport**, never merged. A
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

`/records` and `/schedule` are linked from the club selector at the root, from
each other, and from every club page's site nav — under a multi-club scope only,
because under `SCOPE=team:packers` those routes do not exist and linking to them
would be worse than not having them.

Worth saying because the first version had none of that. Both pages answered
200, every route test passed, and nothing anywhere pointed at them: a working
page nobody can reach. No test noticed, because every test already knew the URL.
`test/reachable.test.js` is the one that asks the other question.

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
