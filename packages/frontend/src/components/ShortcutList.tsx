import { SHORTCUTS } from '../lib/shortcuts';

export function ShortcutList({ headingLevel = 2 }: { headingLevel?: 2 | 3 }) {
  const H = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <div className="shortcut-groups">
      {SHORTCUTS.map((g) => (
        <section key={g.title} className="shortcut-group">
          <H>{g.title}</H>
          <table className="shortcut-table">
            <tbody>
              {g.items.map((s) => (
                <tr key={s.action}>
                  <td className="shortcut-keys">
                    {s.keys.map((k, i) => (
                      <kbd key={i}>{k}</kbd>
                    ))}
                  </td>
                  <td>{s.action}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  );
}
