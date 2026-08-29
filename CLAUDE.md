# House rules

Twelve rules, so they get applied rather than rediscovered. Short on purpose.

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

This repo now has 73, over the pure parts — `splitCsvLine`, `renderNdjson`, both
`gameRow`s, `seedGameRow`, `isoDate`, `isScoringPlay`, `scoringRow`, `collapse`,
`seasonRange`, `coveredSeasons` — plus the seam itself and the two manifests.
They need no sources and run in about 140ms. The comparison against the two live
sites still stands behind them and is still the stronger check, but it needs
490MB of fetched sources and two sibling checkouts, so it cannot run in CI and
will not survive those repos being retired.

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

And the first mutation run was itself worthless: it invoked `node --test test/`,
which this Node resolves as a module path and refuses, so all 23 mutants were
"killed" by the runner erroring rather than by any test. It reported a perfect
score. **A mutation harness needs a control that the unmutated suite passes under
the exact command the harness uses** — otherwise it is one more check that passes
because it is not looking at anything.

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

`teams/<id>.js` is data: identity, vocabulary, and the rules where two sports
genuinely disagree. Adding a club is a file here and nothing else.

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

## The data has three tiers, and the split is the point

**Sources are fetched and never committed.** One nflverse play-by-play season is
95MB; the Retrosheet slice is 388MB. `data/sources/` is gitignored and exists
only while a build runs.

**Artifacts are derived and committed.** They are what a site reads. 490MB of
sources become 801KB, because rows nobody displays are dropped first — 728,867
baseball plays to 64,051 that scored, 49,492 league football plays to 238 for
one team — and only then is anything compressed.

**Reference data is curated and committed**, because for football nobody
publishes it. See `data/reference/nfl-franchises.csv`, and read its header before
trusting a date in it.

A build must be reproducible from sources and a checkout. If an artifact cannot
be rebuilt, it is not derived data, it is a source of record and belongs in the
third tier with a note saying where it came from — as the pre-1999 NFL results
do, since FiveThirtyEight no longer exists to re-serve them.

## Colour and theme

Nothing here renders yet. When it does: colour belongs in CSS custom properties,
never a literal in a component. The two sites carry **282 hardcoded hex literals
between them and not one variable**, and four brand values are the only real
difference between their palettes — the status colours are already identical.
That is the mistake this repo exists to not repeat, and a palette is team
vocabulary, so it belongs in a manifest.

## Dependencies default to none

Both sites run on Node's standard library and `node --test`. A new runtime
dependency needs a reason in the PR.

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

*This repo: no site yet. `scripts/fetch.mjs` pulls sources, `scripts/build.mjs`
derives artifacts, both sports are verified against the sites they came from —
1,534 of 1,534 football games and 9,067 of 9,067 baseball games, matching on
result and score — and `npm test` covers the pure parts in isolation. What is
missing is name resolution, the record core, and anything that serves a page.*

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
