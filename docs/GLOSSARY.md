# Words OpenPres uses

One word for each thing, in the app, the docs and the code comments. When something new
needs a name, add it here first. The "Not" column lists the words not to use for it, usually
because they already mean something else.

## Computers and people

| Word | What it is | Not |
|---|---|---|
| **Server** | The computer running OpenPres Server: it has the displays, the sound and the stream. | host, main computer |
| **Manager** | The app (or a browser) the operators use to control a server. | client, controller |
| **Mode** | Which part of the manager an operator works in: **Stage**, **Livestream**, **Jack of all trades** (both) or **Admin** (everything, and the general settings). | role, profile |
| **Stage operator**, **Livestream operator** | Whoever uses the manager in that mode. | audience operator, stream operator |

## Screens

| Word | What it is | Not |
|---|---|---|
| **Display** | A physical screen, projector or TV connected to the server. The Screens page lists them under *Physical displays*; **Identify** shows each one's number on it. | monitor, output |
| **Virtual screen** (or just **screen**) | What gets shown: a set of layers, a background and a mask. It goes on a display, or nowhere (then it's only seen in previews). | output, view |
| **Monitoring screen** | A kind of virtual screen that shows other screens side by side, for a confidence or monitoring display. The other kind is a plain **screen**, which shows its layers. In the code they're `monitor` and `audience`; the old `stage` kind was the same as `audience` and loads as one. | stage screen |
| **Layer** | One of the things stacked on a screen, top to bottom: **Props**, **Announcements**, **Bible**, **Slides**, **Media**, **Video input**. Each screen turns each one on or off. | |
| **Screen preset** | A named set of layers and designs (*Audience*, *Stream*…) that switches a screen with one click. | profile, scene |
| **Clear group** | A button that clears several layers at once. | |

## What's shown

| Word | What it is | Not |
|---|---|---|
| **Theme** | A set of slide **designs**. A presentation, a screen or the Bible picks a design from one. | template, style |
| **Props** | Graphics on the Props layer (logos, lower thirds, clocks). They come in **props collections**; each collection is for the **Stage** (the room's screens) or the **Livestream**, and each screen's Props layer shows Stage props, Livestream props or both. | complements (a second props layer that was merged into this one; old files still load) |
| **Mask** | Drawn on top of everything on a screen, e.g. to hide part of a projector image. | overlay |
| **Presentation** | Anything with slides: songs are presentations too. The Songs page has libraries and playlists of them. | |

## Sound and the stream

| Word | What it is | Not |
|---|---|---|
| **Input**, **bus**, **output** | The mixer on the Audio page: inputs go into buses, buses go to outputs (sound devices) and to the stream. *Output* only means a sound output. | |
| **Stream** | What goes out to YouTube or another service, made on the **Stream** page. **Recording** is the same picture saved to a file. | broadcast, live (the page was called Live before) |

## Time

| Word | What it is | Not |
|---|---|---|
| **Service** | A weekly or special service on the Services page; timers can count down to it. | event, meeting |
| **Timer** | Counts down (from a length, to a time of day, or to a service) or up. | clock |
| **Macro** | A list of steps that runs from a click, a shortcut or a Stream Deck key, or by itself some minutes before a service or when a presentation begins or ends. | action, script |
