# Wimpy Order — the Chatterbox lunch app as a container (Spec Kit 018).
#
# NO npm install: the Node server (src/server.mjs) has zero runtime dependencies. @vercel/functions is imported only by
# api/index.mjs, which is the Vercel entry and is not copied here (.dockerignore). NO secrets: every setting arrives as
# an environment variable at run time (docker-compose.yml reads .env — scripts/env.mjs assembles it). The image holds
# the code and the page, nothing else.
#
#   docker build -t chatterbox-wimpy .
#   docker run --rm -p 8080:8080 --env-file .env chatterbox-wimpy
FROM node:24-alpine

ENV NODE_ENV=production \
    PORT=8080

WORKDIR /app
COPY package.json ./
COPY src ./src
COPY public ./public

USER node
EXPOSE 8080

# /api/health answers with booleans only (no database call), so this is cheap and never leaks a setting.
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT:-8080}/api/health" >/dev/null || exit 1

CMD ["node", "src/server.mjs"]
