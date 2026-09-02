/**
 * Mapping between recording time and song time.
 *
 * Observations are stamped in song time so passes merge, but a recording
 * plays back in its own time starting at zero. Those differ by more than an
 * offset: if you pause, seek, or replay the video mid-capture, the recording
 * keeps rolling while song time jumps around.
 *
 * So we sample both clocks periodically and interpolate between the anchors.
 * Pure throughout -- the recorder collects anchors, this decides what they mean.
 */

export interface Anchor {
  /** Seconds since the recording started. */
  recording: number;
  /** Position in the song at that moment. */
  song: number;
}

export interface TimeMap {
  anchors: readonly Anchor[];
}

export const emptyTimeMap: TimeMap = { anchors: [] };

/** A recording with no song behind it: the two clocks are the same. */
export const identityTimeMap: TimeMap = { anchors: [{ recording: 0, song: 0 }] };

/** Add an anchor, keeping them ordered by recording time. Pure. */
export function anchor(map: TimeMap, a: Anchor): TimeMap {
  const anchors = [...map.anchors, a].sort((x, y) => x.recording - y.recording);
  return { anchors };
}

/**
 * Song position at a given point in the recording.
 *
 * Between two anchors we interpolate, but only when song time advanced at
 * roughly the same rate as recording time. A seek makes song time leap while
 * recording time crawls, and interpolating across that would invent positions
 * the song never played, so we hold the earlier anchor instead.
 */
export function toSongTime(map: TimeMap, recordingTime: number): number {
  const { anchors } = map;
  if (!anchors.length) return recordingTime;
  if (anchors.length === 1) return anchors[0].song + (recordingTime - anchors[0].recording);

  if (recordingTime <= anchors[0].recording) return anchors[0].song;

  for (let i = 1; i < anchors.length; i++) {
    const prev = anchors[i - 1];
    const next = anchors[i];
    if (recordingTime > next.recording) continue;

    const dRec = next.recording - prev.recording;
    const dSong = next.song - prev.song;
    if (dRec <= 0) return next.song;

    // Playing forward at about 1x? Interpolate. Otherwise a seek or a pause
    // happened, and the honest answer is "it was still at the last anchor".
    const rate = dSong / dRec;
    if (rate < 0.5 || rate > 1.5) return prev.song;

    return prev.song + (recordingTime - prev.recording) * rate;
  }

  const last = anchors[anchors.length - 1];
  return last.song + (recordingTime - last.recording);
}

/** The inverse: where in the recording a song position was captured. Pure. */
export function toRecordingTime(map: TimeMap, songTime: number): number | null {
  const { anchors } = map;
  if (!anchors.length) return songTime;

  for (let i = 1; i < anchors.length; i++) {
    const prev = anchors[i - 1];
    const next = anchors[i];
    if (songTime < Math.min(prev.song, next.song) || songTime > Math.max(prev.song, next.song)) {
      continue;
    }
    const dSong = next.song - prev.song;
    if (dSong <= 0) return prev.recording;
    return prev.recording + ((songTime - prev.song) / dSong) * (next.recording - prev.recording);
  }

  const first = anchors[0];
  const last = anchors[anchors.length - 1];
  if (songTime < first.song) return null;
  return last.recording + (songTime - last.song);
}
