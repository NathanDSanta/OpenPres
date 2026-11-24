# OpenPres for Android

> This branch (`android/develop`) holds only the Android app. The OpenPres app is on
> `develop`; each OpenPres release builds the app from the newest `android/develop` and
> attaches the APK to the release.

A simple viewer for OpenPres: it shows one of the server's screens, as big as it fits, and plays
one of its audio buses. It can't change anything on the server.

## Install

Get `OpenPres-X.Y.Z-Android.apk` from the
[latest release](https://github.com/NathanDSanta/OpenPres/releases/latest) and open it on the
phone or tablet (Android 7 or newer; allow installing apps from your browser or files app when
Android asks).

The app looks for a newer version when it opens, and offers to download it.

On the server, the admin lets viewers in: Admin → Settings → Server & security → **Viewers**,
with a viewer password of their own or none. Other devices also need "Let managers on other
computers and tablets connect".

## Development

Open the folder in Android Studio, or from a terminal with the Android SDK and JDK 17:

```sh
./gradlew lintDebug testDebugUnitTest   # what the checks run
./gradlew assembleDebug                 # app/build/outputs/apk/debug/app-debug.apk
./gradlew assembleRelease -PversionName=0.8.0
```

A release build is signed with the key in `ANDROID_KEYSTORE_FILE` (with
`ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` and `ANDROID_KEY_PASSWORD`) when that is set:
the release workflow takes them from the repository's secrets. Without it, the APK is signed
with a throwaway key, and a new version can only be installed after removing the old one.

### Branches and pull requests

Work on a branch named `android/feature/…`, `android/fix/…`, `android/docs/…`,
`android/chore/…` or `android/ci/…`, and open the pull request into `android/develop` with a
title like `feat: …` or `fix: …`. The checks (lint and the unit tests) run on every pull
request; an APK is built only for releases.
