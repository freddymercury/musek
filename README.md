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

## Playing the analysis

The fastest way to judge a transcription is to hear it. **Play the analysis**
sounds the detected chords back as music, and playing that over the original
tells you in about four bars where the two part company.

Chords are voiced for smooth voice leading rather than stacked in root
position, so the progression moves the way a player would move, and each
chord is sounded at a volume tracking the analyser's confidence -- a chord it
already doubted sounds faint rather than confidently wrong.

Scheduling is against the AudioContext clock, not setTimeout, since timer
jitter is audible as sloppy timing.

## Accuracy

Chord recognition is measured, not asserted. `npm run bench` renders
progressions to audio with known ground truth and scores the analyser with
chord symbol recall, the metric the music-information-retrieval field uses:
sample estimate and truth on a fine grid, count the fraction of time they
agree, weighted by duration.

```
  clean triads     exact  95.9%   root  95.9%
  + bass           exact  84.7%   root  90.9%
  + heavy drums    exact  83.1%   root  90.2%
  full mix         exact  83.5%   root  89.7%
  detuned 50c      exact  77.2%   root  83.5%
  fast changes     exact  78.1%   root  85.0%
```

The benchmark is what found the three things that mattered most, each of
which had been invisible as a vague sense that captures "seemed off":

1. **One loud voice swamped the chroma.** A bass note two octaves down
   dominated the vector, so every chord read as a power chord on the right
   root. Log compression fixed it, and the strength was chosen by sweep -- the
   value guessed first was 100x too aggressive and scored 13%.
2. **Every major triad read as a major 7th.** A triad's template is a subset
   of its seventh's, and the fifth's 5th harmonic lands on the seventh, so the
   larger template always won.
3. **Detuning was fatal.** Recordings not at A440 -- common, and deliberate on
   re-uploads -- scored 0%. Tuning is now estimated from the audio.

These are synthetic signals, so treat them as a floor and a regression
tripwire rather than a claim about real recordings. Validating against real
music needs annotated songs; the Isophonics and Billboard corpora are the
standard sets, and `score()` already computes the right metric for them.

### The sevenths trade-off

Chroma templates cannot do triads and sevenths well at once. The setting that
gets triads to ~92% drives seventh recall to zero; the setting that recovers
sevenths costs about thirty points on triads. Rather than pick silently,
there's a **hear sevenths** toggle. Off by default, since triads dominate
popular music.

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

- Individual melody notes under a dense mix are not attempted yet.
- Sevenths and triads trade off against each other; see above.
- Numbers above are from synthetic audio. Real recordings will be worse.
- A Chrome extension using `chrome.tabCapture` would remove the share-picker
  step and work on embed-restricted videos. `captureViaExtension()` in
  `src/capture/source.ts` is the seam for it.
