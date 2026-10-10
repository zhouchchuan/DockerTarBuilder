#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
TEST=$(mktemp -d)
export TEST
g++ -std=c++17 -O1 -pthread "$ROOT/tests/media_engine_test.cpp" -I"$ROOT/native-deps/headers" $(pkg-config --cflags --libs libavformat libavcodec libavutil libswresample libswscale) -o "$TEST/media-test"
ffmpeg -hide_banner -loglevel error -f lavfi -i testsrc2=size=320x180:rate=24 -f lavfi -i sine=frequency=440:sample_rate=48000 -t 4 -c:v libaom-av1 -cpu-used 8 -crf 38 -c:a aac -movflags +faststart "$TEST/av1.mp4"
timeout 25 "$TEST/media-test" "$TEST/av1.mp4" audio
ffmpeg -hide_banner -loglevel error -f lavfi -i testsrc2=size=320x180:rate=24 -t 4 -pix_fmt yuv420p10le -c:v libaom-av1 -cpu-used 8 -crf 38 "$TEST/av1-10bit.mkv"
timeout 25 "$TEST/media-test" "$TEST/av1-10bit.mkv" silent
g++ -std=c++17 -O1 -pthread "$ROOT/tests/media_gles_test.cpp" -I"$ROOT/native-deps/headers" $(pkg-config --cflags --libs libavformat libavcodec libavutil libswresample libswscale egl glesv2) -o "$TEST/gles-test"
EGL_PLATFORM=surfaceless LIBGL_ALWAYS_SOFTWARE=1 timeout 15 "$TEST/gles-test"
g++ -std=c++17 -O1 -pthread "$ROOT/tests/media_https_test.cpp" -I"$ROOT/native-deps/headers" $(pkg-config --cflags --libs libavformat libavcodec libavutil libswresample libswscale) -o "$TEST/https-test"
openssl req -x509 -newkey rsa:2048 -nodes -keyout "$TEST/key.pem" -out "$TEST/cert.pem" -days 1 -subj '/CN=localhost' -addext 'subjectAltName=DNS:localhost' >/dev/null 2>&1
python3 - <<'PY' &
import os,ssl,http.server
os.chdir(os.environ['TEST'])
server=http.server.ThreadingHTTPServer(('127.0.0.1',18443),http.server.SimpleHTTPRequestHandler)
ctx=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER);ctx.load_cert_chain('cert.pem','key.pem')
server.socket=ctx.wrap_socket(server.socket,server_side=True);server.serve_forever()
PY
SERVER=$!
trap 'kill "$SERVER" 2>/dev/null || true' EXIT
for attempt in {1..30}; do curl --silent --cacert "$TEST/cert.pem" https://localhost:18443/av1.mp4 -o /dev/null && break; sleep 0.2; done
timeout 20 "$TEST/https-test" https://localhost:18443/av1.mp4 "$TEST/cert.pem" trusted
timeout 20 "$TEST/https-test" https://localhost:18443/av1.mp4 /etc/ssl/certs/ca-certificates.crt reject
