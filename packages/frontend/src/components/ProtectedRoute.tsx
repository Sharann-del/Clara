import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export function ProtectedRoute() {
  const { loading, idToken } = useAuth();
  if (loading) return <div style={{ padding: 24 }}>Loading…</div>;
  if (!idToken) return <Navigate to="/signin" replace />;
  return <Outlet />;
}
