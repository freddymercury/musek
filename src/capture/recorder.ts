import { anchor, emptyTimeMap, identityTimeMap, type TimeMap } from '../analysis/timemap';
import { toMono } from '../analysis/offline';

/**
 * Records a capture so it can be played back and re-analysed. Impure edge: it
 * owns a MediaRecorder and a timer, and hands back plain data.
 */

export interface Recording {
  blob: Blob;
  url: string;
  /** Seconds of audio captured. */
  duration: number;
  /** Recording time to song time, for lining up with the timeline. */
  timeMap: TimeMap;
  label: string;
}

export interface Recorder {
  stop(): Promise<Recording>;
}

function pickMimeType(): string {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
  ];
  return candidates.find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
}

export function record(
  stream: MediaStream,
  opts: { clock?: () => number; label?: string } = {},
): Recorder {
  const { clock, label = 'Capture' } = opts;

  const mimeType = pickMimeType();
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks: BlobPart[] = [];
  const started = performance.now();

  let map: TimeMap = clock ? emptyTimeMap : identityTimeMap;

  // Sample both clocks so a mid-capture seek does not desync the timeline.
  const sampler = clock
    ? setInterval(() => {
        map = anchor(map, {
          recording: (performance.now() - started) / 1000,
          song: clock(),
        });
      }, 500)
    : null;

  if (clock) map = anchor(map, { recording: 0, song: clock() });

  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };
  recorder.start(1000);

  return {
    stop() {
      return new Promise<Recording>((resolve) => {
        if (sampler !== null) clearInterval(sampler);
        recorder.onstop = () => {
          const blob = new Blob(chunks, { type: mimeType || 'audio/webm' });
          resolve({
            blob,
            url: URL.createObjectURL(blob),
            duration: (performance.now() - started) / 1000,
            timeMap: map,
            label,
          });
        };
        if (recorder.state !== 'inactive') recorder.stop();
        else recorder.onstop?.(new Event('stop'));
      });
    },
  };
}

/** Decode a recording to mono samples for offline analysis. */
export async function decode(
  recording: Recording,
): Promise<{ samples: Float32Array; sampleRate: number }> {
  const ac = new AudioContext();
  try {
    const buffer = await ac.decodeAudioData(await recording.blob.arrayBuffer());
    const channels = Array.from(
      { length: buffer.numberOfChannels },
      (_, i) => buffer.getChannelData(i),
    );
    return { samples: toMono(channels), sampleRate: buffer.sampleRate };
  } finally {
    void ac.close();
  }
}
