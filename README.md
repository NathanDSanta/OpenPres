# OpenPres for Stream Deck

Control OpenPres from an Elgato Stream Deck, like ProPresenter's Stream Deck plugin: the
plugin talks to OpenPres's network API (the same one the iPad remote uses), and the keys
show what is on screen.

Works with Elgato's Stream Deck app (Windows, macOS; version 7.1 or newer) and with
[OpenDeck](https://github.com/nekename/OpenDeck) on Linux.

## Keys

| Key | What a press does | What the key shows |
| --- | --- | --- |
| **Next** / **Previous** | Moves the slides, or the Bible passage when that was shown last, and the announcements, like the arrow keys in OpenPres. Can be set to the slides, announcements or Bible only. | Position (`3 / 12`) or the passage |
| **Go to slide** | Jumps to slide N of what is on screen (e.g. back to the chorus) | Lit while that slide shows |
| **Clear** | Clears all visual layers, everything (with audio), or one layer: slides, Bible, announcements, media, camera, props, complements, audio | Lit while there is something to clear, and what |
| **Bible passage** | Shows a passage, written as in OpenPres's Bible search (e.g. `John 3:16-18`) | Lit while it is on screen |
| **Prop** | Shows or hides a prop or complement (or only shows / only hides) | Lit while it is on screen |
| **Camera** | Shows a camera on the video input layer (or clears it) | Lit while on screen; warns when unplugged |
| **Media** | Play/pause, next or previous item of the media or audio player, or plays a media folder | Lit while playing, and what |
| **Mute bus** | Mutes or unmutes a mixer bus | Red while muted |
| **Timer** | Starts/pauses, starts, pauses or resets a timer | The timer's time; red when over |
| **Stream** | Goes live (stream and recording as set up in OpenPres) or stops. Stopping needs the key held for a second, so a stray press cannot end the stream. | `LIVE` and how long |

Every key has a **Label** field to replace the automatic text. While OpenPres cannot be
reached the keys turn grey; a press then shows a warning triangle.

## Install

1. Get `com.nathandsanta.openpres.streamDeckPlugin`: from the **Build** run of the commit
   you use (GitHub → Actions → Build Tauri App → *openpres-streamdeck-plugin*; GitHub
   zips it, so unzip the download first), or build it yourself (see below).
2. **Elgato Stream Deck (Windows, macOS):** double-click the file.
   **OpenDeck (Linux):** install [Node.js](https://nodejs.org) 20.5 or newer (`node` must be
   on the PATH), then in OpenDeck open *Plugins* → *Install from file* and pick the file.
3. Drag the OpenPres keys from the list onto your Stream Deck and choose what each does in
   its settings below.

### Connecting

With OpenPres on the same computer there is nothing to set up.

For OpenPres on another computer: in OpenPres, set a password and turn on *Access from
other devices* (Settings → Network & security). Then, in the settings of any OpenPres key,
open the connection section and enter that computer's name or IP address and the password.
These connection settings are shared by all OpenPres keys. The port is OpenPres's *Server
port* (8787 unless changed).

## Development

```sh
cd streamdeck
npm ci
npm run build      # bundles src/ into com.nathandsanta.openpres.sdPlugin/bin/plugin.js
npm test           # builds, then runs the tests (Node 22.18 or newer)
npm run validate   # checks the plugin with Elgato's CLI
npm run pack       # dist/com.nathandsanta.openpres.streamDeckPlugin
```

- `src/plugin.ts` registers the actions and talks to the settings panel.
- `src/store.ts` follows OpenPres's change notifications (`/api/events`) and keeps one copy
  of the live state for all keys; `src/client.ts` makes the requests and logs in when a
  password is set.
- `src/actions/` has one class per key; `src/keys.ts` draws the key images (SVG, with
  [Lucide](https://lucide.dev) icons like the app).
- `com.nathandsanta.openpres.sdPlugin/ui/` is the settings panel (plain HTML and
  JavaScript, so it also works offline and in OpenDeck).
- `test/` runs the built plugin with a fake Stream Deck app against a stand-in OpenPres
  server. `npm run icons` redraws the images in `imgs/` after changing them.

To try changes on a Stream Deck, link the folder into the Stream Deck app once with
`npx streamdeck link com.nathandsanta.openpres.sdPlugin`, then `npm run watch` rebuilds and
restarts the plugin on every change.
