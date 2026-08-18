#!/usr/bin/env bash
# Deterministic debug-APK build for the CDN-free Android local shell.
#
# Pipeline: vite build → cap sync android → gradlew assembleDebug.
# The toolchain is pinned so every developer/CI box produces the same APK
# layout; override DSH_MOBILE_JAVA_HOME/ANDROID_HOME only when the SDK lives elsewhere.
set -euo pipefail
cd "$(dirname "$0")/.."

export JAVA_HOME="${DSH_MOBILE_JAVA_HOME:-/usr/lib/jvm/java-21-openjdk-amd64}"
export ANDROID_HOME="${ANDROID_HOME:-/home/noirbright/Android/Sdk}"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$PATH"

npm run build
npx cap sync android
node scripts/package-android-layout.mjs

# Gradle reads sdk.dir here; regenerated on every build, safe to gitignore.
printf 'sdk.dir=%s\n' "$ANDROID_HOME" > android/local.properties

cd android
./gradlew assembleDebug

apk=app/build/outputs/apk/debug/app-debug.apk
test -s "$apk"
echo "built: android/$apk"
