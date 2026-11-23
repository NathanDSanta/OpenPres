# Automatic updates

OpenPres updates itself from GitHub Releases. Every release publishes `latest.json` (see [RELEASING.md](RELEASING.md)), and installed copies check it. Each download is checked against the release key in `tauri/tauri.conf.json` before it's installed.

## The manager

- **When it opens**, the server list asks for a newer version (for up to 4 seconds; offline, it just goes on). If there is one, it shows the release notes with **Update** and **Remind me later**.
- **Remind me later:** asks again the next time OpenPres is opened. The last server opens as usual.
- **Update:** downloads (with progress), installs, and opens the new version.
  - On Windows the installer also closes the server on that computer (same program). The manager starts it again by itself.

## The server

- **When it checks:** a minute after starting, then every 6 hours. **Settings → System → Check now** asks right away.
- **Where it shows:**
  - The admin sees the same dialog in the interface.
  - **Settings → System** shows the state.
  - The tray has **Update to OpenPres X.Y.Z**.
- **Updating:**
  1. Downloads.
  2. Stops cleanly (stream, devices, sound).
  3. Installs.
  4. Starts again in server mode. Managers reconnect by themselves.
- Only the admin can install a server update.

## Test builds

Debug builds don't update. To try the flow:

- `OPENPRES_UPDATES=1` turns updates on.
- `OPENPRES_UPDATE_ENDPOINT=http://127.0.0.1:8800/latest.json` uses a local `latest.json`.
  - It must still be signed with the release key: `npx tauri signer sign`.
