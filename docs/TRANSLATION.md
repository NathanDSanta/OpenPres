# Translation

Phones listen to a live translation of the service with the **OpenPres Translation** app
(repo `OpenPres-T`). Each language is a **track**; for now there's one, Spanish.

## Modes

| Mode | Where the sound comes from | Status |
|---|---|---|
| **Manual** | An interpreter speaks into a microphone plugged into the server's computer. That input goes to a bus, like any other input, and phones hear that bus. | Works |
| **Automatic** | The computer translates another bus (the preacher's microphone) by itself. | Not available yet |

## Setting up the manual mode

1. **Audio page:** give the interpreter's microphone its own bus (e.g. bus 9, named
   "Interpreter"), with that computer input as the bus's input. It doesn't need an output: it
   only goes to the phones. The bus fader sets the phones' volume, and muting the bus mutes them.
2. **Translation page:** Spanish → Manual, choose that bus, turn it on.
3. **Server & security:** remote access must be on, or phones can't reach the server.
4. **Phones:** on the same Wi-Fi as the server, open the Translation app. It finds the server
   by itself (or takes a typed address), shows "Español" while the track is on, and keeps
   playing with the screen off.

The Translation page shows how many phones are listening, and why phones hear nothing when a
track is on but has no bus, or is set to automatic.

## For phones (no login)

While remote access is on, anyone on the network can do these two things, and nothing else:

- `GET /api/translation/tracks` → `{"tracks": [{"language": "es", "name": "Español", "live": true, "captions": false}]}`
- `GET /api/translation/tracks/es/listen` → the track's sound while it's on: raw 16-bit PCM,
  little-endian, 24 kHz mono by default (`?rate=48000|24000|16000&mono=0|1`), in chunks of
  50 ms. Answers 409 when the track is off (or set to automatic), and 409 while the server
  sleeps. A phone that's listening is cut off when its track goes off or moves to another bus;
  it reconnects and finds out.

Every phone on a track shares one feed on the server (`audio/listen.rs`), so many phones cost
about what one does.

## For the manager

`GET /api/translation` and `PUT /api/translation` (operators, any mode):

```json
{
  "languages": [{ "code": "es", "name": "Español", "english": "Spanish" }],
  "tracks": [{
    "language": "es", "on": true, "mode": "manual", "bus": 9, "source_bus": 1,
    "live": true, "problem": null, "listeners": 12, "captions": false
  }],
  "reachable": true
}
```

`PUT` takes `{"tracks": [...]}` with the settings fields (`language`, `on`, `mode`, `bus`,
`source_bus`) and answers like `GET`. Both buses are kept, so switching modes keeps both choices.
The settings are in `translation.json` in the server's data folder.

## What the automatic mode will add

The design leaves room for it without changing the phones' side:

- **Listening to the source:** the automatic engine joins the source bus's feed at 16 kHz mono,
  the usual input for speech recognition (`audio::listen::Feeds::listen`).
- **A voice:** a synthesized voice plays into a bus, and `Track::sound` returns that bus, so
  phones hear it exactly like an interpreter.
- **Captions:** `Track::captions` turns true, and a captions feed per track goes to the phones
  (and later to a Captions layer on the screens). The `captions` field is already in the
  phones' track list, so the app can show them when they come.
- **More languages:** a line in `translation::LANGUAGES`; the settings get a track for it by
  themselves.
