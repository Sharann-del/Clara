import test from 'node:test';
import assert from 'node:assert/strict';
import { embeddedDiagramIds } from './public.js';

const A = '3f0c8f8e-5f0a-4a3b-9e57-0d7a2a1f1c42';
const B = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

test('embeddedDiagramIds finds each embedded diagram once, case-insensitively', () => {
  const md = `# Doc\n\n\`\`\`clara-diagram\nid: ${A.toUpperCase()}\nheight: 300\n\`\`\`\n\ntext\n\n\`\`\`clara-diagram\nheight: 200\nid: ${B}\n\`\`\`\n\n\`\`\`clara-diagram\nid: ${A}\n\`\`\``;
  assert.deepEqual(embeddedDiagramIds(md), [A, B]);
});

test('embeddedDiagramIds ignores ids outside clara-diagram blocks and malformed ids', () => {
  const md = `id: ${A}\n\n\`\`\`js\nid: ${B}\n\`\`\`\n\n\`\`\`clara-diagram\nid: not-a-uuid\n\`\`\``;
  assert.deepEqual(embeddedDiagramIds(md), []);
});
