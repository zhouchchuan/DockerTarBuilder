#!/bin/bash
set -euo pipefail
mkdir -p build
xcodebuild -version > build/toolchain.txt
swiftc WuAiZhiBo/NavigationRecovery.swift Tests/main.swift -o build/recovery-tests
build/recovery-tests | tee build/recovery-tests.txt
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
assert info['CFBundleShortVersionString'] == '1.0.2'
assert info['CFBundleVersion'] == '3'
for path in pathlib.Path('PreservedResources').rglob('*'):
    if path.is_file():
        assert path.read_bytes() == (app/path.relative_to('PreservedResources')).read_bytes()
assert not (app/'Frameworks/MobileVLCKit.framework').exists()
PY
NAME=wazb-iOS-v1.0.2-web-unsigned
if [[ -n "${IOS_P12_BASE64:-}" && -n "${IOS_PROFILE_BASE64:-}" && -n "${IOS_P12_PASSWORD:-}" ]]; then
  TEMP_SIGN="$RUNNER_TEMP/wuai-signing"
  mkdir -p "$TEMP_SIGN"
  KEYCHAIN="$TEMP_SIGN/build.keychain-db"
  KEYCHAIN_PASSWORD=$(openssl rand -hex 32)
  echo "::add-mask::$KEYCHAIN_PASSWORD"
  cleanup() { security delete-keychain "$KEYCHAIN" >/dev/null 2>&1 || true; rm -rf "$TEMP_SIGN"; }
  trap cleanup EXIT
  python3 - "$TEMP_SIGN" <<'PY'
import base64, os, pathlib, sys
p = pathlib.Path(sys.argv[1])
(p/'cert.p12').write_bytes(base64.b64decode(os.environ['IOS_P12_BASE64']))
(p/'profile.mobileprovision').write_bytes(base64.b64decode(os.environ['IOS_PROFILE_BASE64']))
PY
  security create-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN"
  security set-keychain-settings -lut 21600 "$KEYCHAIN"
  security unlock-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN"
  security import "$TEMP_SIGN/cert.p12" -k "$KEYCHAIN" -P "$IOS_P12_PASSWORD" -T /usr/bin/codesign -T /usr/bin/security >/dev/null
  security list-keychains -d user -s "$KEYCHAIN" login.keychain-db
  security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$KEYCHAIN_PASSWORD" "$KEYCHAIN" >/dev/null
  security cms -D -i "$TEMP_SIGN/profile.mobileprovision" > "$TEMP_SIGN/profile.plist"
  python3 - "$TEMP_SIGN" <<'PY'
import datetime, pathlib, plistlib, sys
p=pathlib.Path(sys.argv[1]); profile=plistlib.loads((p/'profile.plist').read_bytes())
assert profile['Entitlements']['application-identifier']=='XTGL9G753G.com.chatapp.bqimvip'
assert profile['ExpirationDate'] > datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)
(p/'entitlements.plist').write_bytes(plistlib.dumps(profile['Entitlements']))
PY
  IDENTITY=$(security find-identity -v -p codesigning "$KEYCHAIN" | awk '/iPhone Distribution: DECO MATCHES LIMITED/ {print $2; exit}')
  test -n "$IDENTITY"
  cp "$TEMP_SIGN/profile.mobileprovision" "$APP/embedded.mobileprovision"
  # This wrapper has no app extensions or embedded third-party frameworks.
  if [[ -d "$APP/Frameworks" ]]; then
    while IFS= read -r -d '' FRAMEWORK; do
      codesign --force --sign "$IDENTITY" --keychain "$KEYCHAIN" --timestamp=none "$FRAMEWORK"
    done < <(find "$APP/Frameworks" -maxdepth 1 \( -name '*.framework' -o -name '*.dylib' \) -print0)
  fi
  codesign --force --sign "$IDENTITY" --keychain "$KEYCHAIN" --entitlements "$TEMP_SIGN/entitlements.plist" --generate-entitlement-der --timestamp=none "$APP"
  codesign --verify --deep --strict --verbose=2 "$APP" 2> build/signature-verification.txt
  NAME=wazb-iOS-v1.0.2-web-signed
fi
mkdir -p build/package/Payload
cp -R "$APP" build/package/Payload/
(cd build/package && zip -qry "../$NAME.ipa" Payload)
(cd build && shasum -a 256 "$NAME.ipa" > SHA256.txt)
printf '%s\n' "$GITHUB_SHA" > build/source-commit.txt
echo "Produced $NAME.ipa"
