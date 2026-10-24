import { Menu } from './ui/Menu';
import { Icon } from './ui/Icon';
import { useTheme, type ThemePreference } from '../context/ThemeContext';

const LABELS: Record<ThemePreference, string> = { system: 'System', light: 'Light', dark: 'Dark' };

export function ThemeMenu({ className = 'btn btn-ghost btn-icon' }: { className?: string }) {
  const { preference, resolved, setPreference } = useTheme();
  return (
    <Menu
      className={className}
      label={`Theme: ${LABELS[preference]}`}
      trigger={<Icon name={preference === 'system' ? 'monitor' : resolved === 'dark' ? 'moon' : 'sun'} />}
      items={(['system', 'light', 'dark'] as const).map((p) => ({
        label: `${LABELS[p]}${preference === p ? '  ✓' : ''}`,
        icon: p === 'system' ? 'monitor' : p === 'dark' ? 'moon' : 'sun',
        onSelect: () => setPreference(p),
      }))}
    />
  );
}
