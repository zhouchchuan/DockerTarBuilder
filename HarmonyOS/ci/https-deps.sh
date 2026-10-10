#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
D="$ROOT/native-deps/media"
P="$D/prefix"
mkdir -p "$P" "$ROOT/native-deps/headers/nlohmann"
curl -fL --retry 4 https://raw.githubusercontent.com/nlohmann/json/v3.11.3/single_include/nlohmann/json.hpp -o "$ROOT/native-deps/headers/nlohmann/json.hpp"
if [ ! -f "$P/.openssl-3.5.9" ]; then
  curl -fL --retry 4 https://github.com/openssl/openssl/releases/download/openssl-3.5.9/openssl-3.5.9.tar.gz -o "$D/openssl-3.5.9.tar.gz"
  echo "603f5602e2eef00d77fbd429d34dcd5822bb301757a1bc9cdb24c670f1eb859a  $D/openssl-3.5.9.tar.gz" | sha256sum -c -
  tar -xf "$D/openssl-3.5.9.tar.gz" -C "$D"
  (
    cd "$D/openssl-3.5.9"
    export CC="$OHOS_NDK_HOME/llvm/bin/clang --target=aarch64-linux-ohos --sysroot=$OHOS_NDK_HOME/sysroot"
    export AR="$OHOS_NDK_HOME/llvm/bin/llvm-ar" RANLIB="$OHOS_NDK_HOME/llvm/bin/llvm-ranlib"
    perl Configure linux-aarch64 no-shared no-tests no-asm no-dso no-module -fPIC --prefix="$P" --libdir=lib
    make -j3
    make install_sw
  )
  touch "$P/.openssl-3.5.9"
fi
bash "$ROOT/ci/media-deps.sh"
RAW="$ROOT/entry/src/main/resources/rawfile"
mkdir -p "$RAW/licenses"
cp /etc/ssl/certs/ca-certificates.crt "$RAW/ca.pem"
cp "$D/openssl-3.5.9/LICENSE.txt" "$RAW/licenses/OpenSSL-Apache-2.0.txt"
cp "$ROOT/LICENSE.txt" "$RAW/licenses/WuAi-and-BTMobile-MIT.txt"
curl -fL --retry 4 https://raw.githubusercontent.com/nlohmann/json/v3.11.3/LICENSE.MIT -o "$RAW/licenses/nlohmann-json-MIT.txt"
