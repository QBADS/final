# Cloud Run deployment image. Node 22+ required at runtime (node:sqlite -
# see src/store/db.ts); MIDDLEWARE_DB_PATH is set to :memory: in the Cloud
# Run deploy step, since a container's filesystem is ephemeral/non-shared
# across instances anyway - same tradeoff as local dev testing.
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
# Cloud Run injects PORT (default 8080) and requires binding 0.0.0.0 -
# server.ts's app.listen(config.port) already does this by default (no
# host argument = all interfaces), and config.ts already reads
# process.env.PORT, so no code change was needed for either requirement.
EXPOSE 8080
CMD ["node", "dist/server.js"]
