import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Header from './components/Header';
import GuestManager from './pages/GuestManager';
import ConstraintManager from './pages/ConstraintManager';
import TableManager from './pages/TableManager';
import SeatingPlanViewer from './pages/SeatingPlanViewer';
import SavedSettings from './pages/SavedSettings';
import PrivacyPolicy from './pages/PrivacyPolicy';
import TermsOfService from './pages/TermsOfService';
import AuthCallback from './pages/AuthCallback';
import PremiumSuccess from './pages/PremiumSuccess';
import PremiumCancel from './pages/PremiumCancel';
import Account from './pages/Account';
import BetaCodeAdmin from './pages/BetaCodeAdmin';
import AdminDashboard from './pages/AdminDashboard';
import { AppProvider } from './context/AppContext';
import Footer from './components/Footer';
import DeploymentStatusCheck from './components/DeploymentStatusCheck';
import ErrorBoundary from './components/ErrorBoundary';
import FallbackPage from './components/FallbackPage';

function App() {
  const [envConfigured, setEnvConfigured] = useState(false);

  // Check if environment variables are configured
  useEffect(() => {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
    
    // Check if both Supabase URL and Anon Key are defined and not empty strings
    const isConfigured = 
      typeof supabaseUrl === 'string' && 
      supabaseUrl.trim() !== '' && 
      typeof supabaseAnonKey === 'string' && 
      supabaseAnonKey.trim() !== '';
    
    setEnvConfigured(isConfigured);
  }, []);

  // If environment variables are not configured, show the fallback page
  if (!envConfigured) {
    return <FallbackPage />;
  }

  return (
    <ErrorBoundary>
      <Router>
        <AppProvider>
          <div className="min-h-screen bg-[#dde1e3] flex flex-col">
            <Header />
            <main className="flex-grow container mx-auto px-4 py-6">
              <Routes>
                <Route path="/" element={<GuestManager />} />
                <Route path="/constraints" element={<ConstraintManager />} />
                <Route path="/tables" element={<TableManager />} />
                <Route path="/seating" element={<SeatingPlanViewer />} />
                <Route path="/saved-settings" element={<SavedSettings />} />
                <Route path="/privacy" element={<PrivacyPolicy />} />
                <Route path="/terms" element={<TermsOfService />} />
                <Route path="/auth/callback" element={<AuthCallback />} />
                <Route path="/premium/success" element={<PremiumSuccess />} />
                <Route path="/premium/cancel" element={<PremiumCancel />} />
                <Route path="/account" element={<Account />} />
                <Route path="/admin/beta-codes" element={<BetaCodeAdmin />} />
                <Route path="/admin/dashboard" element={<AdminDashboard />} />
              </Routes>
            </main>
            <Footer />
            <DeploymentStatusCheck />
          </div>
        </AppProvider>
      </Router>
    </ErrorBoundary>
  );
}

export default App;