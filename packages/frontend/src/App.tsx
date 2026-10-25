import { lazy, Suspense, useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { ProtectedRoute } from './components/ProtectedRoute';
import { useAuth } from './context/AuthContext';
import { LandingPage } from './pages/site/LandingPage';
import { PageLoading } from './components/PageLoading';
import { ErrorBoundary } from './components/ErrorBoundary';
import { CommandPaletteProvider } from './components/CommandPalette';

// Public marketing pages stay in the main bundle (they're what first-time visitors load);
// the playground and the signed-in app are split out.
const PlaygroundPage = lazy(() => import('./pages/PlaygroundPage').then((m) => ({ default: m.PlaygroundPage })));
const PricingPage = lazy(() => import('./pages/site/PricingPage').then((m) => ({ default: m.PricingPage })));
const AboutPage = lazy(() => import('./pages/site/AboutPage').then((m) => ({ default: m.AboutPage })));
const DocsPage = lazy(() => import('./pages/site/DocsPage').then((m) => ({ default: m.DocsPage })));
const PrivacyPage = lazy(() => import('./pages/site/LegalPages').then((m) => ({ default: m.PrivacyPage })));
const TermsPage = lazy(() => import('./pages/site/LegalPages').then((m) => ({ default: m.TermsPage })));
const NotFoundPage = lazy(() => import('./pages/site/NotFoundPage').then((m) => ({ default: m.NotFoundPage })));
const SignInPage = lazy(() => import('./pages/SignInPage').then((m) => ({ default: m.SignInPage })));
const SignUpPage = lazy(() => import('./pages/SignUpPage').then((m) => ({ default: m.SignUpPage })));
const HomePage = lazy(() => import('./pages/HomePage').then((m) => ({ default: m.HomePage })));
const SettingsPage = lazy(() => import('./pages/SettingsPage').then((m) => ({ default: m.SettingsPage })));
const PublicViewPage = lazy(() => import('./pages/PublicViewPage').then((m) => ({ default: m.PublicViewPage })));
const WorkspacePage = lazy(() => import('./pages/WorkspacePage').then((m) => ({ default: m.WorkspacePage })));
const DocumentPage = lazy(() => import('./pages/DocumentPage').then((m) => ({ default: m.DocumentPage })));
const DiagramPage = lazy(() => import('./pages/DiagramPage').then((m) => ({ default: m.DiagramPage })));
const TokensPage = lazy(() => import('./pages/TokensPage').then((m) => ({ default: m.TokensPage })));
const ShortcutsPage = lazy(() => import('./pages/ShortcutsPage').then((m) => ({ default: m.ShortcutsPage })));

/** `/` is always the landing page; signed-in visitors get "Open Clara" in its header. */
function RootRoute() {
  return <LandingPage />;
}

/** Move focus to the new page's main region on navigation, so screen readers announce it. */
function useRouteFocus() {
  const { pathname } = useLocation();
  useEffect(() => {
    const main = document.querySelector<HTMLElement>('#main');
    if (main && document.activeElement === document.body) main.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }, [pathname]);
}

/** Signed-in area: ⌘K palette, shortcut sheet. */
function AppArea() {
  return (
    <CommandPaletteProvider>
      <ProtectedRoute />
    </CommandPaletteProvider>
  );
}

export default function App() {
  useRouteFocus();
  const { pathname } = useLocation();
  return (
    <ErrorBoundary resetKey={pathname}>
    <Suspense fallback={<PageLoading />}>
      <Routes>
        <Route path="/" element={<RootRoute />} />
        <Route path="/editor" element={<PlaygroundPage />} />
        <Route path="/pricing" element={<PricingPage />} />
        <Route path="/about" element={<AboutPage />} />
        <Route path="/docs" element={<DocsPage />} />
        <Route path="/docs/:section" element={<DocsPage />} />
        <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="/terms" element={<TermsPage />} />
        <Route path="/signin" element={<SignInPage />} />
        <Route path="/signup" element={<SignUpPage />} />
        <Route path="/s/:token" element={<PublicViewPage />} />
        <Route element={<AppArea />}>
          <Route path="/app" element={<HomePage />} />
          <Route path="/settings" element={<SettingsPage />} />
          {/* Sub-pages (/share, /history, /members, /pending) render inside these so editor state survives. */}
          <Route path="/workspaces/:workspaceId/*" element={<WorkspacePage />} />
          <Route path="/documents/:documentId/*" element={<DocumentPage />} />
          <Route path="/diagrams/:diagramId/*" element={<DiagramPage />} />
          <Route path="/settings/tokens" element={<TokensPage />} />
          <Route path="/shortcuts" element={<ShortcutsPage />} />
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
    </ErrorBoundary>
  );
}
