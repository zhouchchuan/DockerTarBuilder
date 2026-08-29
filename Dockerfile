FROM node:22-alpine

ARG VERSION=0.0.1
LABEL org.opencontainers.image.title="PeerBander Beyonder" \
      org.opencontainers.image.description="Precision peer-control companion for qBittorrent Precision" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.licenses="MIT"

ENV NODE_ENV=production \
    PBB_DATA_DIR=/data \
    PBB_WEBUI_PORT=9899 \
    PBB_LISTEN_ADDRESS=0.0.0.0

WORKDIR /app
COPY package.json ./
COPY src ./src
COPY public ./public
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

RUN apk add --no-cache su-exec \
    && mkdir -p /data \
    && chmod 0755 /usr/local/bin/docker-entrypoint.sh

VOLUME ["/data"]
EXPOSE 9899

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O - "http://127.0.0.1:${PBB_WEBUI_PORT:-9899}/" >/dev/null || exit 1

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
