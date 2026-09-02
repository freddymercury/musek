/**
 * YouTube IFrame API. We cannot get audio out of the embed -- it is
 * cross-origin with no CORS on the media -- but we can get getCurrentTime(),
 * which is the piece that matters: it stamps every chord with its position in
 * the song rather than wall-clock, so a second listening pass lines up with
 * the first.
 */

export function parseVideoId(input: string): string | null {
  const trimmed = input.trim();
  if (/^[\w-]{11}$/.test(trimmed)) return trimmed;
  try {
    const url = new URL(trimmed);
    if (url.hostname === 'youtu.be') return url.pathname.slice(1) || null;
    if (url.hostname.endsWith('youtube.com')) {
      const v = url.searchParams.get('v');
      if (v) return v;
      const m = /\/(embed|shorts|live)\/([\w-]{11})/.exec(url.pathname);
      if (m) return m[2];
    }
  } catch {
    return null;
  }
  return null;
}

interface YTPlayer {
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  destroy(): void;
}

declare global {
  interface Window {
    YT?: { Player: new (el: HTMLElement | string, opts: unknown) => YTPlayer; loaded?: number };
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiPromise: Promise<void> | null = null;

function loadApi(): Promise<void> {
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve) => {
    if (window.YT?.Player) return resolve();
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve();
    };
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(tag);
  });
  return apiPromise;
}

export interface PlayerHandle {
  currentTime(): number;
  duration(): number;
  isPlaying(): boolean;
  play(): void;
  pause(): void;
  seek(seconds: number): void;
  destroy(): void;
}

export async function createPlayer(
  container: HTMLElement,
  videoId: string,
  onReady?: () => void,
): Promise<PlayerHandle> {
  await loadApi();

  return new Promise((resolve) => {
    const player = new window.YT!.Player(container, {
      videoId,
      playerVars: { playsinline: 1, modestbranding: 1, rel: 0 },
      events: {
        onReady: () => {
          onReady?.();
          resolve({
            currentTime: () => player.getCurrentTime() ?? 0,
            duration: () => player.getDuration() ?? 0,
            isPlaying: () => player.getPlayerState() === 1,
            play: () => player.playVideo(),
            pause: () => player.pauseVideo(),
            seek: (s: number) => player.seekTo(s, true),
            destroy: () => player.destroy(),
          });
        },
      },
    });
  });
}
