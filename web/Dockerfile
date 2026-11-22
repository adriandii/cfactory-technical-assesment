# syntax=docker/dockerfile:1

# Build: type-check and bundle the React app.
FROM node:24.19.0-alpine3.24 AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# Runtime: nginx serves the static files and proxies /api to the api service.
FROM nginx:1.30.7-alpine3.24
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
