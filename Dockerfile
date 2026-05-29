# syntax=docker/dockerfile:1.7
#
# Two stages:
#   1) build  — node 20 alpine, npm ci, vite build
#   2) serve  — nginx 1.27 alpine, runs as the unprivileged `nginx`
#               user (uid 101), reads from /usr/share/nginx/html.
#
# The production posture is path-based routing at the ingress / ALB
# level: `/` → this nginx container, `/api/v1/*` → the api service.
# This container only ships the SPA bundle + health probe.

# ─────────────────────────────────────────────────────────────────
FROM node:20-alpine AS build
WORKDIR /app

# Cache the install layer when only source changes.
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund

COPY tsconfig.json tsconfig.app.json tsconfig.node.json ./
COPY vite.config.ts postcss.config.js tailwind.config.js ./
COPY index.html ./
COPY src ./src

ARG VITE_API_BASE_URL=""
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL

RUN npm run build

# ─────────────────────────────────────────────────────────────────
FROM nginx:1.27-alpine AS serve

# Replace the default config with our SPA-aware one (history-mode
# fallback + cache strategy + security headers). See nginx/nginx.conf.
RUN rm /etc/nginx/conf.d/default.conf
COPY nginx/nginx.conf /etc/nginx/nginx.conf

COPY --from=build /app/dist /usr/share/nginx/html

# Run as the unprivileged `nginx` user (uid 101 in the official
# image). Pair with `securityContext: { runAsNonRoot: true,
# readOnlyRootFilesystem: true }` in the Helm chart.
USER 101

EXPOSE 8080

# `daemon off` is required so nginx stays as PID 1 inside the
# container (kubelet shutdown signals reach it).
CMD ["nginx", "-g", "daemon off;"]
