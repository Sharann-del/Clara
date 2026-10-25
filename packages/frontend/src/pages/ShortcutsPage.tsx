import { AppShell } from '../components/AppShell';
import { ShortcutList } from '../components/ShortcutList';
import { SubPage } from '../components/ui/SubPage';
import { usePageMeta } from '../lib/seo';

export function ShortcutsPage() {
  usePageMeta('Keyboard shortcuts', { noindex: true });
  return (
    <AppShell title={<strong>Keyboard shortcuts</strong>}>
      <SubPage
        title="Keyboard shortcuts"
        description="Press ? anywhere in the app to come back here."
        backTo="/app"
        size="lg"
      >
        <ShortcutList headingLevel={2} />
      </SubPage>
    </AppShell>
  );
}
