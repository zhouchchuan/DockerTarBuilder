# syntax=docker/dockerfile:1.7

ARG ALPINE_VERSION=3.24
FROM alpine:${ALPINE_VERSION} AS builder

ARG LIBTORRENT_REF=v2.0.12
ARG QBT_PRECISION_VERSION=0.1.3
ARG QBT_UPSTREAM_VERSION=5.2.3
ARG QBT_UPSTREAM_COMMIT=0b63c3d17373f6132ea211c9dcd4241284ccdfaf

RUN apk --no-cache add \
        boost-dev \
        cmake \
        g++ \
        git \
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

COPY docker/lsio/patches/ /tmp/qbittorrent-patches/

RUN for patch in /tmp/qbittorrent-patches/*.patch; do \
        git -C /source/qbittorrent apply --check "${patch}"; \
        git -C /source/qbittorrent apply "${patch}"; \
    done

WORKDIR /source/qbittorrent

RUN cmake \
        -S . \
        -B build \
        -G Ninja \
        -DCMAKE_BUILD_TYPE=RelWithDebInfo \
        -DCMAKE_INSTALL_PREFIX=/usr \
        -DCMAKE_INTERPROCEDURAL_OPTIMIZATION=ON \
        -DGUI=OFF \
        -DTESTING=ON \
        -DWEBUI=ON \
    && cmake --build build --parallel \
    && ./build/test/testbittorrentpeeraddress \
    && ./build/test/testbittorrentpeerendpointblocklist \
    && cmake --install build \
    && /usr/bin/qbittorrent-nox --version | grep -F "qBittorrent v${QBT_UPSTREAM_VERSION}" \
    && printf '%s\n' \
        "qBittorrent Precision ${QBT_PRECISION_VERSION}" \
        "Runtime base: LinuxServer.io qBittorrent ${QBT_UPSTREAM_VERSION}" \
        "Target: Synology DS1823xs+ (linux/amd64)" \
        "qBittorrent ${QBT_UPSTREAM_VERSION} (${QBT_UPSTREAM_COMMIT})" \
        "libtorrent ${LIBTORRENT_REF} ($(git -C /build/libtorrent rev-parse HEAD))" \
        > /sbom-precision.txt

FROM lscr.io/linuxserver/qbittorrent:5.2.3

ARG LIBTORRENT_REF=v2.0.12
ARG QBT_PRECISION_VERSION=0.1.3
ARG QBT_UPSTREAM_VERSION=5.2.3
ARG QBT_UPSTREAM_COMMIT=0b63c3d17373f6132ea211c9dcd4241284ccdfaf

LABEL org.opencontainers.image.title="qBittorrent Precision" \
      org.opencontainers.image.description="LinuxServer.io based Synology baseline for qBittorrent Precision / PeerGuard" \
      org.opencontainers.image.version="${QBT_PRECISION_VERSION}" \
      org.opencontainers.image.source="https://github.com/qbittorrent/qBittorrent" \
      org.opencontainers.image.revision="${QBT_UPSTREAM_COMMIT}" \
      org.opencontainers.image.licenses="GPL-3.0-or-later" \
      io.qbittorrent-precision.runtime-base="linuxserver/qbittorrent:5.2.3" \
      io.qbittorrent-precision.target="Synology DS1823xs+" \
      io.qbittorrent-precision.platform="linux/amd64" \
      io.qbittorrent-precision.upstream-version="${QBT_UPSTREAM_VERSION}" \
      io.qbittorrent-precision.libtorrent-ref="${LIBTORRENT_REF}" \
      io.qbittorrent-precision.endpoint-control="ip+port" \
      io.qbittorrent-precision.manual-ban-rules="ip-or-ip+port"

RUN apk --no-cache add \
        libgomp \
        qt6-qtbase \
        qt6-qtbase-sqlite

COPY --from=builder /usr/bin/qbittorrent-nox /app/qbittorrent-nox
COPY --from=builder /sbom-precision.txt /sbom-precision.txt

RUN chmod 0755 /app/qbittorrent-nox \
    && /app/qbittorrent-nox --version | grep -F "qBittorrent v${QBT_UPSTREAM_VERSION}" \
    && ldd /app/qbittorrent-nox | tee /runtime-dependencies.txt \
    && ! grep -F "not found" /runtime-dependencies.txt

