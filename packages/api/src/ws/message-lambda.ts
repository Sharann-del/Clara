import { z } from 'zod';
import { query } from '../db.js';
import { roleAtLeast } from '../lib/authz.js';
import { dedupeUsers, getConnection, listRoomConnections } from './dynamo.js';
import { elementOverrideSchema, setElementOverride } from '../lib/states.js';
import { broadcastToRoom, postTo } from './broadcast.js';

/**
 * Conflict resolution for diagram_elements (PRD open design question): plain
 * last-write-wins, per element, no CRDT/OT.
 *
 * Each element mutation (`element.create/update/delete`) is a single-row SQL
 * statement against `diagram_elements`, not a whole-array replace. Two users
 * editing *different* elements in the same diagram never conflict — each
 * statement touches only its own row. Two users editing the *same* element
 * concurrently do conflict, and Postgres's normal row-level serialization
 * decides it: whichever UPDATE commits last simply overwrites the earlier
 * one, and the loser's change is gone (not merged, not queued as a
 * conflict to resolve).
 *
 * Why not a CRDT: correct concurrent-edit merging (e.g. Yjs) needs a shared
 * CRDT document, an awareness protocol, and a persistence format that isn't
 * a plain Postgres row per element — a lot of surface area for a student
 * project where the realistic case is 2-3 people in a room, rarely dragging
 * the exact same shape in the exact same instant. Per-element LWW gets you
 * "my edits don't clobber your edits to other shapes" for free (the common
 * case), and only degrades to "one of us loses a rare simultaneous edit to
 * the same shape" in the rare case — an acceptable tradeoff here, revisit if
 * this becomes a real multi-editor product.
 *
 * Note the bulk `PUT /diagrams/:id/elements` REST endpoint (routes/diagrams.ts)
 * is intentionally exempt from this: DSL apply / Mermaid import / version
 * restore are deliberate whole-diagram replacements, not concurrent partial
 * edits, so a coarser last-writer-replaces-everything is the correct
 * semantics for those, not a bug. Document body edits (`document.update`) are
 * simpler still: broadcast-only over the socket for live viewing, with the
 * existing debounced REST PATCH remaining the sole persistence path — no
 * per-field merge, whole-field LWW on save.
 */
interface WsMessageEvent {
  requestContext: { connectionId: string };
  body?: string;
}

const messageSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('cursor'), x: z.number(), y: z.number() }),
  z.object({
    action: z.literal('element.create'),
    element: z.object({
      id: z.string().uuid(),
      type: z.enum(['rect', 'ellipse', 'text', 'connector', 'group']),
      geometry: z.record(z.unknown()).default({}),
      style: z.record(z.unknown()).default({}),
      zIndex: z.number().default(0),
      linkedDiagramId: z.string().uuid().nullish(),
    }),
  }),
  // Ephemeral, unpersisted — a live preview of a drag/resize in progress.
  z.object({ action: z.literal('element.moving'), id: z.string(), x: z.number(), y: z.number(), stateId: z.string().uuid().nullish() }),
  z.object({
    action: z.literal('element.update'),
    id: z.string(),
    geometry: z.record(z.unknown()).optional(),
    style: z.record(z.unknown()).optional(),
    zIndex: z.number().optional(),
    linkedDiagramId: z.string().uuid().nullish().optional(),
  }),
  z.object({ action: z.literal('element.delete'), id: z.string() }),
  // Sent right after the client's WS opens — $connect can't safely postToConnection
  // to itself (see connect-lambda.ts), so the client asks for its snapshot here instead.
  z.object({ action: z.literal('presence.sync') }),
  // Per-element override within a diagram state (PRD 4.7). Granular + persisted here
  // because it's edited as often as elements are; same per-element LWW model.
  z.object({
    action: z.literal('state.override'),
    stateId: z.string().uuid(),
    elementId: z.string().uuid(),
    override: elementOverrideSchema.nullable(),
  }),
  // Sent after REST state CRUD/reorder (states are rarely edited, so they use the
  // REST routes for persistence) so other viewers refetch the state list.
  z.object({ action: z.literal('states.refresh') }),
  // Sent after a bulk REST replace (DSL apply / Mermaid import / version restore)
  // so other connected viewers know to refetch rather than trust their local state.
  z.object({ action: z.literal('diagram.refresh') }),
  // Broadcast-only — content_md persistence still goes through the REST PATCH;
  // see packages/api/src/routes/documents.ts and the realtime design note there.
  z.object({ action: z.literal('document.update'), contentMd: z.string() }),
]);

async function deny(connectionId: string) {
  await postTo(connectionId, { type: 'error', message: 'Editor role required' });
  return { statusCode: 200 };
}

/** Client keep-alive (API Gateway's idle timeout is 10 minutes): traffic alone resets it, nothing to do or reply. */
const isPing = (body: string | undefined) => body !== undefined && body.length < 64 && /^\s*\{\s*"action"\s*:\s*"ping"\s*\}\s*$/.test(body);

export async function handler(event: WsMessageEvent) {
  if (isPing(event.body)) return { statusCode: 200 };
  const connectionId = event.requestContext.connectionId;
  const conn = await getConnection(connectionId);
  if (!conn) return { statusCode: 200 };

  let msg: z.infer<typeof messageSchema>;
  try {
    msg = messageSchema.parse(JSON.parse(event.body ?? '{}'));
  } catch {
    await postTo(connectionId, { type: 'error', message: 'Invalid message' });
    return { statusCode: 200 };
  }

  if (msg.action === 'presence.sync') {
    const members = await listRoomConnections(conn.room);
    await postTo(connectionId, { type: 'presence.snapshot', users: dedupeUsers(members) });
    return { statusCode: 200 };
  }

  const canEdit = roleAtLeast(conn.role, 'editor');

  switch (msg.action) {
    case 'cursor': {
      await broadcastToRoom(
        conn.room,
        { type: 'cursor', userId: conn.userId, email: conn.email, x: msg.x, y: msg.y },
        connectionId,
      );
      break;
    }

    case 'element.moving': {
      if (conn.resourceType === 'diagram') {
        await broadcastToRoom(
          conn.room,
          { type: 'element.moving', id: msg.id, x: msg.x, y: msg.y, stateId: msg.stateId ?? null, userId: conn.userId },
          connectionId,
        );
      }
      break;
    }

    case 'element.create': {
      if (!canEdit || conn.resourceType !== 'diagram') return deny(connectionId);
      const el = msg.element;
      const { rows } = await query(
        `insert into diagram_elements (id, diagram_id, type, geometry, style, z_index, linked_diagram_id)
         values ($1, $2, $3, $4, $5, $6, $7) returning *`,
        [el.id, conn.resourceId, el.type, JSON.stringify(el.geometry), JSON.stringify(el.style), el.zIndex, el.linkedDiagramId ?? null],
      );
      await broadcastToRoom(conn.room, { type: 'element.created', element: rows[0] });
      break;
    }

    case 'element.update': {
      if (!canEdit || conn.resourceType !== 'diagram') return deny(connectionId);
      const sets: string[] = [];
      const values: unknown[] = [];
      if (msg.geometry !== undefined) {
        values.push(JSON.stringify(msg.geometry));
        sets.push(`geometry = $${values.length}`);
      }
      if (msg.style !== undefined) {
        values.push(JSON.stringify(msg.style));
        sets.push(`style = $${values.length}`);
      }
      if (msg.zIndex !== undefined) {
        values.push(msg.zIndex);
        sets.push(`z_index = $${values.length}`);
      }
      if (msg.linkedDiagramId !== undefined) {
        values.push(msg.linkedDiagramId);
        sets.push(`linked_diagram_id = $${values.length}`);
      }
      if (sets.length === 0) break;
      values.push(msg.id);
      const idIdx = values.length;
      values.push(conn.resourceId);
      const diagramIdx = values.length;

      // Plain UPDATE, no explicit version/lock check: Postgres serializes concurrent
      // writes to the same row, so whichever UPDATE commits last simply wins —
      // last-write-wins per element. See documents.ts for the fuller writeup.
      const { rows } = await query(
        `update diagram_elements set ${sets.join(', ')} where id = $${idIdx} and diagram_id = $${diagramIdx} returning *`,
        values,
      );
      if (rows[0]) await broadcastToRoom(conn.room, { type: 'element.updated', element: rows[0] });
      break;
    }

    case 'element.delete': {
      if (!canEdit || conn.resourceType !== 'diagram') return deny(connectionId);
      await query('delete from diagram_elements where id = $1 and diagram_id = $2', [msg.id, conn.resourceId]);
      await broadcastToRoom(conn.room, { type: 'element.deleted', id: msg.id });
      break;
    }

    case 'state.override': {
      if (!canEdit || conn.resourceType !== 'diagram') return deny(connectionId);
      const state = await setElementOverride(conn.resourceId, msg.stateId, msg.elementId, msg.override);
      if (state) {
        await broadcastToRoom(conn.room, {
          type: 'state.override',
          stateId: msg.stateId,
          elementId: msg.elementId,
          override: msg.override,
          userId: conn.userId,
        });
      }
      break;
    }

    case 'states.refresh': {
      if (!canEdit || conn.resourceType !== 'diagram') return deny(connectionId);
      await broadcastToRoom(conn.room, { type: 'states.refreshed' }, connectionId);
      break;
    }

    case 'diagram.refresh': {
      await broadcastToRoom(conn.room, { type: 'diagram.refreshed' }, connectionId);
      break;
    }

    case 'document.update': {
      if (!canEdit || conn.resourceType !== 'document') return deny(connectionId);
      await broadcastToRoom(
        conn.room,
        { type: 'document.updated', contentMd: msg.contentMd, userId: conn.userId },
        connectionId,
      );
      break;
    }
  }

  return { statusCode: 200 };
}
