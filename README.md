# musēk

Play a song. Hear what it's made of.

Paste a YouTube link, let musēk listen to the tab audio, and it maps the song
into chords, a key, and a repeating progression — then lets you play with all
of it on a keyboard.

Everything runs in the browser. No audio is uploaded, and nothing is
downloaded from YouTube: the app analyses the sound as it plays, the same way
holding a microphone up to a speaker would.

## How it works

The theory engine is a direct implementation of the arithmetic in
[Music Theory for Programmers](https://runjs.app/blog/music-theory-for-programmers):
equal temperament as `440 × 2^((n-69)/12)`, scales as step patterns that sum
to twelve, chords as semitone offsets, modes as rotations.

The recogniser is that same engine read backwards. Audio becomes a **chroma
vector** — how much energy sits in each of the twelve pitch classes — and
chords are found by matching that vector against the very interval sets that
build them. `[0,4,7]` is how you construct a major triad and how you detect
one.

Two other pieces make it work on real songs:

- **Song time, not wall clock.** The YouTube IFrame API won't give up its
  audio, but it will give up `getCurrentTime()`. Every chord is stamped with
  its position in the song, so playing the track a second time produces a
  second pass that merges into the first and sharpens it.
- **A pure timeline.** Observations fold into segments through functions that
  take state and return state. Merging passes, pruning noise, and finding the
  loop are all folds over data, which is why they're straightforward to test.
- **Captures are kept.** Every listening session is recorded, so you can play
  back exactly what the analyser heard — and re-read it offline. The offline
  pass owns its own FFT, so it sees every sample at whatever hop we ask for
  instead of whatever frames the event loop happened to deliver. It's a pure
  function from samples to observations, and it merges into the timeline as
  another pass rather than replacing it.

## Layout

| Path | What lives there | Pure? |
| --- | --- | --- |
| `src/theory/` | Pitch, intervals, scales, modes, chords, diatonic harmony | yes |
| `src/analysis/` | Chroma, FFT, chord/key detection, timeline, time mapping | yes |
| `src/capture/` | Audio sources, the listening loop, recording | no |
| `src/audio/` | Web Audio playback | no |
| `src/youtube/` | IFrame player handle | no |
| `src/ui/` | React components | no |

All the reasoning is in the pure half and covered by tests. The impure modules
own a device or a clock and make no decisions.

## Requirements

Tab audio capture needs Chrome or Edge — pick this tab in the share picker and
tick **Also share tab audio**. Every other browser falls back to the
microphone, which works fine for chord detection.

## Develop

```
npm install
npm run dev
npm test
```

## Known limits

- Chord detection is solid; individual melody notes under a dense mix are not
  attempted yet.
- Heavily distorted or percussion-dominated material confuses the chroma.
- A Chrome extension using `chrome.tabCapture` would remove the share-picker
  step and work on embed-restricted videos. `captureViaExtension()` in
  `src/capture/source.ts` is the seam for it.
