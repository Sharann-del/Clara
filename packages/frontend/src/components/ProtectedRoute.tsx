import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { PageLoading } from './PageLoading';

export function ProtectedRoute() {
  const { loading, idToken } = useAuth();
  const location = useLocation();
  if (loading) return <PageLoading />;
  if (!idToken) {
    const next = `${location.pathname}${location.search}${location.hash}`;
    return <Navigate to={`/signin?next=${encodeURIComponent(next)}`} replace />;
  }
  return <Outlet />;
}
