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

# No `npm ci` stage. This repo has zero runtime dependencies — Node's standard
# library and nothing else — so there is no node_modules to build and a deps
# layer would copy a lockfile that installs nothing. Add the stage back the
# moment package.json gains a dependency; the two sites both carry one.
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

# server.js reads PORT and falls back to 3000. Coolify sets what it expects.
EXPOSE 3000

# Optional. Unset, a scope that can serve at least one club is healthy, because
# building clubs one at a time is how this repo works today. Set to 1, every
# club in scope must be built or the container is unhealthy — which is what a
# deployment that actually promises a whole division wants.
ENV STRICT_SCOPE=""

# /healthz, not /. It reports how many clubs in scope have artifacts and names
# the ones that do not, and STRICT_SCOPE above decides whether a gap counts
# against health. Node's own fetch; node:slim carries no curl.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
	CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Not `npm start`: npm sits between the signal and the process, so a container
# stop waits out the full grace period instead of ending when the server does.
CMD ["node", "server.js"]
