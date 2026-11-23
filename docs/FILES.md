# Where OpenPres keeps its files

The server and the manager each have their own folder:

| | Windows | Linux | macOS |
|---|---|---|---|
| Server | `%APPDATA%\OpenPres\Server` | `~/.local/share/OpenPres/Server` | `~/Library/Application Support/OpenPres/Server` |
| Manager | `%APPDATA%\OpenPres\Manager` | `~/.local/share/OpenPres/Manager` | `~/Library/Application Support/OpenPres/Manager` |

- **Server:** settings (`config.json`), songs, playlists, themes, media, Bibles, screens, audio and stream settings.
  - `logs/`: the server's log files.
  - `WebView/`: the browser data of its windows (outputs, stream graphics, setup).
- **Manager:**
  - `logs/`: the manager's log files.
  - `WebView/`: the manager window's browser data (last server, mode, dashboards).

Versions before 0.4 kept the server's files directly in `OpenPres/`. The first start of the new server moves them into `Server/`. If a file is in use and can't be moved, the server uses the old place that time and tries again at the next start. The manager's browser data is copied once from its old place, so the last server, mode and dashboards are kept.

`OPENPRES_DATA_DIR` replaces the `OpenPres` folder (tests, or several copies on one computer).

## Log files

- One file a day: `server.YYYY-MM-DD.log` and `manager.YYYY-MM-DD.log`. The last 14 days are kept.
- In the interface, **Settings → System** shows the server's log folder, with a button to open it.

### What gets logged

- Start and stop: version, system and folders.
- Every request to the server: who sent it, method, path, answer and time.
  - Requests made several times a second (meters, status checks) are only logged when they fail.
  - Queries and bodies are never logged, so keys and passwords stay out.
- Server mode changes, and tray actions.
- ffmpeg's messages while streaming or recording, with the stream key hidden.
- The pages' console (errors, warnings, logs, uncaught errors) from the server's windows and from the interface opened in the manager.
- Crashes, with where they happened.

### Logging more or less

- `OPENPRES_LOG` changes what is written to the file. Examples:
  - `OPENPRES_LOG=trace` logs everything, including the frequent requests.
  - `OPENPRES_LOG=info` logs less.
- `RUST_LOG` does the same for the terminal.
