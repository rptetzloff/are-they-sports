# Container image for the dev server, for Coolify or a plain Docker host.
#
# Unlike the two sites, this repo has no Render blueprint to run alongside and
# no native dependencies — no @resvg/resvg-js, so the Alpine/musl problem that
# forced Debian slim there does not apply here yet. It stays on node:24-slim
# anyway, because the social-card renderer is coming and switching base images
# later is a worse day than paying ~40MB now.
FROM node:24-slim

WORKDIR /app
ENV NODE_ENV=production

# Which build this is, surfaced at /healthz.
#
# Coolify sets SOURCE_COMMIT itself and server.js reads that too; this arg is
# for a plain `docker build --build-arg BUILD_SHA=$(git rev-parse HEAD)`. When
# neither is set the server reports "unknown" rather than guessing.
#
# This exists because "is the code I merged actually running?" has been a real
# question three times: once when a merge left a commit behind on a work branch,
# and twice during rollouts where old and new containers both served for about
# twenty seconds and the same URL gave two different answers. Answering it by
# diffing response bodies is slow and, twice, I got it wrong.
ARG BUILD_SHA=""
ENV BUILD_SHA=$BUILD_SHA

# curl, purely so the *orchestrator's* health check can run.
#
# The HEALTHCHECK at the bottom of this file uses Node's own fetch and works —
# `docker inspect` reports healthy. But Coolify defines its own health check per
# application and that one overrides the image's, and it is generated as a curl
# command with a wget fallback. node:24-slim carries neither, nor nc, nor
# python3 — verified, not assumed:
#
#     docker run --rm <image> bash -lc 'command -v curl wget nc python3'
#
# So every Coolify health check against this image failed regardless of the path
# it was pointed at, while the site itself served fine. That is a bad failure to
# debug from the outside, because the symptom is "unhealthy" and the cause is a
# missing binary rather than anything the server did.
#
# Measured at 17MB on the image, 331MB to 348MB. The first draft of this comment
# guessed ~4MB, which is what apt reports for the curl package alone and not what
# lands once its dependencies are counted.
#
# The alternative is turning Coolify's health check off so the image's own is
# used. That works, and it also means the platform has no idea whether the app
# is up, so it is a worse 17MB saving than it looks.
#
# Point Coolify's health check at /healthz, NOT at / — see the note below.
RUN apt-get update \
	&& apt-get install -y --no-install-recommends curl \
	&& rm -rf /var/lib/apt/lists/*

# The deps stage this file said to add back the moment package.json gained a
# dependency. It has: `pg`, for the database that is now the source of record.
# That is the repo's first runtime dependency and the reason is in the PR, which
# is what the dependency rule asks for.
#
# Manifest and lockfile only, so this layer is rebuilt when dependencies change
# and not when a CSV does. `ci`, not `install`: it fails on a lockfile that
# disagrees with package.json rather than quietly resolving something new — the
# football site shipped a lockfile pinning vite and neither native package its
# social cards needed, and `npm install` hid it every deploy.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

# The scope this deployment serves. Required, and there is deliberately no
# default: a server that guesses would start, answer every route, and show the
# wrong clubs. Set it in Coolify.
#
#   SCOPE=team:packers            SCOPE=conference:nfl/nfc
#   SCOPE=division:nfl/nfc-north  SCOPE=sport:nfl
#   SCOPE=all
ENV SCOPE=""

# Pins the origin in absolute links. Without it any Host header becomes
# canonical, which is how a preview domain publishes itself as the real one.
ENV PUBLIC_ORIGIN=""

# Where the database lives. REQUIRED: games are read at request time, and the
# server exits rather than starting without it. A deployment is no longer
# self-contained — that is the cost of the reversal recorded in
# db/migrations/0001_initial.sql, taken deliberately.
#
# A database that is unreachable is a different case and is NOT fatal: the
# server starts, /healthz answers 503 naming the connection error, and every
# club route answers 503 rather than a wrong page. Config errors die, data gaps
# report. Both paths are tested.
ENV DATABASE_URL=""

# server.js reads PORT and falls back to 3000. Coolify sets what it expects.
EXPOSE 3000

# Optional. Unset, a scope that can serve at least one club is healthy, because
# building clubs one at a time is how this repo works today. Set to 1, every
# club in scope must be built or the container is unhealthy — which is what a
# deployment that actually promises a whole division wants.
ENV STRICT_SCOPE=""

# /healthz, not /. This matters more than it looks, and it applies to whatever
# path is configured in Coolify too.
#
# `/` answers 200 even when NOTHING in scope is built — measured: a container on
# SCOPE=conference:nfl/afc with no clubs built serves / as a selector listing
# sixteen unavailable clubs, with a 200, while /healthz answers 503. A health
# check pointed at / would call that deployment healthy.
#
# /healthz reports how many clubs in scope have artifacts and names the ones that
# do not; STRICT_SCOPE above decides whether a partial gap counts against health.
#
# Node's own fetch here rather than the curl installed above, so this check still
# works if that layer is ever dropped.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
	CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Not `npm start`: npm sits between the signal and the process, so a container
# stop waits out the full grace period instead of ending when the server does.
CMD ["node", "server.js"]
