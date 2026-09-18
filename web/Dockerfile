# Build context is the repository root (see docker-compose.yml) so this stage can also
# reach deploy/nginx.conf.
FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY web/package.json web/package-lock.json* ./
RUN npm install --no-audit --no-fund
COPY web/ .
RUN npm run build

FROM nginx:1.27-alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
HEALTHCHECK --interval=15s --timeout=5s --retries=5 CMD wget -qO- http://127.0.0.1:80 >/dev/null || exit 1
EXPOSE 80
