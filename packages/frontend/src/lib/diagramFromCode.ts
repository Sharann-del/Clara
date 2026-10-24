import { layoutToElements, parseClaraDsl, parseMermaid, type DiagramElement, type ParseIssue } from '@clara/shared/dsl';
import type { CodeFormat } from './share';

export interface CompiledDiagram {
  elements: DiagramElement[];
  nodeCount: number;
  edgeCount: number;
  issues: ParseIssue[];
}

/** Clara DSL or Mermaid text -> laid-out canvas elements plus any lines the parser skipped. */
export function compileDiagram(code: string, format: CodeFormat): CompiledDiagram {
  const issues: ParseIssue[] = [];
  const graph = format === 'mermaid' ? parseMermaid(code, issues) : parseClaraDsl(code, issues);
  return { elements: layoutToElements(graph), nodeCount: graph.nodes.length, edgeCount: graph.edges.length, issues };
}

export function describeCompile(c: CompiledDiagram): string {
  const base = `${c.nodeCount} node${c.nodeCount === 1 ? '' : 's'} · ${c.edgeCount} edge${c.edgeCount === 1 ? '' : 's'}`;
  if (c.issues.length === 0) return base;
  const first = c.issues[0];
  return `Line ${first.line}: ${first.message}${c.issues.length > 1 ? ` (+${c.issues.length - 1} more)` : ''}`;
}
