import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { authenticateToken } from '../../api/src/lib/tokens.js';
import { createMcpServer } from './tools.js';

const json = (statusCode: number, body: unknown, headers: Record<string, string> = {}): APIGatewayProxyStructuredResultV2 => ({
  statusCode,
  headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify(body),
});

const rpcError = (statusCode: number, code: number, message: string, headers: Record<string, string> = {}) =>
  json(statusCode, { jsonrpc: '2.0', error: { code, message }, id: null }, headers);

/**
 * MCP streamable-HTTP endpoint on Lambda (POST /mcp).
 *
 * Stateless: every POST authenticates its personal access token, builds a fresh
 * McpServer bound to that user, answers with a single JSON response
 * (enableJsonResponse — no SSE stream to hold a Lambda open), and tears down.
 * GET (server-initiated SSE stream) and DELETE (session end) have no meaning
 * without sessions, so they get 405 as the spec allows.
 */
export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
  const method = event.requestContext.http.method;
  if (method !== 'POST') {
    return rpcError(405, -32000, 'Method not allowed: this server is stateless; use POST', { allow: 'POST' });
  }

  const header = event.headers.authorization ?? event.headers.Authorization;
  const raw = header?.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : undefined;
  const auth = raw ? await authenticateToken(raw) : undefined;
  if (!auth) {
    return rpcError(401, -32001, 'Missing, invalid, expired or revoked Clara personal access token', {
      'www-authenticate': 'Bearer realm="clara-mcp"',
    });
  }

  const url = `https://${event.requestContext.domainName}${event.rawPath}${event.rawQueryString ? `?${event.rawQueryString}` : ''}`;
  const body = event.body ? (event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body) : undefined;
  const request = new Request(url, { method, headers: event.headers as Record<string, string>, body });

  const server = createMcpServer({ userId: auth.userId, tokenId: auth.tokenId });
  const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
  try {
    await server.connect(transport);
    const response = await transport.handleRequest(request);
    return {
      statusCode: response.status,
      headers: Object.fromEntries([...(response.headers as unknown as Iterable<[string, string]>)]),
      body: await response.text(),
    };
  } finally {
    await transport.close().catch(() => undefined);
    await server.close().catch(() => undefined);
  }
}
