import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { Dialog } from './Dialog';

interface ConfirmOptions {
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

interface PromptOptions {
  title: string;
  message?: ReactNode;
  label: string;
  defaultValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  /** Return an error message to keep the dialog open. */
  validate?: (value: string) => string | undefined;
}

interface Api {
  confirm: (o: ConfirmOptions) => Promise<boolean>;
  prompt: (o: PromptOptions) => Promise<string | null>;
}

const Ctx = createContext<Api | undefined>(undefined);

type Pending =
  | { kind: 'confirm'; opts: ConfirmOptions; resolve: (v: boolean) => void }
  | { kind: 'prompt'; opts: PromptOptions; resolve: (v: string | null) => void };

/** In-app replacements for window.confirm / window.prompt, as promises. */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | undefined>();
  const pendingRef = useRef<Pending | null>(null);
  pendingRef.current = pending;

  const confirm = useCallback(
    (opts: ConfirmOptions) => new Promise<boolean>((resolve) => setPending({ kind: 'confirm', opts, resolve })),
    [],
  );
  const prompt = useCallback(
    (opts: PromptOptions) =>
      new Promise<string | null>((resolve) => {
        setValue(opts.defaultValue ?? '');
        setError(undefined);
        setPending({ kind: 'prompt', opts, resolve });
      }),
    [],
  );

  function close(result: boolean) {
    const p = pendingRef.current;
    if (!p) return;
    if (p.kind === 'prompt') {
      if (result) {
        const v = value.trim();
        const err = p.opts.validate?.(v) ?? (v ? undefined : 'Enter a value');
        if (err) {
          setError(err);
          return;
        }
        p.resolve(v);
      } else p.resolve(null);
    } else p.resolve(result);
    setPending(null);
  }

  const o = pending?.opts;
  return (
    <Ctx.Provider value={{ confirm, prompt }}>
      {children}
      <Dialog
        open={!!pending}
        onClose={() => close(false)}
        title={o?.title ?? ''}
        description={o?.message}
        size="sm"
        initialFocusSelector={
          pending?.kind === 'prompt'
            ? 'input'
            : pending?.opts && (pending.opts as ConfirmOptions).danger
              ? '.dialog-footer .btn:not(.btn-danger-solid)'
              : '.dialog-footer .btn-primary'
        }
        footer={
          <>
            <button type="button" className="btn" onClick={() => close(false)}>
              {(o as ConfirmOptions | undefined)?.cancelLabel ?? 'Cancel'}
            </button>
            <button
              type="button"
              className={`btn ${pending?.kind === 'confirm' && pending.opts.danger ? 'btn-danger-solid' : 'btn-primary'}`}
              onClick={() => close(true)}
            >
              {o?.confirmLabel ?? 'OK'}
            </button>
          </>
        }
      >
        {pending?.kind === 'prompt' && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              close(true);
            }}
          >
            <label className="field">
              {pending.opts.label}
              <input
                className="input"
                value={value}
                placeholder={pending.opts.placeholder}
                onChange={(e) => {
                  setValue(e.target.value);
                  setError(undefined);
                }}
                aria-invalid={!!error}
                aria-describedby={error ? 'prompt-error' : undefined}
                maxLength={300}
              />
            </label>
            {error && (
              <div id="prompt-error" className="error-text" role="alert" style={{ marginTop: 6 }}>
                {error}
              </div>
            )}
          </form>
        )}
      </Dialog>
    </Ctx.Provider>
  );
}

export function useConfirm() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useConfirm must be used within ConfirmProvider');
  return ctx;
}
