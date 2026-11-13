# OpenPres 0.2.0 — upgrade notes

Your zip only contained the `src` folders, so a few changes have to be made by hand in
files I could not see. They are listed first.

## 1. Required changes outside `src`

### Cargo.toml
Set `version = "0.2.0"` and add these dependencies (see `tauri/Cargo.reference.toml`, which
is the manifest I compiled and tested with):

```toml
symphonia = { version = "0.5", features = ["all"] }   # audio decoding (media audio playback)
sha2 = "0.10"                                         # password hashing
image = { version = "0.25", default-features = false, features = ["jpeg"] }  # camera frames
futures-util = "0.3"                                  # server-sent events / streams

[target.'cfg(target_os = "linux")'.dependencies]
gtk = "0.18"                                          # (from the previous fix)
```

Versions I verified against: tauri 2.12, axum 0.7, tower-http 0.5, cpal 0.15, nokhwa 0.10.

### tauri.conf.json
* `"version": "0.2.0"`.
* The main window must keep the label `main` (closing it now closes every window and quits).
* If you set a CSP, allow the local server: `connect-src`, `img-src` and `media-src` need
  `http://127.0.0.1:*`. With `"csp": null` (the template default) nothing is needed.

### capabilities/default.json
Presentation windows and the stream window now receive change events from the backend.
They need the core permissions too, otherwise they fall back to refreshing every 4 seconds:

```json
{
  "identifier": "default",
  "windows": ["main", "presentation-display-*", "stream-compositor"],
  "permissions": ["core:default"]
}
```

### package.json
No new frontend packages (react, react-router-dom, lucide-react, @tauri-apps/api 2).

## 2. Runtime requirements

* **ffmpeg** for streaming and recording (and as a fallback decoder, e.g. for Opus/WebM
  audio). Install it or set its path in Settings → General. You can also bundle it as a
  Tauri sidecar later.
* **macOS**: add `NSCameraUsageDescription` and `NSMicrophoneUsageDescription` to
  Info.plist, or the camera and audio inputs will be refused.
* **Linux**: WebKitGTK plays H.264 video through GStreamer: install the
  `gst-plugins-good`, `gst-plugins-bad` and `gst-libav` packages (names vary by distro).

## 3. Your data is migrated automatically

| Old | New |
| --- | --- |
| Theme with one `background` + `elements` | Theme with one design called "Default" (stable id) |
| Element `kind` (text/value/shape/media) | Element with shape, fill, border, shadow and an optional linked text |
| `group_styles` in config.json | `groups.json` (group classes), created on first start |
| `audio_routing.json` | `audio.json` (each old mapping becomes a mono input strip) |
| screens.json | same file; new fields get defaults (all layers on, black background) |

New files in the data folder: `groups.json`, `import_templates.json`, `workspace.json`,
`timers.json`, `stream.json`, `audio.json`, `media/` (imported files + index + playlists),
`recordings/`.

## 4. API changes (for anything else that calls the HTTP API)

* Live content is global; screens choose what they show. `/screens/:id/layers` (content)
  was replaced by `PUT /screens/:id/layers/:kind {"enabled": bool}` and `/live/*`.
* `/audio/routing*` was replaced by `/audio`, `/audio/inputs`, `/audio/outputs`,
  `/audio/strips/:id/levels`, `/audio/meters`.
* `POST /presenter/load` accepts `"index"` (start slide). `?layer=all` steps both layers.
* `/screens/:id/render` returns the full scene (all layers, mask, timers).
* New: `/media*`, `/player/*`, `/timers*`, `/stream/*`, `/groups`, `/import/templates`,
  `/workspace`, `/presentations` (all libraries), `/events` (SSE), `/auth/*`, `/network`.

## 5. Things to know

* **Tested here** on Linux: the backend (including a headless run of the whole HTTP API,
  recording, RTMP output and the stream compositor page in Chrome) and the frontend
  (strict TypeScript, production build, screenshots and click-through tests of every
  page). I could not compile for Windows or macOS here; the platform-specific code is
  small (window placement, `CREATE_NO_WINDOW` for ffmpeg) but please build there.
* **Audio between devices**: every device runs on its own clock. Short buffers absorb the
  drift, so over long periods you may hear a rare tiny click instead of growing delay.
* **Video sound** is decoded by the backend and kept in sync with the picture (re-synced
  when it drifts more than about 0.35 s).
* **Stream window**: Windows and Linux webviews slow down minimized windows, so while
  streaming a small "Stream output" window renders the stream. It can be covered but not
  minimized. Closing it minimizes it; stopping the stream closes it.
* **Fonts**: text is drawn on a canvas with the fonts installed on each computer (and on
  the iPad when previewing there).
* **Designs** can be chosen per presentation and per group (Reflow group headers), not per
  individual slide.
* **Taskbar**: presentation windows are hidden from the taskbar on Windows/macOS/X11;
  some Wayland compositors ignore this.
