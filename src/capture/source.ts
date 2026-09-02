/**
 * Audio sources. Everything downstream only wants a MediaStream, so the
 * capture mechanism stays swappable -- share-tab-audio in a web page,
 * chrome.tabCapture in an extension, a mic, or a decoded file.
 */

export type SourceKind = 'tab' | 'mic' | 'file' | 'extension';

export interface AudioSource {
  kind: SourceKind;
  stream: MediaStream;
  /** Human-readable label for the UI. */
  label: string;
  stop(): void;
}

export class CaptureError extends Error {
  readonly recoverable: boolean;
  constructor(message: string, recoverable = true) {
    super(message);
    this.name = 'CaptureError';
    this.recoverable = recoverable;
  }
}

/** True when this browser can capture tab audio at all (Chromium only). */
export function supportsTabAudio(): boolean {
  return typeof navigator !== 'undefined'
    && !!navigator.mediaDevices?.getDisplayMedia
    && /Chrome|Chromium|Edg/.test(navigator.userAgent)
    && !/Firefox/.test(navigator.userAgent);
}

/**
 * Capture a tab's audio via the screen-share picker. The user has to choose
 * "Chrome Tab" and tick "Also share tab audio" -- video is requested only
 * because Chrome refuses an audio-only getDisplayMedia call, and the video
 * track is stopped immediately.
 */
export async function captureTab(): Promise<AudioSource> {
  if (!supportsTabAudio()) {
    throw new CaptureError(
      'Tab audio capture needs Chrome or Edge. Use the microphone instead.',
      false,
    );
  }

  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: true,
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    },
  });

  const [audio] = stream.getAudioTracks();
  if (!audio) {
    stream.getTracks().forEach((t) => t.stop());
    throw new CaptureError(
      'No audio in that share. Pick a tab and tick "Also share tab audio".',
    );
  }

  // We only ever wanted the audio; drop the video to save the encode.
  stream.getVideoTracks().forEach((t) => {
    t.stop();
    stream.removeTrack(t);
  });

  return {
    kind: 'tab',
    stream,
    label: audio.label || 'Tab audio',
    stop: () => stream.getTracks().forEach((t) => t.stop()),
  };
}

/** Universal fallback: listen to the room. Works in every browser. */
export async function captureMic(): Promise<AudioSource> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      // All three would fight the music -- they exist to isolate speech.
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    },
  });
  return {
    kind: 'mic',
    stream,
    label: stream.getAudioTracks()[0]?.label || 'Microphone',
    stop: () => stream.getTracks().forEach((t) => t.stop()),
  };
}

/**
 * Tab capture from an extension background context. Left unimplemented here:
 * chrome.tabCapture.getMediaStreamId needs an extension origin, and MV3 has
 * to hand the id to an offscreen document to build the stream. When that
 * wrapper exists it produces the same AudioSource and nothing else changes.
 */
export async function captureViaExtension(streamId: string): Promise<AudioSource> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      // @ts-expect-error -- chrome-only constraint
      mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId },
    },
  });
  return {
    kind: 'extension',
    stream,
    label: 'Tab audio (extension)',
    stop: () => stream.getTracks().forEach((t) => t.stop()),
  };
}
