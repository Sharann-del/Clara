# Realtime collaboration

Clara's live features (presence, cursors, live typing and canvas edits) run over API Gateway's
WebSocket API, three Lambdas and a DynamoDB table. This page describes the protocol, how
conflicts are resolved and the limits that apply. The code is in `packages/api/src/ws` (server)
and `packages/frontend/src/lib/realtimeSocket.ts` (web client); the iOS client is
`ios/Clara/Core/Realtime.swift`.

## Connecting

The client opens **one WebSocket per open document or diagram**:

```
wss://f6g7h8i9j0.execute-api.eu-north-1.amazonaws.com/prod?token=eyJraWQiOi...&resourceType=diagram&resourceId=4f6c2e1a-8b3d-4c5e-9f70-1a2b3c4d5e6f
```

`token` is the user's Cognito ID token, `resourceType` is `document` or `diagram`, and `resourceId`
is the item's UUID.

Browsers can't set headers on a WebSocket handshake, so the ID token travels in the query string.
API Gateway access logging is off, so the token isn't written to logs.

`$connect` (`connect-lambda.ts`):

1. Verifies the ID token (same checks as REST).
2. Loads the item and computes the caller's effective role. No access gives `403`.
3. Enforces the connection limits: at most `wsMaxConnectionsPerUser` open connections per user
   (default 10) and `wsMaxConnectionsPerRoom` per item (default 25). Over either gives `429`.
   Connection rows whose TTL has passed are not counted.
4. Stores the connection in DynamoDB (`connectionId`, `room` such as `diagram#4f6c2e1a-…`, user, email, role,
   TTL of 2 hours 15 minutes) and broadcasts `presence.joined` to the room.

`$connect` never posts to its own connection. API Gateway hasn't finished registering the
connection while `$connect` is still running, so a self-post fails with `GoneException`. Instead
the client sends `presence.sync` as soon as the socket opens.

`$disconnect` deletes the row and broadcasts `presence.left`. Rows whose `$disconnect` never ran
are swept by the DynamoDB TTL.

The role is captured at connect time. If someone's access changes, the new role applies from their
next connection; access checks for anything that loads data over REST happen on every request.

## Messages from the client

Every message is JSON with an `action` field, handled by `$default` (`message-lambda.ts`).

| Action | Fields | Who | Effect |
| --- | --- | --- | --- |
| `presence.sync` | | anyone connected | Replies with `presence.snapshot`: everyone in the room |
| `cursor` | `x`, `y` | anyone connected | Broadcast to the others as `cursor` |
| `element.moving` | `id`, `x`, `y`, `stateId?` | anyone connected (diagrams) | Live drag preview, not saved |
| `element.create` | `element: {id, type, geometry, style, zIndex, linkedDiagramId?}` | editor | Inserts the row, broadcasts `element.created` |
| `element.update` | `id`, any of `geometry`, `style`, `zIndex`, `linkedDiagramId` | editor | Updates only the sent columns, broadcasts `element.updated` |
| `element.delete` | `id` | editor | Deletes the row, broadcasts `element.deleted` |
| `state.override` | `stateId`, `elementId`, `override` (or `null` to clear) | editor | Saves one element's override in a state, broadcasts `state.override` |
| `states.refresh` | | editor | Tells the others to refetch states after a REST change (create, rename, reorder) |
| `diagram.refresh` | | anyone connected | Tells the others to refetch the diagram after a REST bulk replace |
| `document.update` | `contentMd` | editor | Broadcasts live typing as `document.updated`. **Not saved**: documents save over REST |
| `ping` | | anyone | Keep-alive; returns before any database or DynamoDB access |

`element.type` is one of `rect`, `ellipse`, `text`, `connector` or `group`.

## Messages from the server

| Type | Fields |
| --- | --- |
| `presence.snapshot` | `users: [{userId, email}]` |
| `presence.joined` / `presence.left` | `userId`, `email` (joined only) |
| `cursor` | `userId`, `email`, `x`, `y` |
| `element.moving` | `id`, `x`, `y`, `stateId`, `userId` |
| `element.created` / `element.updated` | `element`: the saved database row |
| `element.deleted` | `id` |
| `state.override` | `stateId`, `elementId`, `override`, `userId` |
| `states.refreshed` / `diagram.refreshed` | |
| `document.updated` | `contentMd`, `userId` |
| `error` | `message`, for example `"Editor role required"` or `"Invalid message"` |

`element.created`, `element.updated` and `element.deleted` go to everyone in the room, the sender
included, so every client applies the saved row. The other broadcasts skip the sender.

## What saves where

| Change | Saved by |
| --- | --- |
| Canvas shape create, move, resize, restyle, delete | WebSocket (`element.*`) |
| State overrides from the canvas | WebSocket (`state.override`) |
| Document text | REST `PATCH /documents/:id`, 600 ms after typing stops, on ⌘S and on leaving |
| Code tab apply, Mermaid import, version restore, accepted AI changes | REST bulk replace (`PUT /diagrams/:id/elements`) |
| States (create, rename, reorder, delete) | REST |

This is why canvas drawing needs the deployed WebSocket API, while everything else also works
against a local API.

## Conflict resolution

Clara uses **per-element last-write-wins**, not a CRDT.

- Each element mutation is a single-row SQL statement. Two people editing **different** shapes never
  conflict.
- Two people editing the **same** shape at the same moment: whichever `UPDATE` commits last wins,
  and the other change is lost rather than merged.
- Whole-diagram replacements (code apply, import, restore, accepted AI changes) replace everything
  by design.
- Document text is whole-field last-write-wins on save; the socket only broadcasts live typing.

The reasoning, and what a CRDT (for example Yjs) would cost, is in
[aws-report.md §2.4](aws-report.md#24-last-write-wins-for-realtime). Accepted AI changes have their
own staleness check, so a stale proposal can't silently overwrite newer human edits.

## Staying connected

- API Gateway closes a connection after 10 minutes without traffic and after 2 hours in any case.
- The client sends `{"action":"ping"}` every 4 minutes.
- On an unexpected close it reconnects with exponential backoff and jitter (1 s up to 30 s), and
  immediately when the browser comes back online or the tab becomes visible. A connection that
  stays up for 10 seconds resets the backoff.
- Every attempt fetches a fresh ID token, so an expired token is refreshed rather than retried.
- Messages broadcast while disconnected are lost, so the page refetches the item after reconnecting.

## Limits and costs

| Limit | Default | Setting |
| --- | --- | --- |
| Messages per second, whole API | 100 steady, 200 burst | `wsThrottleRate`, `wsThrottleBurst` |
| Connections per user | 10 | `wsMaxConnectionsPerUser` |
| Connections per document or diagram | 25 | `wsMaxConnectionsPerRoom` |
| Connection lifetime | 2 hours | API Gateway |
| Idle timeout | 10 minutes | API Gateway |

Every message is one Lambda invocation, and fan-out is one `postToConnection` per other person in
the room. Cursor traffic (throttled to one message every 80 ms per moving mouse, about 12 a second) dominates both
cost and Lambda concurrency. On an account with a concurrency limit of 10, a dozen people moving
their mice at once is roughly the ceiling; see
[aws-report.md §5](aws-report.md#5-scalability-and-limits).
