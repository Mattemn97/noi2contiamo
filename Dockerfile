# syntax=docker/dockerfile:1

# 1) Build del frontend in modalità http
FROM node:24-slim AS web
WORKDIR /src
COPY package.json package-lock.json tsconfig.base.json tsconfig.json ./
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/
COPY packages/data/package.json packages/data/
RUN npm ci
COPY apps apps
COPY packages packages
ENV VITE_BACKEND=http
RUN npm run build

# 2) Runtime Python con il frontend già compilato
FROM python:3.13-slim AS runtime
COPY --from=ghcr.io/astral-sh/uv:0.13 /uv /usr/local/bin/uv
WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/app/.venv \
    PATH="/app/.venv/bin:$PATH"
COPY server/pyproject.toml server/uv.lock server/
RUN cd server && uv sync --frozen --no-dev --no-install-project
COPY server server
RUN cd server && uv sync --frozen --no-dev
COPY --from=web /src/apps/web/dist /app/static

ENV N2C_ENV=production \
    N2C_STATIC_DIR=/app/static \
    N2C_DATABASE_URL=sqlite:////data/noi2contiamo.db \
    N2C_HOST=0.0.0.0 \
    N2C_PORT=8000
VOLUME ["/data"]
EXPOSE 8000
CMD ["python", "-m", "noi2contiamo_server"]
