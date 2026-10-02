import type pg from 'pg';
import { z } from 'zod';
import { query } from '../db.js';

/**
 * Per-element override for one diagram state (PRD 4.7). Anything omitted falls
 * through to the base diagram element. `geometry`/`style` are partial: only the
 * keys that differ from the base are stored.
 */
export const elementOverrideSchema = z.object({
  hidden: z.boolean().optional(),
  geometry: z.record(z.unknown()).optional(),
  style: z.record(z.unknown()).optional(),
});

export type ElementOverrides = Record<string, z.infer<typeof elementOverrideSchema>>;

type Db = Pick<pg.PoolClient, 'query'>;
const defaultDb: Db = { query: ((text: string, params?: unknown[]) => query(text, params ?? [])) as Db['query'] };

export async function listStates(diagramId: string, db: Db = defaultDb) {
  const { rows } = await db.query(
    'select * from diagram_states where diagram_id = $1 order by order_index, created_at',
    [diagramId],
  );
  return rows;
}

export async function createState(diagramId: string, name: string, db: Db = defaultDb) {
  const { rows } = await db.query(
    `insert into diagram_states (diagram_id, name, order_index)
     values ($1, $2, coalesce((select max(order_index) + 1 from diagram_states where diagram_id = $1), 0))
     returning *`,
    [diagramId, name],
  );
  return rows[0];
}

/**
 * Sets (or clears, with `null`) the override for ONE element in ONE state as a
 * single-statement jsonb edit, so concurrent edits to different elements of the
 * same state never clobber each other — same per-element last-write-wins model
 * as diagram_elements (see ws/message-lambda.ts).
 */
export async function setElementOverride(
  diagramId: string,
  stateId: string,
  elementId: string,
  override: z.infer<typeof elementOverrideSchema> | null,
  db: Db = defaultDb,
) {
  const { rows } =
    override === null || Object.keys(override).length === 0
      ? await db.query(
          `update diagram_states set element_overrides = element_overrides - $3::text
           where id = $1 and diagram_id = $2 returning *`,
          [stateId, diagramId, elementId],
        )
      : await db.query(
          `update diagram_states
           set element_overrides = jsonb_set(element_overrides, array[$3::text], $4::jsonb, true)
           where id = $1 and diagram_id = $2 returning *`,
          [stateId, diagramId, elementId, JSON.stringify(override)],
        );
  return rows[0];
}
