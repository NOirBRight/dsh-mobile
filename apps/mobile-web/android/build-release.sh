#!/usr/bin/env bash
# Signed release APK for the CDN-free Android local shell.
#
# Requires android/signing.properties (see signing.properties.example). The
# operator keystore lives outside the repo at ~/.config/dsh-mobile/.
set -euo pipefail
cd "$(dirname "$0")/.."

export JAVA_HOME="${DSH_MOBILE_JAVA_HOME:-/usr/lib/jvm/java-21-openjdk-amd64}"
export ANDROID_HOME="${ANDROID_HOME:-/home/noirbright/Android/Sdk}"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$PATH"

if [[ ! -f android/signing.properties ]]; then
  echo "missing android/signing.properties (copy or symlink from ~/.config/dsh-mobile/android-signing.properties)" >&2
  exit 1
fi

npm run build
npx cap sync android
node scripts/package-android-layout.mjs

printf 'sdk.dir=%s\n' "$ANDROID_HOME" > android/local.properties

cd android
./gradlew assembleRelease

apk=app/build/outputs/apk/release/app-release.apk
test -s "$apk"
echo "built: android/$apk"
