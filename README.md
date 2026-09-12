# musēk

Play a song. Hear what it's made of.

Paste a YouTube link, let musēk listen to the tab audio, and it maps the song
into chords, a key, and a repeating progression — then lets you play with all
of it, hear the transcription back, and rebuild the actual tone from the
harmonics it measured.

Everything runs in the browser. No audio is uploaded, and nothing is
downloaded from YouTube.

---

## Why it listens instead of downloading

The obvious design — paste a link, fetch the audio, analyse it — doesn't
survive contact with reality:

1. **You cannot analyse a YouTube embed in the browser.** The IFrame player is
   cross-origin and serves no CORS headers on its media, so Web Audio can't
   tap it. There's no workaround.
2. **Server-side means downloading the audio.** That works locally, violates
   YouTube's terms as a public service, and gets datacenter IPs bot-blocked
   within days.
3. **Transcribing a dense mix is genuinely lossy.** Chords, key and tempo are
   achievable. Individual melody lines under drums and distorted guitar are
   not, and promising them would be a lie.

So musēk listens instead. `getDisplayMedia({ audio: true })` captures a
Chrome tab's audio into Web Audio — nothing downloaded, nothing copied, the
same act as holding a microphone to a speaker. The analysis runs on the sound
as it plays.

The piece that makes it more than a live meter: the IFrame API won't give up
its audio, but it *will* give up `getCurrentTime()`. Every chord is stamped
with its position in the song rather than wall-clock, so playing the track a
second time produces a second pass that merges into the first and sharpens
it.

### The extension that isn't built yet

A Chrome extension would use `chrome.tabCapture`, removing the share-picker
step. The stronger reason is that many official music videos are
embed-restricted, and the IFrame approach fails on exactly the songs people
most want. A content script on real `youtube.com` reads
`document.querySelector('video').currentTime` directly, with no embed
involved.

The cost is a store review, a dev fee, no shareable URL, and MV3's offscreen
document dance for audio. So: web app first. The extension replaces exactly
one function — how you get a `MediaStream` — and
`captureViaExtension(streamId)` in `src/capture/source.ts` is the seam,
stubbed with what MV3 needs.

---

## How it works

The theory engine is a direct implementation of the arithmetic in
[Music Theory for Programmers](https://runjs.app/blog/music-theory-for-programmers):
equal temperament as `440 × 2^((n-69)/12)`, scales as step patterns summing to
twelve, chords as semitone offsets, modes as rotations, diatonic triads as
Roman numerals.

The recogniser is that same engine read backwards. Audio becomes a **chroma
vector** — how much energy sits in each of the twelve pitch classes — and
chords are found by matching that vector against the very interval sets that
build them. `[0,4,7]` is how you construct a major triad and how you detect
one.

### Purity

`theory/` and `analysis/` are pure and carry all the reasoning. `capture/`,
`audio/` and `youtube/` own a device or a clock and decide nothing.

| Path | What lives there | Pure? |
| --- | --- | --- |
| `src/theory/` | Pitch, intervals, scales, modes, chords, diatonic harmony | yes |
| `src/analysis/` | Chroma, FFT, detection, timeline, partials, arranging | yes |
| `src/capture/` | Audio sources, listening loop, recording | no |
| `src/audio/` | Playback, transport, resynthesis rendering | mostly |
| `src/youtube/` | IFrame player handle | no |
| `src/ui/` | React components | no |
| `src/testing/` | Renderers, scoring, benchmarks, fake AudioContext | yes |

This isn't decoration. Every hard bug in this project was found by a test
that could only exist because the logic was pure — and the two that took
longest were in the impure parts, where nothing could see them.

---

## What you can do with it

- **Live chord readout** while the song plays, with a chroma meter showing
  what the analyser actually hears.
- **A clickable chord timeline.** Click a segment to seek there and hear it.
- **Detected key**, the song's repeating loop, and that loop written as Roman
  numerals in the detected key.
- **A sortable chord table**, tagging each chord diatonic or borrowed.
- **Play the analysis** — the transcription played back as chords.
- **Rebuild the tone** — the capture resynthesised from its own harmonics.
- **A playground** seeded with the song's key: every diatonic chord coloured
  by function with tension dots, a keyboard highlighting the scale, and
  famous progressions to audition.

---

## Rebuilding the tone

A chord symbol keeps three or four pitch classes and throws away everything
else, so playing one back on a generic wave can never sound like the record
however accurate the label is.

**Rebuild the tone** does the other thing. The capture is decomposed into the
sine waves it is actually made of — frequency and amplitude tracked over time
— and played back from those alone, no chord labels involved. This is the
article's opening premise run in reverse: if a sound is a sum of harmonics,
and timbre is the recipe of those harmonics, then measuring the recipe should
give the tone back.

Measured as spectral distance against the original:

```
  pure sine            -31.5 dB
  sawtooth-ish         -29.4 dB
  square-ish           -28.4 dB
  low note             -27.8 dB
  high note            -30.2 dB
  chord progression    -14.6 dB
  full mix + drums     -14.4 dB
```

Single tones come back very close. Dense mixes are limited by what sinusoids
can represent at all: a drum hit is broadband noise, not a sum of steady
partials. Modelling those properly means splitting the signal into sines,
noise and transients separately — the standard next step, not yet done.

Two details carry most of the quality. Peak frequencies are refined by
parabolic interpolation, because an FFT bin is wider than a semitone at the
bottom of the piano and taking the bin centre detunes everything. And phase
runs continuously across frames — restarting it each hop would put a click in
the output 86 times a second.

The app also **names the timbre**. A sine, triangle, square and sawtooth
differ only in how much of each overtone they contain, so comparing a
recording's measured recipe against those four says which it most resembles.

---

## Playing the analysis

Hearing the transcription is the fastest way to judge it: play it over the
original and the ear finds the disagreements in about four bars.

Chords are voiced for smooth voice leading rather than stacked in root
position, so a progression moves the way a player moves. Each chord sounds at
a volume tracking the analyser's confidence, so a chord the analyser already
doubted sounds faint rather than confidently wrong — which distinguishes "it
was unsure" from "it was confidently mistaken", two very different bugs.

Scheduling is against the AudioContext clock, not `setTimeout`, since timer
jitter is audible as sloppy timing and would read as a transcription error.

---

## Accuracy

Chord recognition is measured, not asserted. `npm run bench` renders
progressions to audio with known ground truth and scores the analyser with
**chord symbol recall**, the metric the music-information-retrieval field
uses: sample estimate and truth on a fine grid, count the fraction of time
they agree, weighted by duration.

```
  clean triads     exact  95.9%   root  95.9%
  + bass           exact  84.7%   root  90.9%
  + inversions     exact  84.1%   root  90.3%
  + heavy drums    exact  83.1%   root  90.2%
  full mix         exact  83.5%   root  89.7%
  detuned 50c      exact  77.2%   root  83.5%
  fast changes     exact  78.1%   root  85.0%
```

Before this benchmark existed, full mix scored 27.4% and detuned audio scored
0.0%. The improvement is entirely due to being able to see what was wrong.

### What the benchmark found

**One loud voice swamped the chroma.** The signature was distinctive: root
recall stayed near 90% while exact recall sat at 27% — right root, wrong
quality, every time. A bass note two octaves down dominated the vector (the
`1/f` weighting *amplifies* low frequencies), so every chord read as a power
chord on the correct root. Log compression fixed it.

**Every major triad read as a major 7th.** A triad's template is a subset of
its seventh's, and the fifth's 5th harmonic plus the third's 3rd harmonic
both land on the major seventh — so a real instrument always produces that
energy, and the larger template always won.

**Detuning was fatal.** Recordings away from A440 — common, and deliberate on
re-uploads — scored 0%. Tuning is now estimated from the audio by taking the
circular mean of how far spectral peaks fall from equal temperament.

### Measuring beat guessing, repeatedly

Every constant here was swept rather than reasoned about, because reasoning
lost every time:

- Harmonic-aware templates, derived from physics, cost **26 points**.
- The first guess at log-compression strength was **100× too aggressive** and
  scored 13.9% where the swept value scores 60.8%.
- Correcting the window's coherent gain took tone reconstruction from -6 dB
  to -31 dB. Without measuring, it was simply "a bit quiet".

The sweeps are committed in `src/testing/sweep.test.ts` as the record of why
each value is what it is.

### A benchmark that lied

The first sweep of the seventh-chord correction reported a beautiful 94.2%.
It was worthless: the corpus contained **no seventh chords**, so it was
rewarding a setting that could never detect one. At the "optimal" value,
seventh recall was exactly 0%.

With sevenths added to the corpus, the real finding is that chroma templates
cannot do both. Triads at ~92% drives sevenths to zero; recovering sevenths
costs about thirty points on triads.

So it's a **hear sevenths** toggle, off by default, with the trade-off stated
rather than hidden. Triads dominate popular music; jazz users turn it on.

### Caveat

These are synthetic signals — a floor and a regression tripwire, not a claim
about real recordings, which will score worse. Validating properly needs
annotated songs; Isophonics and Billboard are the standard corpora, and
`score()` already computes the right metric for them.

---

## Testing the parts that make sound

Playback bugs are invisible to ordinary tests: a transport reports no error
whether it schedules a chord one beat away or two minutes away. Both look
identical from outside, and both are silent in a Node test run.

`src/testing/fakeAudio.ts` is a stand-in AudioContext that records every
oscillator scheduled — frequency, start time, envelope peak, and whether it
actually reaches the destination. That makes playback arithmetic assertable
without a browser, and it immediately caught two bugs that had produced
silence with no error at all:

- Events are stamped in **song time**, so a capture starting two minutes into
  a track scheduled its first chord two minutes in the future. The whole
  arrangement played — just not yet. The test failed with `expected 120.08 to
  be less than 0.5`.
- The player **stopped playback whenever the events array changed identity**,
  which during a live capture is ten times a second. Playback died within a
  tick of starting. The effect was never needed: `play()` schedules the whole
  arrangement upfront, so later changes cannot affect what is already
  sounding.

There's also a **Test tone** button in the UI, which separates "audio output
is broken" from "the analysis is wrong" in one click.

---

# Also in here: Sit in Traffic

A second, entirely unrelated app lives at `/traffic.html`: a game about
driving to the arena through rush hour, from behind your own back bumper,
without hitting anything and without breaking a single rule.

You are late for a show. The car park is 2.4 km away, the doors close in
3:48, and the first thing you see is the boot of the car in front. Between
you and Row D seat 14 there is a queue that is not going anywhere, three sets
of lights, a lane closed for resurfacing, somebody broken down in lane three,
and several hundred people who are also going.

```
↑ W  throttle      ← →  change lane      Q E  indicators
↓ S  brake         V    chase / map      Esc  pause
```

## The one idea

Time is the score, so every rule has to cost time, and **no violation can be
worth committing**. That is not a vibe, it is arithmetic.

Cover distance `d` at `v` where the limit is `L` and you save
`d/L - d/v = d(v-L)/(Lv)` seconds. Charge the fine at `K(v-L)/L` seconds per
second and over that distance you pay `K · d(v-L)/(Lv)` — exactly **K times
what you saved**, for every speed, every distance and every limit.
`speedingNeverPays` in `rules.test.ts` is that sentence as a test.

`K` started at 1.5 and the road disagreed. A route with lights on it has a
second term the fine cannot see: hurry to a light and you sometimes catch a
green you would otherwise have sat at, which is worth a whole cycle and costs
nothing. Driven end to end, 25% over the limit everywhere came out *4 seconds
ahead*. At `K = 3` the fine is bigger than the light:

```
                          driving    fines    into the seat
  race day, lawful         204.5 s    none       204.5 s
  the same driver, +15%    197.9 s    10.8       208.7 s
  the same driver, +25%    197.8 s    19.2       217.0 s
  the same driver, +50%    197.8 s    29.0       226.7 s
```

Every one of those is genuinely faster *driving* and later *arriving*, which
is the whole design in four lines. `the same driver, speeding, arrives later`
drives all four every time the suite runs.

The flat fines are sized the same way: running a red costs 20 s and the
longest red on the route is 13 s; skipping the indicator costs 5 s and saves
the 0.4 s the law asks you to wait.

## Sitting in traffic

The name is the feature. Two stretches of the route are properly bumper to
bumper — the queue you start in and the crawl up to the gate — at about 95
vehicles per kilometre per lane. On race day that opening queue is 25 cars
with a median gap of **5.7 metres**, moving at 16 km/h when it moves at all,
and the first of them is directly in front of you before you have touched
anything.

A jam is only worth sitting in if it ends, so they are stretches rather than
the whole road: 270 of the 2400 metres are solid, which works out at about a
fifth of the run spent inside one. `sitting in traffic` in `sim.test.ts`
asserts both halves — median gap under nine metres in the opening queue, and
under a fifth of the route dense enough to qualify.

Three things make a queue something you can be *in* rather than something you
wait out:

**Lanes are not interchangeable.** The nearside carries the lorries and the
people who are not in a hurry. On top of that each stretch shuffles its own
mix, so which lane is the good one differs from jam to jam and has to be read
rather than remembered.

**Things are broken down in it.** Two of the four blockages on the route are
not roadworks but somebody's morning going wrong, hazards going, sat in a
live lane inside a jam. The simulation treats a breakdown and a coned-off
lane identically — a lane that is not there — and only the renderer knows the
difference.

**Somebody has to let you in.** A closed lane in solid traffic has no gaps in
it by definition, and a merge model that waits for one deadlocks: the lane
stops forever, everything behind it stops forever, and the route cannot be
finished at all. That was the actual first behaviour. Drivers now zip — cones
in sight, crawling, nowhere to go, take what is there — and `a lane blocked
inside a jam still drains` follows seventeen specific cars past a breakdown to
prove it.

### What the jams did to the measurements

Worth writing down because it was not the expected result: **once the traffic
is dense, lane-hopping stops paying.** The autopilot has a dial from patient
to as assertive as the law allows, including reading the average speed of
every lane as far ahead as the car can see. Across eight roads it came out
*1.7 seconds slower on average* — 11 seconds better on one road, 23 seconds
worse on another, and inside a second either way on the rest.

Anyone who has changed lanes in a jam and then watched the lane they left
pull away already knows this. It is the real behaviour of congested traffic
rather than a bug, so par is set against the patient driver, and the honest
edge on offer is elsewhere: the green wave, the car you picked, getting away
from the lights cleanly, and not hitting anything.

## Why obeying the limit is the fast line

The lights are timed as a **green wave**: their offsets come from `paceTo()`,
the arrival time of a driver who clears the opening queue and then sits on
the limit. Hold the limit and every light opens a few seconds before you get
there. Hurry and you arrive early, into a red, and watch the traffic you
overtook queue up behind you.

Two tests hold that in place — `hold the limit and every light is green when
you get there`, and `arrive early, because you hurried, and it is red`.

## The traffic is not scripted

Every AI car runs the Intelligent Driver Model: accelerate towards the speed
you want, back off as the gap to the car in front closes.

```
dv/dt = a[1 - (v/v0)^4 - (want/gap)^2]
```

Jams come out of that on their own, and the stop-start waves in a queue are
nobody's decision. Three details took the most work:

**Drivers want a fraction of the limit, not a fixed speed.** Storing an
absolute desired speed meant a dawdler doing 30 km/h downtown was still doing
30 on a 100 km/h expressway, and walled the fast road with city traffic.

**Two cars will read the same gap in the same frame and both take it.** Lane
changes are decided in order against a list of claims, so a gap belongs to
whoever called it first.

**And IDM does not actually promise cars will not touch.** It models how
people drive; in a dense queue a hard brake leaves two of them briefly inside
one another. On a map that is a couple of pixels nobody sees, and from behind
your own bumper it is two solid objects in the same place. So after everyone
has moved, each lane is walked from the front and anything that ended up
inside the car ahead is pushed back out — corrections under a metre, invisible
in motion, and the player is in the ordering but is never moved. Over a full
run that took overlapping pairs from 525 to zero.

**The AI is not allowed to hit you.** It treats the player as an obstacle in
both the lane it is in and the lane it is moving into, and refuses to merge
anywhere near it. Every collision in the game is therefore the player's,
which is the only way "no collisions" is a fair thing to score somebody on.

## The view from behind the bumper

The road is dead straight, which is the one thing that makes a perspective
view cheap. A straight road projects to a trapezoid, so the whole carriageway
is a single polygon and everything on it is a box drawn at the size its
distance says. No meshes, no depth buffer, no library:

```
scale = focal / distance
x     = w/2     + (worldX - camX)   * scale * w/2
y     = horizon + (camHeight - worldY) * scale * w/2
```

Both axes use `w/2` so pixels stay square, and the horizon is where
everything lands as distance runs to infinity — which is why it is a constant
rather than something that needs computing. Sort the upright things back to
front, fog the far clip, and that is the renderer.

It matters because sitting in a queue is a completely different feeling when
the car in front fills your windscreen instead of being a rectangle two
centimetres away on a map. The map is still there on `V`, and the radar strip
down the side of the dashboard is the same overhead read, out as far as the
car you picked can see.

## Is par actually reachable?

A target nobody can hit without speeding is not a challenge, it is an
instruction to speed — so the game ships with a driver that obeys every rule
in the book, and the tests make it drive.

```
  every car, race-day traffic, clean      204-221 s      par 228
  the same roads, shuffled                195-272 s      your luck varies
```

Every car in the garage beats par on race day without a single violation, and
none of them can crash doing it. That is why the default run is always
race-day traffic: par means nothing against a road that is different every
attempt, so a shuffled road is offered as its own thing.

## The garage

| Car | Its case |
| --- | --- |
| Commuter Hatchback | The average of the others, in every stat |
| Electric Sedan | Torque from rest — the queue is where it wins |
| Sports Coupe | Quickest here; sits so low it sees almost nothing |
| Vintage Roadster | Short and nimble, fits gaps nothing else fits |
| Delivery Van | Slow and awkward, but sees the whole jam coming |

Top speed barely matters when the limit is the limit, so the cars separate on
acceleration out of a queue, on how fast they cross a lane, and on how far up
the road their radar reads. The van is the only one whose sight line reaches
300 m, which is its entire compensation for being the van.

## Where it lives

| Path | What | Pure? |
| --- | --- | --- |
| `src/traffic/cars.ts` | The garage | yes |
| `src/traffic/route.ts` | Zones, lights, closures, the green wave | yes |
| `src/traffic/rules.ts` | The law and what breaking it costs | yes |
| `src/traffic/sim.ts` | Physics, traffic, collisions — `step(sim, input, dt)` | yes |
| `src/traffic/autopilot.ts` | The law-abiding driver | yes |
| `src/traffic/chase.ts` | The view from the car | reads only |
| `src/traffic/render.ts` | The view from above | reads only |
| `src/traffic/ui/` | React screens | no |

Same rule as next door: everything that decides anything is pure. `step()`
takes a world and returns the next one, which is why the tests can drive
thousands of runs a second with no canvas anywhere, why physics runs on a
fixed 1/60 step so the same drive scores the same on a 144 Hz monitor, and
why the menu can quietly run the game behind itself.

---

## Requirements

Tab audio capture needs Chrome or Edge — pick this tab in the share picker
and tick **Also share tab audio**. Every other browser falls back to the
microphone, which works fine for chord detection.

## Develop

```
npm install
npm run dev      # musek at /, the traffic game at /traffic.html
npm test         # 238 tests
npm run bench    # accuracy benchmark and parameter sweeps
```

## Known limits

- Individual melody notes under a dense mix are not attempted.
- Sevenths and triads trade off against each other; see above.
- Tone rebuilding is limited by transients — drums and attacks resist
  sinusoidal modelling. Sines + noise + transients is the fix.
- Benchmark numbers are from synthetic audio. Real recordings will be worse.
- No beat tracking, so chord boundaries land where the chroma changes rather
  than on the beat.
