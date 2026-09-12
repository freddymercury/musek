import { useCallback, useState } from 'react';
import type { CarSpec } from '../cars';
import { ARENA_ROUTE } from '../route';
import { total, type Sim } from '../sim';
import { Garage } from './Garage';
import { Game } from './Game';
import { Results } from './Results';

const STORE = 'musek.traffic.bests.v1';

function loadBests(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(STORE) ?? '{}') as Record<string, number>;
  } catch {
    return {};
  }
}

function saveBests(bests: Record<string, number>): void {
  try {
    localStorage.setItem(STORE, JSON.stringify(bests));
  } catch {
    // A locked-down browser costs you the leaderboard, not the game.
  }
}

interface Run {
  car: CarSpec;
  seed: number;
  /** Bumped to force a fresh Game, so "again" really does start again. */
  attempt: number;
}

export function TrafficApp() {
  const [run, setRun] = useState<Run | null>(null);
  const [result, setResult] = useState<Sim | null>(null);
  const [bests, setBests] = useState(loadBests);

  const finish = useCallback((sim: Sim) => {
    setResult(sim);
    if (sim.crashed || !sim.finished) return;
    const score = total(sim);
    setBests((prev) => {
      if (prev[sim.car.id] !== undefined && prev[sim.car.id] <= score) return prev;
      const next = { ...prev, [sim.car.id]: score };
      saveBests(next);
      return next;
    });
  }, []);

  const drive = useCallback((car: CarSpec, shuffle: boolean) => {
    setResult(null);
    setRun({ car, seed: shuffle ? 1 + Math.floor(Math.random() * 100000) : ARENA_ROUTE.raceDay, attempt: 0 });
  }, []);

  if (!run) return <Garage bests={bests} onDrive={drive} />;

  return (
    <>
      <Game
        key={`${run.car.id}-${run.seed}-${run.attempt}`}
        car={run.car}
        seed={run.seed}
        onFinish={finish}
      />
      {result && (
        <div className="sheet">
          <Results
            sim={result}
            best={bests[run.car.id]}
            onAgain={() => {
              setResult(null);
              setRun({ ...run, attempt: run.attempt + 1 });
            }}
            onShuffle={() => {
              setResult(null);
              setRun({ ...run, seed: 1 + Math.floor(Math.random() * 100000), attempt: run.attempt + 1 });
            }}
            onGarage={() => {
              setResult(null);
              setRun(null);
            }}
          />
        </div>
      )}
    </>
  );
}
