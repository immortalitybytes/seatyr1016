import React from 'react';
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
import ErrorBoundary from './components/ErrorBoundary';

function App() {
  // Simple environment check to prevent blank screen
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  
  const isConfigured = 
    typeof supabaseUrl === 'string' && 
    supabaseUrl.trim() !== '' && 
    typeof supabaseAnonKey === 'string' && 
    supabaseAnonKey.trim() !== '';

  // If environment variables are not configured, show a simple message
  if (!isConfigured) {
    return (
      <div className="min-h-screen bg-[#dde1e3] flex items-center justify-center p-4">
        <div className="bg-white rounded-lg shadow-md p-6 max-w-lg w-full">
          <h1 className="text-2xl font-bold text-[#7973BB] mb-4">Seatyr - Configuration Needed</h1>
          <div className="bg-[#88abc6] border border-[#88abc6] rounded-md p-4 mb-6">
            <h2 className="text-lg font-semibold text-white mb-2">Missing Environment Configuration</h2>
            <p className="text-white">
              The application is missing required environment variables. Please configure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your Netlify environment variables.
            </p>
          </div>
          <div className="bg-gray-50 p-4 rounded-md border border-gray-200">
            <h3 className="font-medium mb-2">Required Environment Variables:</h3>
            <pre className="bg-gray-100 p-3 rounded text-sm overflow-auto">
              VITE_SUPABASE_URL=https://your-project-id.supabase.co{'\n'}
              VITE_SUPABASE_ANON_KEY=your-anon-key-here
            </pre>
          </div>
        </div>
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
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
          </div>
        </AppProvider>
      </Router>
    </ErrorBoundary>
  );
}

export default App;