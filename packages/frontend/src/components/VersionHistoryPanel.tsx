import { useEffect, useState } from 'react';
import { api, type VersionSummary } from '../lib/api';

interface Props {
  resourceKind: 'document' | 'diagram';
  resourceId: string;
  onRestored: () => void;
}

export function VersionHistoryPanel({ resourceKind, resourceId, onRestored }: Props) {
  const [versions, setVersions] = useState<VersionSummary[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  function load() {
    const fn = resourceKind === 'document' ? api.documentVersions : api.diagramVersions;
    fn(resourceId).then(setVersions);
  }

  useEffect(load, [resourceKind, resourceId]);

  async function restore(versionId: string) {
    setBusy(versionId);
    try {
      const fn = resourceKind === 'document' ? api.restoreDocumentVersion : api.restoreDiagramVersion;
      await fn(resourceId, versionId);
      onRestored();
      load();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="panel" style={{ width: 260 }}>
      <strong style={{ fontSize: 13 }}>Version history</strong>
      {versions.length === 0 && <p className="muted">No saved versions yet.</p>}
      {versions.map((v) => (
        <div key={v.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: 12 }}>
          <span>{new Date(v.created_at).toLocaleString()}</span>
          <button className="btn" disabled={busy === v.id} onClick={() => restore(v.id)}>
            {busy === v.id ? '…' : 'Restore'}
          </button>
        </div>
      ))}
    </div>
  );
}
