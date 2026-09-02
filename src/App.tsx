import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPlayer, parseVideoId, type PlayerHandle } from './youtube/player';
import { captureMic, captureTab, supportsTabAudio, CaptureError, type AudioSource } from './capture/source';
import { listen, type Listener } from './capture/listener';
import { detectKeys, type KeyCandidate } from './analysis/detect';
import { smooth, type Chroma } from './analysis/chroma';
import {
  emptyTimeline, observe, prune, mergePasses, commonProgression, changesPerMinute,
  chordAt, type TimelineState, type Segment,
} from './analysis/timeline';
import { diatonicChords } from './theory/chords';
import { ChromaBars } from './ui/ChromaBars';
import { ChordTable } from './ui/ChordTable';
import { Timeline } from './ui/Timeline';
import { KeyExplorer } from './ui/KeyExplorer';
import './App.css';

export default function App() {
  const [url, setUrl] = useState('');
  const [videoId, setVideoId] = useState<string | null>(null);
  const [player, setPlayer] = useState<PlayerHandle | null>(null);
  const [source, setSource] = useState<AudioSource | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [timeline, setTimeline] = useState<TimelineState>(emptyTimeline);
  const [passes, setPasses] = useState<Segment[]>([]);
  const [chroma, setChroma] = useState<Chroma | null>(null);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);

  const mountRef = useRef<HTMLDivElement>(null);
  const listenerRef = useRef<Listener | null>(null);
  const chromaSumRef = useRef<Chroma[]>([]);

  /** Merged view of every pass so far -- the timeline the UI actually shows. */
  const segments = useMemo(
    () => prune(mergePasses(passes, prune(timeline.segments, 0.25))),
    [passes, timeline],
  );

  const key: KeyCandidate | null = useMemo(() => {
    if (!chromaSumRef.current.length) return null;
    return detectKeys(smooth(chromaSumRef.current), 1)[0] ?? null;
  }, [segments.length]);

  const loadVideo = useCallback(async () => {
    const id = parseVideoId(url);
    if (!id) return setError('That does not look like a YouTube link.');
    setError(null);
    setVideoId(id);
  }, [url]);

  useEffect(() => {
    if (!videoId || !mountRef.current) return;
    let handle: PlayerHandle | null = null;
    const mount = document.createElement('div');
    mountRef.current.innerHTML = '';
    mountRef.current.appendChild(mount);
    createPlayer(mount, videoId).then((p) => { handle = p; setPlayer(p); });
    return () => { handle?.destroy(); setPlayer(null); };
  }, [videoId]);

  // Track playback position for the playhead.
  useEffect(() => {
    if (!player) return;
    const t = setInterval(() => {
      setPosition(player.currentTime());
      setDuration(player.duration());
    }, 100);
    return () => clearInterval(t);
  }, [player]);

  const startListening = useCallback(async (kind: 'tab' | 'mic') => {
    setError(null);
    try {
      const src = kind === 'tab' ? await captureTab() : await captureMic();
      setSource(src);

      // Bank the previous pass before starting a new one.
      setPasses((p) => mergePasses(p, prune(timeline.segments, 0.25)));
      setTimeline(emptyTimeline);
      chromaSumRef.current = [];

      // Song position when a player exists, otherwise elapsed wall clock.
      const t0 = performance.now();
      const clock = () => (player ? player.currentTime() : (performance.now() - t0) / 1000);

      listenerRef.current = listen(src, {
        clock,
        onObservation: (obs) => setTimeline((st) => observe(st, obs)),
        onChroma: (c) => {
          setChroma(c);
          const buf = chromaSumRef.current;
          buf.push(c);
          if (buf.length > 600) buf.shift(); // ~60s of context for key detection
        },
      });

      src.stream.getAudioTracks()[0]?.addEventListener('ended', () => stopListening());
    } catch (e) {
      setError(e instanceof CaptureError ? e.message
        : e instanceof Error && e.name === 'NotAllowedError' ? 'Capture was declined.'
        : 'Could not start capture.');
    }
  }, [player, timeline]);

  const stopListening = useCallback(() => {
    listenerRef.current?.stop();
    listenerRef.current = null;
    source?.stop();
    setSource(null);
    setChroma(null);
  }, [source]);

  useEffect(() => () => { listenerRef.current?.stop(); }, []);

  const current = chordAt(segments, position);
  const loop = useMemo(() => commonProgression(segments, 4), [segments]);

  /** The song's loop written as Roman numerals in the detected key. */
  const loopRomans = useMemo(() => {
    if (!key || !loop.length) return [];
    const diatonic = diatonicChords(60 + key.tonic, key.mode === 'major' ? 'major' : 'naturalMinor');
    return loop.map((sym) => diatonic.find((d) => d.symbol === sym)?.roman ?? sym);
  }, [key, loop]);

  return (
    <div className="app">
      <header>
        <h1>mus<span className="e">ē</span>k</h1>
        <p className="tagline">
          Play a song. Hear what it is made of.
        </p>
      </header>

      <section className="load">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && loadVideo()}
          placeholder="Paste a YouTube link"
          spellCheck={false}
        />
        <button onClick={loadVideo}>Load</button>
      </section>

      {error && <p className="error">{error}</p>}

      {videoId && <div className="player" ref={mountRef} />}

      <section className="capture">
        {!source ? (
          <>
            <button
              className="primary"
              onClick={() => startListening('tab')}
              disabled={!supportsTabAudio()}
              title={supportsTabAudio() ? '' : 'Chrome or Edge only'}
            >
              Listen to tab audio
            </button>
            <button className="ghost" onClick={() => startListening('mic')}>
              Listen with microphone
            </button>
            <p className="hint">
              Tab audio: pick this tab in the picker and tick <strong>Also share tab
              audio</strong>. Nothing is uploaded or downloaded — the analysis runs
              here, on the sound as it plays.
            </p>
          </>
        ) : (
          <>
            <button className="stop" onClick={stopListening}>Stop listening</button>
            <span className="listening">● listening to {source.label}</span>
          </>
        )}
      </section>

      {source && (
        <section className="live">
          <div className="now">
            <span className="label">now</span>
            <span className="big">{current?.symbol ?? '—'}</span>
          </div>
          <ChromaBars chroma={chroma} />
        </section>
      )}

      {segments.length > 0 && (
        <>
          <section className="summary">
            <div className="stat">
              <span className="label">key</span>
              <span className="value">{key ? key.name : '—'}</span>
            </div>
            <div className="stat">
              <span className="label">loop</span>
              <span className="value mono">{loop.join(' → ') || '—'}</span>
            </div>
            <div className="stat">
              <span className="label">as numerals</span>
              <span className="value mono">{loopRomans.join(' → ') || '—'}</span>
            </div>
            <div className="stat">
              <span className="label">changes/min</span>
              <span className="value">{changesPerMinute(segments).toFixed(0)}</span>
            </div>
          </section>

          <Timeline
            segments={segments}
            duration={duration}
            position={position}
            onSeek={(s) => player?.seek(s)}
          />

          <ChordTable
            segments={segments}
            tonic={key?.tonic ?? null}
            mode={key?.mode ?? 'major'}
          />
        </>
      )}

      <h3 className="section-title">Play around</h3>
      <KeyExplorer
        suggestedTonic={key?.tonic ?? null}
        suggestedScale={key?.mode === 'minor' ? 'naturalMinor' : 'major'}
      />

      <footer>
        <p>
          Built on the arithmetic in{' '}
          <a href="https://runjs.app/blog/music-theory-for-programmers" target="_blank" rel="noreferrer">
            Music Theory for Programmers
          </a>. Chords are found by matching what you hear against the same
          interval sets that build them.
        </p>
      </footer>
    </div>
  );
}
