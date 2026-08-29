# syntax=docker/dockerfile:1.7

ARG ALPINE_VERSION=3.24
FROM alpine:${ALPINE_VERSION} AS base

RUN apk --no-cache add \
        7zip \
        bash \
        ca-certificates \
        curl \
        doas \
        libcrypto3 \
        libssl3 \
        python3 \
        qt6-qtbase \
        qt6-qtbase-sqlite \
        tini \
        tzdata \
        zlib

FROM base AS builder

ARG LIBTORRENT_REF=v1.2.20
ARG QBT_PRECISION_VERSION=0.1.0-base
ARG QBT_UPSTREAM_VERSION=5.2.3
ARG QBT_UPSTREAM_COMMIT=0b63c3d17373f6132ea211c9dcd4241284ccdfaf

RUN apk --no-cache add \
        boost-dev \
        cmake \
        g++ \
        git \
        make \
        ninja \
        openssl-dev \
        qt6-qtbase-dev \
        qt6-qtbase-private-dev \
        qt6-qttools-dev \
        zlib-dev

ENV CFLAGS="-pipe -fstack-clash-protection -fstack-protector-strong -fno-plt -U_FORTIFY_SOURCE -D_FORTIFY_SOURCE=3 -D_GLIBCXX_ASSERTIONS" \
    CXXFLAGS="-pipe -fstack-clash-protection -fstack-protector-strong -fno-plt -U_FORTIFY_SOURCE -D_FORTIFY_SOURCE=3 -D_GLIBCXX_ASSERTIONS" \
    LDFLAGS="-Wl,-O1,--as-needed,--sort-common,-z,now,-z,pack-relative-relocs,-z,relro"

WORKDIR /build

RUN git clone \
        --branch "${LIBTORRENT_REF}" \
        --depth 1 \
        --recurse-submodules \
        https://github.com/arvidn/libtorrent.git libtorrent \
    && cmake \
        -S libtorrent \
        -B libtorrent/build \
        -G Ninja \
        -DBUILD_SHARED_LIBS=OFF \
        -DCMAKE_BUILD_TYPE=RelWithDebInfo \
        -DCMAKE_CXX_STANDARD=20 \
        -DCMAKE_INSTALL_PREFIX=/usr \
        -DCMAKE_INTERPROCEDURAL_OPTIMIZATION=ON \
        -Ddeprecated-functions=OFF \
        -Dbuild_examples=OFF \
        -Dbuild_tests=OFF \
    && cmake --build libtorrent/build --parallel \
    && cmake --install libtorrent/build

RUN git clone \
        --branch "release-${QBT_UPSTREAM_VERSION}" \
        --depth 1 \
        https://github.com/qbittorrent/qBittorrent.git /source/qbittorrent \
    && test "$(git -C /source/qbittorrent rev-parse HEAD)" = "${QBT_UPSTREAM_COMMIT}"

WORKDIR /source/qbittorrent

RUN cmake \
        -S . \
        -B build \
        -G Ninja \
        -DCMAKE_BUILD_TYPE=RelWithDebInfo \
        -DCMAKE_INSTALL_PREFIX=/usr \
        -DCMAKE_INTERPROCEDURAL_OPTIMIZATION=ON \
        -DGUI=OFF \
        -DWEBUI=ON \
    && cmake --build build --parallel \
    && cmake --install build \
    && /usr/bin/qbittorrent-nox --version | grep -F "qBittorrent v${QBT_UPSTREAM_VERSION}" \
    && printf '%s\n' \
        "qBittorrent Precision ${QBT_PRECISION_VERSION}" \
        "Target Synology DS1823xs+ (linux/amd64)" \
        "qBittorrent ${QBT_UPSTREAM_VERSION} (${QBT_UPSTREAM_COMMIT})" \
        "libtorrent ${LIBTORRENT_REF} ($(git -C /build/libtorrent rev-parse HEAD))" \
        > /sbom-precision.txt \
    && apk list -I | sort >> /sbom-precision.txt

FROM base AS runtime

ARG LIBTORRENT_REF=v1.2.20
ARG QBT_PRECISION_VERSION=0.1.0-base
ARG QBT_UPSTREAM_VERSION=5.2.3
ARG QBT_UPSTREAM_COMMIT=0b63c3d17373f6132ea211c9dcd4241284ccdfaf

LABEL org.opencontainers.image.title="qBittorrent Precision" \
      org.opencontainers.image.description="Synology DS1823xs+ baseline for qBittorrent Precision / PeerGuard" \
      org.opencontainers.image.version="${QBT_PRECISION_VERSION}" \
      org.opencontainers.image.source="https://github.com/qbittorrent/qBittorrent" \
      org.opencontainers.image.revision="${QBT_UPSTREAM_COMMIT}" \
      org.opencontainers.image.licenses="GPL-3.0-or-later" \
      io.qbittorrent-precision.target="Synology DS1823xs+" \
      io.qbittorrent-precision.platform="linux/amd64" \
      io.qbittorrent-precision.upstream-version="${QBT_UPSTREAM_VERSION}" \
      io.qbittorrent-precision.libtorrent-ref="${LIBTORRENT_REF}"

RUN addgroup -g 1000 qbtUser \
    && adduser -D -H -s /sbin/nologin -u 1000 -G qbtUser qbtUser \
    && mkdir -p /config /downloads \
    && chown qbtUser:qbtUser /config /downloads \
    && printf 'permit nopass :root\n' > /etc/doas.d/doas.conf

COPY --from=builder /usr/bin/qbittorrent-nox /usr/bin/qbittorrent-nox
COPY --from=builder /sbom-precision.txt /sbom-precision.txt
COPY qbittorrent-precision/ds1823xs/entrypoint.sh /usr/local/bin/precision-entrypoint
COPY qbittorrent-precision/ds1823xs/healthcheck.sh /usr/local/bin/precision-healthcheck

RUN chmod 0755 /usr/local/bin/precision-entrypoint /usr/local/bin/precision-healthcheck \
    && ldd /usr/bin/qbittorrent-nox | tee /runtime-dependencies.txt \
    && ! grep -F "not found" /runtime-dependencies.txt

ENV HOME=/config \
    QBT_TORRENTING_PORT=6881 \
    QBT_WEBUI_PORT=8080

EXPOSE 6881/tcp 6881/udp 8080/tcp

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=5 \
    CMD ["/usr/local/bin/precision-healthcheck"]

ENTRYPOINT ["/sbin/tini", "-g", "--", "/usr/local/bin/precision-entrypoint"]

