import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type PendingChange } from '../lib/api';
import { ChangeDiff } from './ChangeDiff';

interface Props {
  workspaceId: string;
  /** Called after accept/reject so the parent can refresh its badge and resource lists. */
  onChanged: () => void;
}

export function PendingChangesPanel({ workspaceId, onChanged }: Props) {
  const [changes, setChanges] = useState<PendingChange[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    () => api.listPendingChanges(workspaceId).then(setChanges).catch((e) => setError(e.message)),
    [workspaceId],
  );
  useEffect(() => {
    load();
  }, [load]);

  async function review(change: PendingChange, action: 'accept' | 'reject', force = false) {
    if (
      force &&
      !window.confirm(
        'This resource changed after the change was proposed. Accepting will overwrite those newer edits with the proposal (the current state is kept in version history). Continue?',
      )
    ) {
      return;
    }
    setBusy(change.id);
    setErrors((e) => ({ ...e, [change.id]: '' }));
    try {
      if (action === 'accept') await api.acceptPendingChange(change.id, force);
      else await api.rejectPendingChange(change.id);
      await load();
      onChanged();
    } catch (e) {
      setErrors((prev) => ({ ...prev, [change.id]: (e as Error).message }));
      await load(); // the change may have been reviewed elsewhere, or gone stale
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="panel" style={{ marginBottom: 16 }}>
      <strong>Pending changes from AI assistants</strong>
      <p className="muted" style={{ margin: '4px 0 8px' }}>
        Nothing below has been applied yet. Accept applies it and saves the previous state to version history; Reject discards it.
      </p>
      {error && <div className="error-text">{error}</div>}
      {changes?.length === 0 && <p className="muted">Nothing waiting for review.</p>}
      {changes?.map((c) => (
        <div className="change-card" key={c.id}>
          <div className="change-head">
            <div>
              <span className="tag">{c.operation === 'create' ? 'new' : 'edit'} {c.resource_type}</span>{' '}
              {c.operation === 'update' && c.resource_id ? (
                <Link to={`/${c.resource_type}s/${c.resource_id}`}>{c.resource_name ?? 'Untitled'}</Link>
              ) : (
                <strong>{c.resource_name ?? 'Untitled'}</strong>
              )}
              <div className="muted" style={{ fontSize: 12 }}>
                proposed {new Date(c.created_at).toLocaleString()}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
              <button className="btn btn-primary" disabled={busy === c.id} onClick={() => review(c, 'accept')}>
                Accept
              </button>
              <button className="btn btn-danger" disabled={busy === c.id} onClick={() => review(c, 'reject')}>
                Reject
              </button>
            </div>
          </div>
          {c.summary && <div className="change-summary">“{c.summary}”</div>}
          {c.stale && (
            <div className="change-warn">
              {c.current === null
                ? 'The target was deleted after this was proposed.'
                : 'This resource changed after the proposal; the diff below is against its current state.'}{' '}
              {c.current !== null && (
                <button className="btn" disabled={busy === c.id} onClick={() => review(c, 'accept', true)}>
                  Accept anyway…
                </button>
              )}
            </div>
          )}
          <ChangeDiff change={c} />
          {errors[c.id] && <div className="error-text">{errors[c.id]}</div>}
        </div>
      ))}
    </div>
  );
}
