# are-they-sports

One codebase for team record sites, across leagues.

It grew out of two sites that answer a question about one club —
[arethepackersundefeated.com](https://arethepackersundefeated.com) and
[arethebrewersontv.com](https://arethebrewersontv.com) — which forked from each
other and drifted. Most of what they do is the same computation over different
vocabularies, so this is the version where a new team is a manifest rather than
a repository.

**Early. The data pipeline works, and a dev server answers in JSON; there is no
markup yet.**

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
npm run build packers                 # derive committed artifacts
npm test                              # no sources needed, ~190ms

SCOPE=team:packers npm run dev        # http://127.0.0.1:3000
```

### Container

```
docker build -t are-they-sports .
docker run -p 3000:3000 -e SCOPE=division:nfl/nfc-north are-they-sports
```

| variable | |
|---|---|
| `SCOPE` | **required.** No default: a server that guessed would start, answer every route, and show the wrong clubs. |
| `PUBLIC_ORIGIN` | pins the origin in absolute links. Without it any `Host` header becomes canonical, which is how a preview domain publishes itself as the real one. |
| `STRICT_SCOPE` | `1` makes any unbuilt club in scope unhealthy. Unset, serving at least one club is healthy, because building clubs one at a time is how this repo works today. |
| `PORT` | defaults to 3000. |

The healthcheck is `/healthz`, and it reports the gap between what the scope
promised and what is built.

`npm test` covers the pure parts — CSV parsing, both adapters' row functions,
the franchise table's collapse, season-range arguments — plus the seam itself:
one test asserts the two sports produce exactly the same row keys, and another
asserts the two manifests still disagree where they are supposed to. All 73 have
been mutation-tested, which is how the suite found a `seedGameRow` guard that
turned a half-recorded score into a tie.

## Layout

```
sports/     adapters: where data comes from, and how it becomes neutral rows
teams/      manifests: identity, vocabulary, and rules that genuinely differ
scripts/    fetch, build, franchise table
lib/        csv, scope, routes, index reading
server.js   dev server; serves JSON, no markup yet
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
