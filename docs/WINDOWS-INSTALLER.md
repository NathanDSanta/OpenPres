# The Windows installer

The installer has one page of its own, after the install folder:

**OpenPres Server.** Tick *Use this computer as an OpenPres server* and fill in:

- **Server name:** the computer's name by default.
- **Admin password** and **operator password**, each typed twice. The same rules as the server's own setup apply: at least 4 characters, and different from each other.
- **Let managers on other computers and tablets connect:** ticked by default.

## When the page is skipped

- **Updates** (the automatic ones run passive) and passive or silent installs: nothing changes.
- **A computer that already has a server** (its settings exist, also from versions before 0.4): it keeps its name, passwords and settings.

## When the box is ticked

1. The answers are written to `%APPDATA%\OpenPres\Server\installer-setup.txt`.
2. The server starts with Windows. This uses the same entry as *Start with Windows* in the tray and in Settings.
3. The server starts as soon as the install finishes, in **Standby**: nothing is shown until someone switches it on from a manager or from its tray icon.
4. On its first start, the server takes the answers. It stores the passwords hashed, like its own setup does, then deletes the file.
   - If the answers can't be used, the setup window asks again.

## Other installs

- Reinstalling or installing a new version by hand on a computer whose server starts with Windows starts that server again when the install finishes.
- Uninstalling removes the start with Windows. The server's files stay in `%APPDATA%\OpenPres` (see [FILES.md](FILES.md)).

## The tray icon

- **Server mode:** Active, Standby or Asleep. It follows changes made from managers too.
- **Open manager**
- **Start with Windows**
- **Check for updates** / **Update to OpenPres X.Y.Z** (see [UPDATES.md](UPDATES.md))
- **Quit completely:** stops the server until it is started again, by a manager or by the next Windows start.

## How it's built

- `tauri/windows/installer.nsi` is Tauri's own NSIS template (tauri-cli 2.12.4) with one added line that places the page.
- The page and the install steps are in `tauri/windows/hooks.nsh`.
- When `@tauri-apps/cli` is upgraded, copy the new template and add that line again.
