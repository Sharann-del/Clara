import { Route, Routes } from 'react-router-dom';
import { ProtectedRoute } from './components/ProtectedRoute';
import { SignInPage } from './pages/SignInPage';
import { SignUpPage } from './pages/SignUpPage';
import { WorkspacesPage } from './pages/WorkspacesPage';
import { WorkspacePage } from './pages/WorkspacePage';
import { DocumentPage } from './pages/DocumentPage';
import { DiagramPage } from './pages/DiagramPage';
import { TokensPage } from './pages/TokensPage';

export default function App() {
  return (
    <Routes>
      <Route path="/signin" element={<SignInPage />} />
      <Route path="/signup" element={<SignUpPage />} />
      <Route element={<ProtectedRoute />}>
        <Route path="/" element={<WorkspacesPage />} />
        <Route path="/workspaces/:workspaceId" element={<WorkspacePage />} />
        <Route path="/documents/:documentId" element={<DocumentPage />} />
        <Route path="/diagrams/:diagramId" element={<DiagramPage />} />
        <Route path="/settings/tokens" element={<TokensPage />} />
      </Route>
    </Routes>
  );
}
