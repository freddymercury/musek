import { PITCH_CLASSES } from '../theory/pitch';
import { normalize, type Chroma } from '../analysis/chroma';

/** Live view of what the analyser is actually hearing, per pitch class. */
export function ChromaBars({ chroma }: { chroma: Chroma | null }) {
  const values = chroma ? normalize(chroma) : new Float32Array(12);
  return (
    <div className="chroma">
      {PITCH_CLASSES.map((name, i) => (
        <div key={name} className="chroma-col" title={`${name}: ${values[i].toFixed(2)}`}>
          <div className="chroma-bar" style={{ height: `${Math.max(2, values[i] * 100)}%` }} />
          <span className={name.includes('#') ? 'sharp' : ''}>{name}</span>
        </div>
      ))}
    </div>
  );
}
