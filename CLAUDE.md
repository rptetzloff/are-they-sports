# House rules

Sixteen rules, so they get applied rather than rediscovered. Short on purpose.

(It said twelve, which was the count in the two sites this file came from and
was already wrong here before the scope rule was added. A number in a heading is
a claim like any other, and this one went stale exactly the way this file says
claims do: nothing failed, nothing rendered wrong, and it stayed wrong until
somebody counted.)

This is that shared repo. `AreThePackersUndefeated` and `AreTheBrewersOnTV`
each carry a near-identical copy of this file — 208 of 221 lines the same — from
when they were two codebases that had forked and drifted. The rules were the
part that should never have diverged, so they arrive here unchanged, with the
examples they were learned from.

The two sites still run. Until they stop, a rule fixed here should be fixed
there, and the drift this file exists to prevent applies to this file.

## Measure, don't assert

If a claim can be checked against the running thing, check it before writing it
down. The bugs that actually shipped here all read correctly in the source.

The records page rendered as one tall column at every viewport above 600px, on
both sites, for months. The grid rule was right. `body` is a column flexbox with
`align-items: center`, so a container carrying only a `max-width` is sized
shrink-to-fit, and an `auto-fit` track list resolves to exactly one repetition
against an indefinite inline size. None of that is visible in the stylesheet.
Rendering it at 1400px and looking is what found it.

That is cheap enough to be the default now: start the server on a spare port,
`chrome --headless --screenshot --window-size=1400,1600`, and look at the image.
Do it before and after, so the pair is evidence rather than hope.

Corollary: a test that reads the source proves the source, not the behaviour.
Keep both, and know which one you just wrote.

## Don't jump to conclusions

The failure mode here is not being wrong about hard things. It is taking a
plausible reading and stating it as established when the check was one command
away.

The precomputed indices were reported as loading in a 174MB heap. That number
came from loading them in isolation, where nothing else is on the heap; in the
server they blew past the 400MB cap and wanted about 600MB. Same code, different
question, and the wrong one had been answered.

The same pass claimed the copy line for a season with no losses was "genuinely
needed by the Brewers." It is unreachable on both sites. And the football site's
Tuesday-cron reasoning was borrowed wholesale to explain this site's data
cadence, which is refreshed by hand and whose workflow only validates.

So: **if a claim is checkable in one command, run the command before saying the
thing.** When it is not checkable, say which kind of claim it is.

**And when it is not checkable from here, ASK — do not caveat and ship.** Added
after the data credit, at the reviewer's request: "I mean, you can ask
questions." Retrosheet's required attribution notice was reproduced from memory,
marked in a comment as not checked against anything in the repository, and
committed into a footer whose only job is to satisfy that requirement. It was
wrong — it gave a postal address their current terms no longer carry. Two more
licence claims in the same change were wrong the same way: nflverse is CC BY 4.0
rather than vaguely "asking to be cited", and FiveThirtyEight is MIT rather than
Creative Commons.

A disclaimer moves the work to the reader without giving anyone the chance to
answer cheaply. Asking took one message. Reading the two LICENSE files took two
fetches. Both were available the entire time the caveat was being written.

Never pipe a command whose exit code matters. `set -o pipefail`, or do not pipe.
That rule was already written down in a sibling repo and then broken here in the
same week, by piping a test run through `tail` and reading the pipe's status.

## Comments explain why, never what

When a value was chosen by measurement, record the number **and** the rejected
alternative.

A comment must never assert an outcome the code cannot produce. `.records-grid`
carried this for months:

> The container caps at 900px (836px inner), so this always yields one or two
> comfortable columns.

It yielded one. The 836px was never reached, because nothing gave the container
a definite width. That comment was worse than no comment: it answered the
question a reader would otherwise have gone and checked.

## Reversals stay visible

When a decision is overturned, mark the old one and say what changed. Do not
quietly edit it away. This repo already carries two: the MLB adapter's comment
records the stateful-detection argument it made up before reading the file, and
`scripts/franchises.mjs` records that its first draft emitted "Arizona Cardinals,
1921" when they were the Chicago Cardinals. A document that only ever agreed with
itself is not evidence of anything.

## State the limit of the claim

Say what a thing does *not* do, in the same breath. The artifact loader's
comment now reads "measuring that load in isolation suggested it was fine; it is
not, because in isolation nothing else is on the heap." The wrong number stays,
with the reason it was wrong, because the next person will be tempted to measure
it exactly the same way.

## Tests assert rules, and fail on the old code

Verify a new test fails before the fix, by reverting. A test that never failed
has proved nothing, and this pair of repos has shipped several that could not:

- A sort test using `0001`, `0002`, `0010`. Zero-padding makes lexical order and
  numeric order identical, so it passed under the bug it was written for. It had
  to become 9999 versus 10000 before it could fail.
- A test asserting `'2 clashs'` — the expectation contorted to match a
  pluralisation bug instead of the bug being fixed.

Green suites prove only what they cover. 118 tests passed on the football site
while every past season rendered a 0-0 record and a schedule of 0-0 ties,
because its `main.js` fetches its own CSV in the browser and `lib/seasons.js`
reads the file at import and calls ESPN. Neither is reachable from `node --test`.
Know which files your suite cannot see, and say so out loud.

This repo now has 656, over the pure parts — `splitCsvLine`, `renderNdjson`, both
`gameRow`s, `seedGameRow`, `isoDate`, `isScoringPlay`, `scoringRow`, `collapse`,
`seasonRange`, `coveredSeasons`, both `leaderRows` — plus the seam itself and the
two manifests. They need no sources and run in about 140ms. The comparison
against the two live sites still stands behind them and is still the stronger
check, but it needs 490MB of fetched sources and two sibling checkouts, so it
cannot run in CI and will not survive those repos being retired.

(It said 73, which was true when it was written and had been wrong for months.
A count in prose is a claim like any other and goes stale in exactly the way the
top of this file describes: nothing failed and nobody was told. Counted with
`npm test`, not remembered — and it will be wrong again, so count it.)

**Every one of them was mutation-tested: 25 deliberate breaks, 25 caught.** That
is the only reason to believe any of it, and the run paid for itself twice over.
Once by finding a real bug: `seedGameRow` guarded `score1` and never looked at
`score2`, so a row with one score parsed the other to NaN, every comparison
against NaN is false, and the ternary fell through — a 34-to-nothing game came
out as a TIE. Once by finding a NUL byte inside a template literal in
`scripts/franchises.mjs`, where `${code} ${name}` was really `${code}\0${name}`.
That one produced correct output, which is why nothing had caught it; what it
cost was that `grep` and `git diff` both treat a file containing a NUL as binary
and refuse to show it. The mutation run surfaced it by failing to find a line it
had just been shown.

The leaders page added 12 more breaks, 12 caught — and three of those "survived"
on the first run because the HARNESS was wrong, not the tests. One mutated a
manager's id offset while leaving the name offset alone, so the right name still
came back. One patched `class="record-card league-wide"`, which appears four
times in `lib/render.js`, and `String.replace` took the first — mutating a
different page than the test was watching. **A surviving mutant is a claim about
the test that needs checking too**, and two of these three were the harness
lying in the opposite direction from the usual one.

The third was real and stayed: breaking the `(none)` check in `sports/mlb.js`
changed no test result, because every `(none)` in Retrosheet also has an empty
id and the empty-id guard fires first. That is the unreachable-defence problem
this file already records from the route tie-break. It is kept rather than
deleted, with a test that reaches it directly, because the two guards say
different things — one that a field is missing, one that it was filled in with a
word meaning nobody.

And the first mutation run was itself worthless: it invoked `node --test test/`,
which this Node resolves as a module path and refuses, so all 23 mutants were
"killed" by the runner erroring rather than by any test. It reported a perfect
score. **A mutation harness needs a control that the unmutated suite passes under
the exact command the harness uses** — otherwise it is one more check that passes
because it is not looking at anything.

**Run the suite against an empty database as well as a loaded one.** They catch
different defects and both kinds have shipped here. Three assertions passed only
against an empty database — written when the tables held nothing but the fixture,
they became claims about the whole league once real data arrived, and one counted
9,208 baseball games because it had no `sport` in its WHERE. Then a test written
in the commit that fixed those three passed only against a LOADED one, inserting
an `mlb` franchise without creating the `mlb` sport. CI runs empty and a
developer runs loaded, so each of them is blind to exactly one of these. A test
resting on state it did not create is the same defect either way.

Two layers, on purpose. Unit tests build their own rows and pin exact numbers.
Tests against the real data assert relations and floors — ordered, distinct, at
least this many — and never snapshots, because the data is refreshed and a
snapshot fails for reasons that are not defects.

**An invariant claimed in a commit message is not an invariant.** The rename that
introduced neutral row keys announced that "one function owns the CSV's own
names." That was false as written: fourteen consumers still read
`g['Packers Win']` and `g.packers_score`, each silently yielding `undefined`
rather than throwing. If a property is worth asserting in prose, write the test
that fails when it stops being true.

## Derived data stays derived

If it can be rebuilt from sources, rebuild it; never store it and hand-edit.
Committed is fine — see the tiers below — but a committed artifact is output,
and editing one makes the next build silently disagree with it.

Round-tripping is where derivations break, and the break is quiet. The baseball
site once tagged only the top level of its indices; three of thirteen are Maps
of Maps, so the server booted cleanly, logged success, served every page, and
threw on every box score. Four of thirteen had been spot-checked. Diffing
artifact output against source output is what found it — check every one, or
check none and say which you did.

## The sport is an adapter, the team is a manifest, and neither is code

Three places, and putting something in the wrong one is how this becomes two
codebases again.

`sports/<id>.js` says where data comes from and turns it into the neutral row
shape. That shape — `result`, `scoreFor`, `scoreAgainst`, a `championship`
field, no mention of any club — is the whole seam. Everything downstream reads
it without learning which league it is looking at.

`teams/<id>.js` is data: identity, colours, and whatever this club overrides.
Adding a club is a file here and nothing else, and that file is about a dozen
lines.

**Vocabulary and rules belong to the sport, not the club** — a narrowing of what
this rule used to say, which was that they lived in the team manifest. Measured:
of the eleven nouns and three rules, only `team`, `fullName`, `colors` and
`copy.seasonNotStarted` are facts about a club. "Points", "Super Bowl", "coach",
"meetings" and every rule are facts about football, and copying them into
thirty-two files is how these repos got here in the first place. `sports/<id>.js`
carries `defaults`; `lib/manifest.js` merges and validates.

Narrowed once more when the other twenty-eight NFL clubs were added.
`copy.seasonNotStarted` was on that list of four and is off it: it is the one
club field a sport can derive a usable value for, by naming the club. Requiring
it meant twenty-eight manifests each needed a chant, and there is no source for
those — writing them would have been remembering, which is how the MLB colours
went wrong. A club with nothing declared now gets `GO PACKERS`, which is weaker
than `GO PACK GO` and is not wrong; the four clubs that have a real one still
say it. `colors` had already left the list, to the franchise-history table.

Every field stays overridable, because the moment one is not, some club needs
it: `losslessSeasonNoun` is a sport default today and becomes "perfect" the day
anyone builds the 1972 Dolphins.

Resolution validates, and it throws at boot with the field named. The failure it
prevents is the word "undefined" rendering into a sentence — no throw, no failing
test, no broken build, and the only signal is somebody reading the page.

Anything that has to branch in code rather than resolve from a manifest is a
sign the seam is in the wrong place.

The trap is assuming one sport's sentence becomes another's by swapping a word:

- `meetingPlural` exists because "clash" plus "s" is "clashs".
- `scoreForLabel` exists because "Points For" and "Runs Scored" are not one
  phrase with a different noun — the verb changes too.
- `losslessSeasonNoun` exists because in football *perfect* means no losses and
  no ties. 1929 went 12–0–1: undefeated, not perfect.

Where the sports genuinely disagree, declare it and test the declaration.
`streaksSpanSeasons` is the live example: streaks end at the season boundary in
baseball and span them in football, where the longest — 15 games — crossed from
December 2010 into December 2011. Merging those implementations without noticing
would silently rewrite one record book.

**Do not invent a difference. Go and read the working implementation.** The MLB
adapter shipped with a stateful scoring-play detector and a seam argument built
on it, because the column names were guessed rather than read. Retrosheet has a
`runs` column; the test is `runs > 0`, pure and identical in shape to football's,
and the baseball site's own collector had been reading it for years three
directories away.

## A club is a sport and an id, never an id

Six times now the same bug: something keyed, cached, looked up or chosen without
the sport, when the sport is what tells two clubs apart. Every one was silent,
and most produced a plausible wrong answer rather than an error.

- `codeIndex` keyed on the code alone, so an `all` scope listed 60 clubs
  instead of 62 — the Twins and the Tigers deduplicated away into the Vikings
  and the Lions.
- `resolveScope`'s dedupe keyed on the club id, so the second Cardinals and the
  second Giants vanished. 62 loaded, 60 resolved.
- The server found clubs with `teams.find((t) => t.id === e.teamId)`, and
  `teams/mlb` sorts first, so the NFL Giants resolved to the baseball Giants and
  went unavailable.
- The game cache keyed on the franchise code, and the same-city pairs share
  one — the MLB Orioles were served the Ravens' rows and showed 276-208-1 since
  1996 in a record book starting in 1901.
- A page covering two sports took one name resolver, from the first club in
  scope, so the baseball schedule read "Lansing Oldsmobiles", "Cincinnati
  Bengals", "Milwaukee Badgers". Every one a real football club that really used
  that code.
- `computeLeague` and `computeSchedule` built a code-to-club map across whatever
  they were handed, and merged an NFL game and an MLB game into one fixture.

The rule: **anything that identifies a club carries the sport with it.** A bare
code, a bare id or a bare franchise is a bug waiting for a second sport, and
there are four more sports of data sitting in `data/sources/sportsdata`.

Where a function cannot carry it, it refuses: `computeLeague` and
`computeSchedule` throw on clubs from two sports rather than producing something
that looks right. A configuration error, not a data gap — no build fixes it.

## The scope is data too, and so is what it cannot serve

One deployment shows a set of clubs, named by a single `SCOPE`: a club, a
division, a conference, a league, or everything. The only branch anywhere is
whether the resolved set has one club — one club serves the root and has no
selector, and a single-club deployment keeps an **empty** URL prefix so that
`arethepackersundefeated.com/records/...` survives the cutover unchanged.

A division means **today's clubs, each with its whole history**, and that is a
decision rather than an approximation. The NL Central carries the Brewers'
American League seasons. Say so where someone might "fix" it.

**Report the gap, never close it silently.** A club in scope with no manifest,
or a manifest with no build, stays in the resolved list marked unavailable — so
the boot log names it, `/healthz` counts it, and its own URL returns 503 saying
which command is missing. Filtering it out would produce a site that promised
sixteen clubs, showed two, and looked complete. That is the same failure this
file keeps describing, and this is the version of it that would ship.

Configuration errors and data gaps are different. A misspelled scope cannot be
fixed by running a build, so it exits; an unbuilt club can, so it serves and
reports unhealthy. The first version exited for both, which made the 503 branch
unreachable and turned a readable list of missing clubs into a crash loop.

## The data has three tiers, and the split is the point

**Sources are fetched and never committed.** One nflverse play-by-play season is
95MB; the Retrosheet slice is 388MB. `data/sources/` is gitignored and exists
only while a build runs.

**Artifacts are derived and committed.** They *were* what a site reads; the
server now reads games from the database instead, and `scripts/build.mjs` still
produces them. Keeping two representations of the same data is exactly the drift
this file warns about, so the next decision is whether they stay — they earned
their keep once more by being what the database load was verified against, club
by club. 490MB of
sources become 801KB, because rows nobody displays are dropped first — 728,867
baseball plays to 64,051 that scored, 49,492 league football plays to 238 for
one team — and only then is anything compressed.

**Those scoring plays go into the artifacts and NOWHERE ELSE.** `scoring_play`
has existed since the first migration and holds zero rows in both sports;
`scripts/load.mjs` does not mention the table. The only thing that calls
`scoringRow` is `build.mjs`, writing NDJSON the server no longer reads.

That is the drift this section warns about, arriving as an absence rather than a
disagreement: a table nothing writes reads as data waiting to be displayed, and
this file said box scores were "left" as though the work were a page. Counted
rather than remembered — `SELECT count(*) FROM scoring_play` is zero against
225,725 final baseball games and 18,234 football ones.

**Reference data is curated and committed**, because for football nobody
publishes it. `data/reference/nfl-franchise-history.csv` is the worked example:
264 hand-curated rows giving every franchise, code, era, name and colour, which
is what Retrosheet gives baseball for free.

`data/reference/nfl-champions.csv` is the third, and it exists because a
derivation ran out of era. The database found champions by finding championship
GAMES, which works from 1933 and cannot work before it: twelve NFL seasons were
decided on the final standings and one by a tie-breaking playoff, so there was no
game whose winner is the champion. Curly Lambeau showed three titles where he won
six and nothing in the data was wrong — the question simply had no answer where
the answer was not a game.

51 of its 64 rows COULD be derived and are kept anyway, which is the interesting
half. The load marks a champion by taking the last playoff game of a league in a
season, and that rule had never been checked against anything at all. These check
it, 52 agree, and the check paid for itself before it was committed: three codes
in the supplied file were wrong and **every one of them resolved**. CRA is the
Chicago Rockets, NYY the NFL New York Bulldogs, BDA the Brooklyn Dodgers — real
clubs, wrong ones, which is the failure mode the rule below is named after. A
curated row that merely confirms a derivation is not a duplicate; it is the only
reason to believe the derivation.

`data/reference/nfl-coaches.csv` is the second, and the same sentence describes
it: 382 rows of head coaches from 1920 to 1998, which is what Retrosheet's game
logs give baseball back to 1871. Curate only the era that has no source — the
first draft of this one nearly transcribed all 177 modern coaches too, to say
what `schedules.csv` already says.

It carries its own confidence, per row, because it was built three ways. 341
tenures are **transcribed** from Wikipedia and cannot be rechecked here. 27 are
**counted** from games, over seasons no other tenure at that club claims —
strictly better than the transcribed ones, and used where Wikipedia's table did
not parse. 15 are **unresolved**: co-head coaches and mid-season changes a
season span cannot split, left blank on purpose so the page shows a coach with
no record instead of a plausible wrong one. A curated file that could not say
which of its numbers were which would be a worse artifact than any of the three.

**A row is an era; a column is a spelling.** `franchiseAbbrv` joins a club's
eras together, `teamAbbrv` names one era, and any further `<provider>Abbrv` —
`nflverseAbbrv` is WAS where ours is WSH — is what some other source calls that
same era. Adding a provider is a column, and `lib/codes.js` reads every column
ending in `Abbrv` without being told the new one exists.

It was five extra ROWS first, one per code nflverse spells differently, each
duplicating a club's name, city and colours so the second code would resolve.
That put the Rams' palette in the file twice where it could drift, let an era
row and its alias row disagree about which years they covered, and made the
file 269 rows while this document, the README and `lib/names.js` all said 264.
Nothing failed; three documents were simply wrong for as long as the workaround
lasted.

Both sports use these names now. Baseball's used to be different and
misleading — `teamName` was the CODE and `team` the nickname — and the first
version of `lib/codes.js`, written against football's columns, therefore built
an **empty** MLB table: every row skipped, no error raised. An empty table
resolves every code to itself, which is exactly what the repo did before that
file existed, so nothing broke and nothing said so. Renaming the columns is
what let one rule read both sports.

It replaced a generated table whose dates were explicitly *not* eras and a
hand-written list of current names. Both were honest about their limits and both
were workarounds for a file that did not exist yet. When the real thing arrives,
delete the workaround rather than keeping it alongside — two sources for one fact
is the drift this file keeps warning about.

A build must be reproducible from sources and a checkout. If an artifact cannot
be rebuilt, it is not derived data, it is a source of record and belongs in the
third tier with a note saying where it came from — as the pre-1999 NFL results
do, since FiveThirtyEight no longer exists to re-serve them.

**Reversed, in part, for the database.** A row captured from a live feed the
moment a game ends — before nflverse's weekly refresh publishes it — is not
reproducible by definition, and `db/schema.sql` accepts that. The reason is that
with per-club artifacts, recording one finished game means rebuilding a club's
whole index, which is exactly why the two sites carry their worst code: there is
nowhere to write a single result.

But "the database is a source of record" was too blunt as first stated and is
not what got built. **Provenance is per row.** Every row names its source, and
`source.reproducible` says whether it could be rebuilt. So the architectural
claim is a query:

```sql
SELECT count(*) FROM game g JOIN source s ON g.source = s.id
 WHERE NOT s.reproducible;
```

Zero means the whole database can be thrown away and rebuilt. It returns to zero
on its own, because an authoritative source supersedes a live capture as soon as
it publishes — which is the property that keeps this from drifting into an
unbackupable pile.

## Colour and theme

Colour belongs in CSS custom properties, never a literal in a component. The two
sites carry **282 hardcoded hex literals between them and not one variable**.

Measured before porting: the brand values are the only real difference between
their palettes, and the status colours had independently converged — a win is
`#4caf50` on both. So `colors` is team vocabulary and lives in the manifest,
while `--win` and `--loss` live in the renderer. `lib/render.js` writes `:root`
once, and a test asserts that **no colour literal appears anywhere after that
block**, which is the check that would have caught the sites.

## Dependencies default to none

Both sites run on Node's standard library and `node --test`. A new runtime
dependency needs a reason in the PR.

**Client-side JavaScript: a decision made when sortable tables were built, not
a rule this project already had.**

The measured fact is that there was none — zero script tags, zero handlers, and
the standings modal is a CSS `:target` on an anchor. What did NOT exist was any
statement that this was intended. Sortable tables were then built as header
links with a `?sort=` parameter, and the change described that as "the design"
and wrote this paragraph as though the repo had long since rejected browser
JavaScript. It had not. An absence was read as a principle, the principle was
attributed to the project, and it arrived here in the same commit that invented
it.

That is the failure at the top of this file — a plausible reading stated as
established — committed into the file that exists to prevent it, which is worse
than making it in code. **A rule enters this document when somebody decides it,
and the entry says who and when.** Inferring one from what the codebase happens
not to contain is how a habit becomes a constraint nobody chose.

The decision itself stands, on its own reasoning rather than on precedent:
rendering that happens in the browser is not reachable from `node --test`, which
is how 118 tests passed while every past season rendered a 0-0 record. Sorting
on the server costs a round trip per click and buys an order that is a pure
function of the request, assertable by a test, and working with scripts off. It
is a default worth keeping and worth arguing with, not a law — and the next
feature that genuinely needs a script should say so and add one.

This repo now has exactly one, `pg`, because reads happen against Postgres at
request time and Node ships no Postgres client. `node:sqlite` *is* built in and
was measured as the alternative — every NFL game ever is 18,506 rows and 2.91MB
— but a file-per-container means a poller per container, all fetching the same
live data, which defeats one codebase serving many deployments.

The lockfile is part of that. The football site's `package-lock.json` locked
`vite` and nothing else, while `package.json` had declared `@resvg/resvg-js` and
`opentype.js` all along. Render's `npm install` resolved them fresh, so nothing
broke and nothing was pinned either. After any install, confirm the lockfile
actually contains what the manifest declares.

## Docs are part of the change, not a follow-up

Every change updates the documents it made wrong: `README.md`, this file, and the
header comments that describe the thing being changed. A claim written when it
was true does not announce that it stopped being true — no test fails, no build
breaks, no page renders wrong.

The header comments in `scripts/` and `sports/` carry the measured numbers and
the reasoning. They are the documentation, and they go stale the same way prose
does — the "stateful scoring detection" comment was wrong for exactly as long as
the code under it was.

## `main` means feature parity, and nothing less

**A release is when this repo can replace the two sites, not when a slice of it
works.** Until then `dev` is what deploys and `main` sits where it is. That is a
decision, not an oversight, and it is why `main` is currently eight commits and
several months of work behind.

The bar, inventoried from the two sites rather than remembered:

*Routes both sites have.* `/`, `/{season}`, `/records`, `/history`, `/vs`, the
leaders page (`/coaches` on one, `/managers` on the other), `/robots.txt`, and
six social-card routes — `/og/default.png`, `/og/history.png`, `/og/{leaders}.png`,
`/og/records/{slug}`, `/og/vs/{opponent}`, `/og/{season}`.

*Front-page panels both sites have.* The answer, the record, the schedule grid,
a season selector with first/prev/next, the streak banner and its details, the
on-this-day panel and its details, last lossless season, a history sparkline,
last-updated, a data credit, share buttons, and a photo gallery with a lightbox.

*Baseball-only, and its whole reason for existing.* `/game/{id}` box scores with
a linescore modal, standings, and the TV-listings feature — watch modal, channel
list, provider picker. None of that is historical data; it needs a live source.

Standings are done, and turned out not to need one. The site fetches ESPN's
standings endpoint because it has no games to count; this repo has every game
either club ever played, so the same table falls out of a query and works for
1962 as well as today. The live source it does need is the one already
built — the server's own refresh timer — which is what keeps the season being
played current.

A curated file needs a check that can fail, and the standings era nearly did not
get one. Those twelve rows are the only ones no game can confirm, and a mutation
run proved nothing was looking: changing the 1929 champion from Green Bay to the
Bears changed no test result. The check that works is the definition itself —
the title was awarded ON the standings, so the champion should top its league —
and nine of twelve do, with the other three documented in their own notes and the
test requiring the note. An exception with a reason attached is a record; an
exception with nothing attached is a hole.

*What this repo has today*, checked by rendering `/2011` under
`SCOPE=team:nfl/packers` rather than remembered: the answer, the record, a club
selector, a season selector, the schedule grid, the streak banner, the history
sparkline and last-updated; `/records`, `/history`, `/vs`, `/schedule`,
`/standings`, the leaders page and `/champions`, each also per sport and as JSON,
with sortable tables, a data credit and the on-this-day panel. What is left is
the six social cards, share buttons, the photo gallery, box scores and TV
listings.

Two of those are much bigger than the list makes them look, and the list is what
somebody will plan from.

**Box scores are not a page over data that is already here.** `scoring_play` is
empty and unwired, so it is three jobs: fetch the play-by-play again (95MB per
football season, 388MB for the Retrosheet slice, both discarded after every
build), add a loader path that writes the table the way games are written, and
only then render. The fetch has the same reachability problem baseball's game
logs had — a container can pull nflverse, and the Retrosheet play-by-play is a
file one person has.

**The on-this-day panel was the cheap one, and is done.** It was cheap for the
reason box scores are not: it needed only games, which are loaded, and
`rules.onThisDayWindowDays` was already declared per sport — exact for baseball,
three days either side for football, because a seventeen-game season has empty
calendar dates by the hundred. Declared with the other rules and read by nothing
until now, which is what a seam is for: the panel never learns which sport it is
drawing, and the heading changes from "On this date" to "Around this date"
because the window did, not because anything branched.

The leaders page was *linked* the whole time, from every club page, answering
404 — the reverse of the reachability failure this file already records, and
invisible for the same reason: the test asks whether every route is linked, never
whether every link is a route. It asks both now.

**And the reason it was missing was two-thirds wrong.** This file said it "needs
a curated coaches/managers table nobody publishes" for as long as the page
404'd. Measured, that claim survives for exactly one era of one sport:

- Retrosheet's game logs name both managers of every baseball game back to 1871.
  217,906 of 225,713 final games, 96.5%. Nothing to curate.
- nflverse's `schedules.csv` — the file `scripts/fetch.mjs` has been pulling all
  along — has `home_coach` and `away_coach`, populated on 7,548 of 7,548 rows.
- Football before 1999 has no per-game source anywhere, and FiveThirtyEight's
  file is two clubs, two Elo ratings and two scores. That one needed the curated
  tier, and got `data/reference/nfl-coaches.csv`.

Two of the three were sitting in files this repo already had. The claim was
never checked because nothing depended on it being true, which is the failure
mode the top of this file describes, arriving as a reason not to build something.

The identity rule below arrived again with it. nflverse writes `Jim Mora` for
Indianapolis in 1999 and Atlanta in 2004, and those are a father and a son —
so a leader is an id, never a name, and the curated file exists as much for that
as for the records. Retrosheet gives baseball a manager id for free, unique
across all 1,490 (id, name) pairs; football has no such column anywhere.

Reversed once during the build, and worth keeping because the wrong version
passed every check: the manager fields were read at Retrosheet offsets 78-81,
the load ran clean, and 427,433 attributions went in naming **umpires**. Fields
78-89 are six umpire slots. What made it convincing is that it was verified
against one row from 1871, which had a single umpire and five empty slots — the
one era where the wrong offsets and the right ones coincide.

Reversed a second time over what a leaders page is even asking. Retrosheet names
who RAN each game, so an ejection puts the bench coach in the record and Bobby
Cox came out 2493-1998 against a published 2504-2001. A coaching record is a
tenure, so `game_leader` now carries `leader` (who held the job) and `ran` (who
managed it, when that was somebody else).

The rule for folding one into the other is the interesting part, because the
obvious version is wrong in a way that gets WORSE as you loosen it. Comparing
adjacent runs of games — a run bracketed by two runs of the same other person is
a fill-in — is true of a fill-in and equally true of the manager, because every
ejection chops his season into runs. Phil Garner's 2006 Astros read
`Cooper(1) Garner(37) Cooper(1)`, so adjacency alone calls Garner the stand-in
and hands his season to his own bench coach. It only stays safe while the
threshold is small enough to hide the problem.

Adding "and the person on both sides managed MORE of that season" fixes it, and
that is the whole rule. A firing fails it at any length.

**The threshold was swept, not chosen**, against twelve managers' published
career records — 648 games of drift at 15, 435 at 36, 350 at 45, 385 at 50. It
sits at 45 because 15 misses Don Zimmer's 36 games covering Joe Torre's cancer
treatment in 1999, and 50 swallows Bob Coleman's 46 games covering Casey Stengel
after a taxi hit him in 1943, which every published record credits to Coleman.
The window between a 36-game absence and a 46-game one is the entire margin, and
recording the sweep is worth more than recording the number.

The credit line WAS in that list, and is done. It got there because writing this
paragraph from memory put it in the other one, and grepping the rendered page is
what found it.

It turned out not to be a nicety. Most of those sources ask for attribution and
**Retrosheet requires it**, so rendering none was a licence term going unmet for
as long as baseball had been loaded — not a missing panel. Credits are declared
in `sports/<id>.js` beside the sources they describe, merged for the sports in
scope, and a required notice is reproduced in full rather than folded into a row
of links: shortening it would be crediting the source without meeting the
condition, which is the version of this that looks done and is not.

A deployment credits only what it uses. A football-only site naming Retrosheet
would be asserting a relationship it does not have, and a reader cannot tell that
from carelessness.

Two of these are genuinely hard rather than merely long. The social cards need
`@resvg/resvg-js`, which is the one native dependency either site carries and the
reason the image is Debian rather than Alpine. And TV listings are live data with
no historical equivalent, so the fetch/build/artifact split those three tiers
describe does not obviously apply to them.

Parity also has to survive the seam: the leaders page is `/coaches` or
`/managers` depending on the sport, and TV listings exist for one club and not
the other. Those are manifest and adapter questions, not `if` statements.

The leaders page is the worked example now. `nouns.leaderPlural` names the route
and every heading, `lib/leaders.js` counts without knowing which league it is
looking at, and each adapter turns its own source shape — Retrosheet's
positional game logs, nflverse's two columns — into one neutral row. It is also
the first route whose NAME comes from the sport, which broke something
immediately: `test/reachable.test.js` parsed paths without saying which club it
held, so the page was routable in the server and a 404 in the test. Anything
that resolves a route now has to carry the club, which is the rule below
arriving through a test helper.

## Commits and branches

A subject line stating what the change makes true — no conventional-commit
prefixes, no ticket refs. The body runs as long as the reasoning needs,
including what was measured and what was rejected. Do not claim an invariant
there that a test could assert instead.

### Work branches into `dev`. `dev` goes into `main`.

Work happens on a branch off `dev` and PRs into `dev`, and that branch is deleted
on merge. Releases are a PR from `dev` into `main`. **`dev` and `main` are
permanent and are never deleted.**

**Merge commits, never squash.** `dev` was once squashed into `main` and then
recreated. The local branch kept the pre-squash commits while the remote had the
squashed one, and the two looked like unrelated work. The residue was 220 commits
that `main` carried and `dev` did not, so every release PR afterwards computed
its diff against a base missing most of `main`'s history.

**Check whether the PR is already merged before committing to its branch.**
Three times now, a work branch has been merged and a commit made afterwards has
pushed cleanly to it. Nothing fails: the push succeeds, CI runs green, and the
work is simply not in `dev`. The third one was the fix for a load that was
crashing on the server, and it was found only because someone asked whether a
merge was still needed.

The trap is that this is not a mistake about git. It is treating "I opened this
PR, so it is open" as a standing fact, when it is a thing that changes without
the person pushing doing anything — which is the same shape as every other bug
in this file. `gh pr view <n> --json state` is one command.

`.githooks/pre-push` now refuses it, and `git config core.hooksPath .githooks`
turns that on in a fresh checkout. It fails open when `gh` is missing or
offline, because a guard that blocks work when the network is down gets
disabled within a day. So it is a backstop, not the rule.

**Branch from `dev`, not from another work branch.** A stacked PR was merged 21
seconds after its own base, before GitHub retargeted it, and landed on the wrong
branch.

**Back-merge `main` into `dev` after each release.** Every release leaves `main`
one merge commit that `dev` never sees, and that is what accumulated into the
220. The merge is a no-op on the tree and takes one command.

## Files

Extract when a file stops being readable, not at a line count.

The two sites are the cautionary tale: `main.js` is 1,355 lines there and 3,004
there, both the least-tested file in their repo, and both of this year's
production bugs came out of them. Nothing here is close to that yet, which is
the point at which it is cheap to keep it that way.


---

*This repo: `scripts/fetch.mjs` pulls sources, `scripts/build.mjs` derives
artifacts, both sports are verified against the sites they came from — 1,534 of
1,534 football games and 9,067 of 9,067 baseball games, matching on result and
score — and `server.js` renders a club page and a selector under a configured
scope, with `?format=json` on every route. `npm test` covers all of it in
isolation, mutation-tested. What is missing is name resolution, the records and
head-to-head views, and the social-card renderer.*

*Branching is work branch → `dev` → `main`, the same as the two sites, from
before there is anything deployed to protect. The earlier version of this
paragraph said `main` only was fine until then; the reason to start now is that
every serious git problem those repos had came from branch discipline, and the
habit is cheaper to start than to retrofit. `main` is a known-good state even
when nothing reads it.*

*Everything the sites' rule says applies here: merge commits and never squash,
branch from `dev` rather than another work branch, delete work branches on
merge, never delete `dev` or `main`, and back-merge `main` into `dev` after each
release so the next diff is clean.*
