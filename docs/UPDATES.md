# Automatic updates

OpenPres updates itself from GitHub Releases. Every release publishes `latest.json` (see [RELEASING.md](RELEASING.md)), and installed copies check it. Each download is checked against the release key in `tauri/tauri.conf.json` before it's installed.

## The Manager and the apps

The Manager, the Stream Deck plugin and the apps update themselves from their own repositories' releases (see their READMEs). They follow the beta program of their server (below).

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

### Automatic updates

**Settings → System → Automatic updates** (admin). When it's on, a new version installs by
itself once nothing has been live for 5 minutes: no stream or recording, and, while the
server is Active, no slides, Bible passage, announcements or media on the screens. Asleep
and Standby count as free. Until then Settings → System says why it's waiting. The admin
isn't asked; **Update** still installs right away.

It's off at first: the admin is asked, as above.

### The beta program

**Settings → System → Beta program** (admin). When it's on, the server also gets betas
("0.7.0.3 beta": new features before the stable release), from the "beta-feed" release, and
so do the Manager, the Stream Deck plugin and the apps that use this server. Off: stable
releases only. Betas and their names: [RELEASING.md](RELEASING.md).

## Test builds

Debug builds don't update. To try the flow:

- `OPENPRES_UPDATES=1` turns updates on.
- `OPENPRES_UPDATE_ENDPOINT=http://127.0.0.1:8800/latest.json` uses a local `latest.json`.
  - It must still be signed with the release key: `npx tauri signer sign`.
