import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z, ZodError } from 'zod';
import { query } from '../../api/src/db.js';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../../api/src/lib/authz.js';
import { getDocument, listDocuments } from '../../api/src/lib/documents.js';
import {
  getDiagram,
  getDiagramRow,
  getDiagramSource,
  listDiagrams,
  toApiElement,
  traverseHierarchy,
} from '../../api/src/lib/diagrams.js';
import {
  liveDiagramFields,
  listOwnProposals,
  proposeDiagramCreate,
  proposeDiagramUpdate,
  proposeDocumentCreate,
  proposeDocumentUpdate,
  type Actor,
  type PendingChangeRow,
} from '../../api/src/lib/pending.js';
import { layoutToElements, parseMermaid, type DiagramElement } from '@clara/shared/dsl';
import { applyElementOps, applyTextEdits } from './element-ops.js';

const uuid = z.string().uuid();

const elementInput = z.object({
  id: uuid.optional().describe('Omit for new elements; one is assigned.'),
  type: z.enum(['rect', 'ellipse', 'text', 'connector', 'group']),
  geometry: z
    .record(z.unknown())
    .describe(
      'Shapes (rect/ellipse/group/text): {x, y, width, height, text}. Connectors: preferably {fromId, toId, text} referencing two shape ids (the arrow follows the shapes and exports to Mermaid exactly), or free {x1, y1, x2, y2, text} in absolute canvas coordinates.',
    ),
  style: z.record(z.unknown()).default({}).describe('e.g. {fill: "#eff6ff", stroke: "#2563eb"}'),
  zIndex: z.number().int().default(0),
  linkedDiagramId: uuid.nullish().describe('C4 drill-down: the child diagram this shape opens.'),
  parentGroupId: uuid.nullish(),
});

const elementPatch = z.object({
  id: uuid,
  type: z.enum(['rect', 'ellipse', 'text', 'connector', 'group']).optional(),
  geometry: z.record(z.unknown()).optional().describe('Merged into existing geometry; send only the keys that change.'),
  style: z.record(z.unknown()).optional().describe('Merged into existing style.'),
  zIndex: z.number().int().optional(),
  linkedDiagramId: uuid.nullable().optional().describe('Set to link a child diagram; null to unlink.'),
  parentGroupId: uuid.nullable().optional(),
});

const summaryField = z
  .string()
  .max(500)
  .optional()
  .describe('One sentence for the human reviewer explaining why you are proposing this change.');

const PENDING_NOTE =
  'Nothing has been changed yet: the proposal is saved for a human to review in the Clara web app (Pending changes) and applies only when they accept it.';

function ok(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

function fail(err: unknown) {
  let message: string;
  if (err instanceof ZodError) {
    message = `Invalid input: ${err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`;
  } else if (
    err instanceof ForbiddenError ||
    err instanceof NotFoundError ||
    err instanceof BadRequestError ||
    err instanceof ConflictError
  ) {
    message = err.message;
  } else {
    // Not one of our typed errors: log for CloudWatch, don't leak details to the client.
    console.error('mcp tool error', err);
    message = 'Internal error';
  }
  return { isError: true, content: [{ type: 'text' as const, text: message }] };
}

function proposed(change: PendingChangeRow) {
  return {
    status: 'pending_review',
    changeId: change.id,
    operation: change.operation,
    resourceType: change.resource_type,
    note: PENDING_NOTE,
  };
}

/** Wraps a tool body so thrown domain errors come back as MCP tool errors instead of protocol errors. */
const guard =
  <A>(fn: (args: A) => Promise<unknown>) =>
  async (args: A) => {
    try {
      return ok(await fn(args));
    } catch (err) {
      return fail(err);
    }
  };

/**
 * Builds a per-request MCP server bound to one authenticated user. Reads go
 * straight through the same services the REST API uses (workspace roles enforced
 * there); every write only *proposes* a pending_mcp_changes row.
 */
export function createMcpServer(actor: Actor): McpServer {
  const server = new McpServer(
    { name: 'clara', version: '0.1.0' },
    {
      instructions:
        'Clara is a system-design documentation tool (markdown documents + diagrams with C4 drill-down). ' +
        'Start with list_workspaces. All writes (create/update/import) are staged as pending changes that a human must accept in the Clara UI; they are not applied immediately, so do not assume a write took effect until read_* shows it.',
    },
  );
  const uid = actor.userId;
  const READ = { readOnlyHint: true, openWorldHint: false } as const;
  const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const;

  server.registerTool(
    'list_workspaces',
    {
      title: 'List workspaces',
      description: 'Workspaces you are a member of, with your role in each.',
      annotations: READ,
    },
    guard(async () => {
      const { rows } = await query(
        `select w.id, w.name, m.role from workspaces w join workspace_members m on m.workspace_id = w.id
          where m.user_id = $1 order by w.name`,
        [uid],
      );
      return rows;
    }),
  );

  // ------------------------------------------------------------ documents
  server.registerTool(
    'list_documents',
    {
      title: 'List documents',
      description: 'Documents in a workspace (id, title, tags, folder) without their content.',
      inputSchema: { workspace_id: uuid, folder_id: uuid.optional() },
      annotations: READ,
    },
    guard(async ({ workspace_id, folder_id }) => listDocuments(uid, workspace_id, folder_id)),
  );

  server.registerTool(
    'read_document',
    {
      title: 'Read document',
      description: 'Full markdown content and metadata of a document.',
      inputSchema: { document_id: uuid },
      annotations: READ,
    },
    guard(async ({ document_id }) => {
      const d = await getDocument(uid, document_id, 'viewer');
      return {
        id: d.id,
        workspaceId: d.workspace_id,
        folderId: d.folder_id,
        title: d.title,
        tags: d.tags,
        contentMd: d.content_md,
        updatedAt: d.updated_at,
      };
    }),
  );

  server.registerTool(
    'create_document',
    {
      title: 'Propose a new document',
      description: `Propose a new markdown document. ${PENDING_NOTE}`,
      inputSchema: {
        workspace_id: uuid,
        title: z.string().min(1).max(300),
        content_md: z.string().default(''),
        tags: z.array(z.string()).default([]),
        folder_id: uuid.optional(),
        summary: summaryField,
      },
      annotations: WRITE,
    },
    guard(async (a) =>
      proposed(
        await proposeDocumentCreate(
          actor,
          a.workspace_id,
          { title: a.title, contentMd: a.content_md, tags: a.tags, folderId: a.folder_id },
          a.summary,
        ),
      ),
    ),
  );

  server.registerTool(
    'update_document',
    {
      title: 'Propose a document edit',
      description: `Propose changes to an existing document. Provide content_md to replace the whole body, or text_edits for targeted find/replace edits (each find must match exactly once). ${PENDING_NOTE}`,
      inputSchema: {
        document_id: uuid,
        title: z.string().min(1).max(300).optional(),
        content_md: z.string().optional().describe('Full replacement body. Mutually exclusive with text_edits.'),
        text_edits: z.array(z.object({ find: z.string(), replace: z.string() })).optional(),
        tags: z.array(z.string()).optional(),
        summary: summaryField,
      },
      annotations: WRITE,
    },
    guard(async (a) => {
      if (a.content_md !== undefined && a.text_edits)
        throw new BadRequestError('Provide content_md or text_edits, not both');
      let contentMd = a.content_md;
      if (a.text_edits)
        contentMd = applyTextEdits((await getDocument(uid, a.document_id, 'editor')).content_md, a.text_edits);
      if (contentMd === undefined && a.title === undefined && a.tags === undefined) {
        throw new BadRequestError('Nothing to change: provide title, content_md, text_edits or tags');
      }
      return proposed(
        await proposeDocumentUpdate(actor, a.document_id, { title: a.title, contentMd, tags: a.tags }, a.summary),
      );
    }),
  );

  // ------------------------------------------------------------ diagrams
  server.registerTool(
    'list_diagrams',
    {
      title: 'List diagrams',
      description: 'Diagrams in a workspace (id, name, tags, parent_diagram_id) without their elements.',
      inputSchema: { workspace_id: uuid, folder_id: uuid.optional() },
      annotations: READ,
    },
    guard(async ({ workspace_id, folder_id }) =>
      (await listDiagrams(uid, workspace_id, folder_id)).map((d) => ({
        id: d.id,
        name: d.name,
        tags: d.tags,
        folderId: d.folder_id,
        parentDiagramId: d.parent_diagram_id,
        updatedAt: d.updated_at,
      })),
    ),
  );

  server.registerTool(
    'read_diagram',
    {
      title: 'Read diagram',
      description:
        'A diagram with all its elements (shapes, connectors, groups; geometry/style; linkedDiagramId for C4 drill-down), its source text (Clara DSL or Mermaid), and its direct child diagrams.',
      inputSchema: { diagram_id: uuid },
      annotations: READ,
    },
    guard(async ({ diagram_id }) => {
      const d = await getDiagram(uid, diagram_id);
      const [source, children] = await Promise.all([
        getDiagramSource(uid, diagram_id),
        query('select id, name from diagrams where parent_diagram_id = $1 order by name', [diagram_id]),
      ]);
      return {
        id: d.id,
        workspaceId: d.workspace_id,
        name: d.name,
        tags: d.tags,
        folderId: d.folder_id,
        parentDiagramId: d.parent_diagram_id,
        elements: d.elements.map(toApiElement),
        source: { format: source.format, text: source.dsl_text },
        childDiagrams: children.rows,
      };
    }),
  );

  server.registerTool(
    'create_diagram',
    {
      title: 'Propose a new diagram',
      description: `Propose a new diagram, optionally with initial elements and as a child of another diagram (C4 drill-down). To build one from Mermaid text use import_mermaid instead. ${PENDING_NOTE}`,
      inputSchema: {
        workspace_id: uuid,
        name: z.string().min(1).max(300),
        parent_diagram_id: uuid.optional(),
        folder_id: uuid.optional(),
        tags: z.array(z.string()).default([]),
        elements: z.array(elementInput).default([]),
        summary: summaryField,
      },
      annotations: WRITE,
    },
    guard(async (a) =>
      proposed(
        await proposeDiagramCreate(
          actor,
          a.workspace_id,
          {
            name: a.name,
            parentDiagramId: a.parent_diagram_id,
            folderId: a.folder_id,
            tags: a.tags,
            elements: a.elements,
          },
          a.summary,
        ),
      ),
    ),
  );

  server.registerTool(
    'update_diagram',
    {
      title: 'Propose a diagram edit',
      description: `Propose changes to a diagram: rename/retag/re-parent it, and add, modify (merge-patch by element id) or remove elements. Read the diagram first to get element ids. ${PENDING_NOTE}`,
      inputSchema: {
        diagram_id: uuid,
        name: z.string().min(1).max(300).optional(),
        tags: z.array(z.string()).optional(),
        parent_diagram_id: uuid
          .nullable()
          .optional()
          .describe('Re-parent under another diagram, or null for top level.'),
        add_elements: z.array(elementInput).optional(),
        update_elements: z.array(elementPatch).optional(),
        remove_element_ids: z.array(uuid).optional(),
        summary: summaryField,
      },
      annotations: WRITE,
    },
    guard(async (a) => {
      const hasElementOps = a.add_elements || a.update_elements || a.remove_element_ids;
      if (!hasElementOps && a.name === undefined && a.tags === undefined && a.parent_diagram_id === undefined) {
        throw new BadRequestError('Nothing to change');
      }
      await getDiagramRow(uid, a.diagram_id, 'editor');
      let elements: DiagramElement[] | undefined;
      if (hasElementOps) {
        const current = (await liveDiagramFields(a.diagram_id))!.elements;
        elements = applyElementOps(current, {
          add: a.add_elements as DiagramElement[] | undefined,
          update: a.update_elements,
          removeIds: a.remove_element_ids,
        });
      }
      return proposed(
        await proposeDiagramUpdate(
          actor,
          a.diagram_id,
          {
            name: a.name,
            tags: a.tags,
            ...(a.parent_diagram_id !== undefined ? { parentDiagramId: a.parent_diagram_id } : {}),
            elements,
          },
          a.summary,
        ),
      );
    }),
  );

  server.registerTool(
    'traverse_diagram_hierarchy',
    {
      title: 'Traverse C4 hierarchy',
      description:
        "Walk the C4 drill-down tree from a diagram: ancestors (parent chain, root first) and/or descendants (child diagrams, via parent_diagram_id or a shape's drill-down link), up to max_depth levels.",
      inputSchema: {
        diagram_id: uuid,
        direction: z.enum(['up', 'down', 'both']).default('both'),
        max_depth: z.number().int().min(1).max(10).default(5),
      },
      annotations: READ,
    },
    guard(async ({ diagram_id, direction, max_depth }) => traverseHierarchy(uid, diagram_id, direction, max_depth)),
  );

  server.registerTool(
    'import_mermaid',
    {
      title: 'Propose a Mermaid import',
      description:
        "Convert Mermaid flowchart source into Clara canvas elements (auto-laid-out with Dagre) and propose it either as a new diagram (give workspace_id + name) or as a full replacement of an existing diagram's elements (give diagram_id). Supports flowchart/graph edges like `A[Label] --> B[Label]` and `A -->|text| B`; other Mermaid diagram types are not supported. " +
        PENDING_NOTE,
      inputSchema: {
        mermaid_source: z.string().min(1).max(100_000),
        diagram_id: uuid.optional().describe("Replace this existing diagram's contents."),
        workspace_id: uuid.optional().describe('For a new diagram.'),
        name: z.string().min(1).max(300).optional().describe('For a new diagram.'),
        parent_diagram_id: uuid.optional().describe('For a new diagram: nest it under this one.'),
        summary: summaryField,
      },
      annotations: WRITE,
    },
    guard(async (a) => {
      if (!a.diagram_id && !(a.workspace_id && a.name)) {
        throw new BadRequestError(
          'Provide diagram_id (replace an existing diagram) or workspace_id + name (new diagram)',
        );
      }
      const graph = parseMermaid(a.mermaid_source);
      if (graph.nodes.length === 0) {
        throw new BadRequestError(
          'No nodes could be parsed. Expected a Mermaid flowchart such as: flowchart TD\\n  A[Web] --> B[API]',
        );
      }
      const elements = layoutToElements(graph);
      const source = { dslText: a.mermaid_source, format: 'mermaid' as const };
      const change = a.diagram_id
        ? await proposeDiagramUpdate(actor, a.diagram_id, { elements, source }, a.summary)
        : await proposeDiagramCreate(
            actor,
            a.workspace_id!,
            { name: a.name, parentDiagramId: a.parent_diagram_id, elements, source },
            a.summary,
          );
      return { ...proposed(change), parsed: { nodes: graph.nodes.length, edges: graph.edges.length } };
    }),
  );

  // ------------------------------------------------------------ review status
  server.registerTool(
    'list_my_proposals',
    {
      title: 'List my proposed changes',
      description: 'Your recent proposals in a workspace and whether each is still pending, accepted or rejected.',
      inputSchema: { workspace_id: uuid },
      annotations: READ,
    },
    guard(async ({ workspace_id }) =>
      (await listOwnProposals(uid, workspace_id)).map((c) => ({
        changeId: c.id,
        status: c.status,
        operation: c.operation,
        resourceType: c.resource_type,
        resourceId: c.resource_id,
        summary: c.summary,
        createdAt: c.created_at,
        reviewedAt: c.reviewed_at,
      })),
    ),
  );

  return server;
}
