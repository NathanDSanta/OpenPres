# The Windows installer

The installer has two pages of its own, after the install folder.

**OpenPres Server.** Tick *Use this computer as an OpenPres server* and fill in:

- **Server name:** the computer's name by default.
- **Admin password** and **operator password**, each typed twice. The same rules as the server's own setup apply: at least 4 characters, and different from each other.
- **Let managers on other computers and tablets connect:** ticked by default.

**Other OpenPres programs.** They have their own releases; the ticked ones are downloaded from GitHub and installed after OpenPres:

- **OpenPres Manager**, ticked unless it's already installed: the program to run OpenPres from this computer. Other computers install it on their own.
- **Stream Deck plugin**, ticked when the Stream Deck app is on this computer (otherwise it can't be ticked). The Stream Deck app asks before adding it.

Without internet, OpenPres still installs; the installer's log says what couldn't be installed. The server program does the work (`openpres.exe --install-extras manager streamdeck`): the Manager's setup from its newest release (with betas when the server is a beta or follows the beta program), run silently; the plugin's file, opened with the Stream Deck app.

## When the pages are skipped

- **Updates** (the automatic ones run passive) and passive or silent installs: nothing changes. One exception, once: updating from a version that had the Manager built in (before 0.7) installs the Manager if it was used on this computer, so nobody loses it. `%APPDATA%\OpenPres\extras-offered.txt` records that the programs were offered.
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
- **Open Manager:** the installed Manager, or the server's interface in the browser without one.
- **Start with Windows**
- **Check for updates** / **Update to OpenPres X.Y.Z** (see [UPDATES.md](UPDATES.md))
- **Quit completely:** stops the server until it is started again, by a manager or by the next Windows start.

## How it's built

- `tauri/windows/installer.nsi` is Tauri's own NSIS template (tauri-cli 2.12.4) with two added lines that place the pages.
- The pages and the install steps are in `tauri/windows/hooks.nsh`; the downloads in `tauri/src/extras.rs`.
- When `@tauri-apps/cli` is upgraded, copy the new template and add those lines again.

## The Start menu

*OpenPres* opens the Manager. Without the Manager, it starts this computer's server (if needed) and opens its interface in the browser.
