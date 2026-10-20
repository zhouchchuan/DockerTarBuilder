#!/bin/bash
set -euo pipefail
mkdir -p build
xcodebuild -version > build/toolchain.txt
swiftc WuAiZhiBo/NavigationRecovery.swift Tests/main.swift -o build/recovery-tests
build/recovery-tests | tee build/recovery-tests.txt
swiftc WuAiZhiBo/AudioRecovery.swift Tests/Audio/main.swift -o build/audio-tests
build/audio-tests | tee build/audio-tests.txt
node Tests/audio-bridge.test.cjs | tee build/audio-bridge-tests.txt
swift test 2>&1 | tee build/browser-tests.log
xcodebuild -project WuAiZhiBo.xcodeproj -scheme WuAiZhiBo -configuration Release \
  -sdk iphoneos -destination 'generic/platform=iOS' -derivedDataPath build/DerivedData \
  CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY='' \
  ARCHS=arm64 ONLY_ACTIVE_ARCH=NO build > build/xcodebuild.log 2>&1
APP=build/DerivedData/Build/Products/Release-iphoneos/WuAiZhiBo.app
# Preserve the exact compiled branding and launch-screen resources from the user's v1.0.1.
cp -R PreservedResources/. "$APP/"
python3 - "$APP" <<'PY'
import hashlib, pathlib, plistlib, sys
app = pathlib.Path(sys.argv[1])
info = plistlib.loads((app/'Info.plist').read_bytes())
assert info['CFBundleIdentifier'] == 'com.chatapp.bqimvip'
assert info['CFBundleShortVersionString'] == '1.0.4'
assert info['CFBundleVersion'] == '5'
for path in pathlib.Path('PreservedResources').rglob('*'):
    if path.is_file():
        assert path.read_bytes() == (app/path.relative_to('PreservedResources')).read_bytes()
assert not (app/'Frameworks/MobileVLCKit.framework').exists()
assert (app/'AudioRecovery.js').is_file()
assert not (app/'embedded.mobileprovision').exists()
PY
NAME=wazb-iOS-v1.0.4-web-unsigned
mkdir -p build/package/Payload
cp -R "$APP" build/package/Payload/
(cd build/package && zip -qry "../$NAME.ipa" Payload)
(cd build && shasum -a 256 "$NAME.ipa" > SHA256.txt)
printf '%s\n' "$GITHUB_SHA" > build/source-commit.txt
echo "Produced $NAME.ipa"
