# Smart Mess frontend: build the static site, serve it with nginx (non-root) + real security headers.
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# The API's public URL is baked into the bundle at build time (Vite), e.g. https://api.mess.example.edu/api
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build

FROM nginxinc/nginx-unprivileged:1.27-alpine
# API_ORIGIN (scheme+host, no path) is substituted into the CSP at container start.
ENV API_ORIGIN=http://localhost:4000
COPY deploy/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY deploy/security-headers.inc.template /etc/nginx/templates/security-headers.inc.template
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
