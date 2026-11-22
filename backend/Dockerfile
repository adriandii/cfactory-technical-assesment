# syntax=docker/dockerfile:1

# Build: install everything, compile TypeScript, then drop dev dependencies.
FROM node:24.19.0-alpine3.24 AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

# Runtime: one image for the api, worker and setup processes; docker-compose.yml picks the command.
FROM node:24.19.0-alpine3.24
ENV NODE_ENV=production \
    NODE_OPTIONS=--enable-source-maps
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY migrations ./migrations
USER node
EXPOSE 3000
CMD ["node", "dist/main/api.js"]
