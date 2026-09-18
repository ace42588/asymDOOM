import type { ActorView } from "./embedTypes.js";

export interface EntityDelta<T extends { id: number }> {
  spawn: T[];
  update: T[];
  despawn: number[];
}

function round(n: number, places = 3): number {
  const p = 10 ** places;
  return Math.round(n * p) / p;
}

function actorKey(a: ActorView): string {
  return JSON.stringify({
    id: a.id,
    kind: a.kind,
    type: a.type,
    typeName: a.typeName,
    x: round(a.x),
    y: round(a.y),
    z: round(a.z),
    angle: round(a.angle, 4),
    health: a.health,
    maxHealth: a.maxHealth,
    controllerSessionId: a.controllerSessionId,
    sprite: a.sprite,
    frame: a.frame,
    flags: a.flags,
  });
}

/** Diff entities against a baseline map (id → serialized). Mutates baseline. */
export function diffEntities<T extends { id: number }>(
  entities: T[],
  baseline: Map<number, string>,
  keyFn: (e: T) => string = (e) => JSON.stringify(e),
): EntityDelta<T> {
  const spawn: T[] = [];
  const update: T[] = [];
  const seen = new Set<number>();
  for (const e of entities) {
    seen.add(e.id);
    const key = keyFn(e);
    const prev = baseline.get(e.id);
    if (prev === undefined) {
      spawn.push(e);
      baseline.set(e.id, key);
    } else if (prev !== key) {
      update.push(e);
      baseline.set(e.id, key);
    }
  }
  const despawn: number[] = [];
  for (const id of baseline.keys()) {
    if (!seen.has(id)) {
      despawn.push(id);
      baseline.delete(id);
    }
  }
  return { spawn, update, despawn };
}

/** Diff actors against a baseline map (id → serialized). Mutates baseline. */
export function diffActors(
  actors: ActorView[],
  baseline: Map<number, string>,
): EntityDelta<ActorView> {
  return diffEntities(actors, baseline, actorKey);
}

export function emptyDelta<T extends { id: number }>(): EntityDelta<T> {
  return { spawn: [], update: [], despawn: [] };
}

export function isEmptyDelta(d: EntityDelta<{ id: number }>): boolean {
  return d.spawn.length === 0 && d.update.length === 0 && d.despawn.length === 0;
}
