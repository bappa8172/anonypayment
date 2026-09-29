import React from 'react';
import { BrowserRouter, Routes, Route, Navigate, useParams } from 'react-router-dom';
import Landing from './pages/Landing';
import Auth from './pages/Auth';
import Pay from './pages/Pay';
import Dashboard from './pages/Dashboard';
import ErrorBoundary from './components/ErrorBoundary';
import GatewayFlowDemo from '@/components/ui/demo';

function LinkRedirect() {
  const { code } = useParams();
  return <Navigate to={`/pay?link=${encodeURIComponent(code)}`} replace />;
}

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <Routes>
          {/* Main Crypto Payment Gateway Site Index */}
          <Route path="/" element={<Landing />} />

          {/* Auth Pages */}
          <Route path="/login" element={<Auth />} />
          <Route path="/signup" element={<Auth />} />

          {/* Checkout & Payment Page */}
          <Route path="/pay" element={<Pay />} />
          <Route path="/link/:code" element={<LinkRedirect />} />

          {/* Merchant Dashboard */}
          <Route path="/dashboard" element={<Dashboard />} />

          {/* Standalone Demos */}
          <Route path="/demo" element={<GatewayFlowDemo />} />
          <Route path="/flow-demo" element={<GatewayFlowDemo />} />

          {/* Fallback to Index */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
