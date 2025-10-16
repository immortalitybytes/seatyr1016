import React, { useState, useEffect } from 'react';
import { Key, PlusCircle, Trash2, ClipboardCopy } from 'lucide-react';
import Card from '../components/Card';
import Button from '../components/Button';
import { supabase } from '../lib/supabase';
import { useApp } from '../context/AppContext';
import { createBetaCode } from '../lib/betacode';

const BetaCodeAdmin: React.FC = () => {
  const { state } = useApp();
  const { user } = state;
  const [betaCodes, setBetaCodes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [copySuccess, setCopySuccess] = useState<string | null>(null);
  const [newCodeData, setNewCodeData] = useState({
    code: '',
    maxUses: '10',
    expirationDays: '30'
  });

  useEffect(() => {
    fetchBetaCodes();
  }, []);

  const fetchBetaCodes = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const { data, error } = await supabase
        .from('beta_codes')
        .select('*')
        .order('code');

      if (error) {
        throw error;
      }
      
      setBetaCodes(data || []);
    } catch (err) {
      console.error('Error fetching beta codes:', err);
      setError('Failed to load beta codes');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateCode = async () => {
    try {
      if (!newCodeData.code.trim()) {
        setError('Please enter a code');
        return;
      }

      const maxUses = parseInt(newCodeData.maxUses);
      const expirationDays = parseInt(newCodeData.expirationDays);
      
      // Calculate expiration date
      const expiresOn = new Date();
      expiresOn.setDate(expiresOn.getDate() + expirationDays);

      await createBetaCode(
        newCodeData.code.trim(),
        isNaN(maxUses) ? undefined : maxUses,
        isNaN(expirationDays) ? undefined : expiresOn
      );

      fetchBetaCodes();
      setShowCreateModal(false);
      setNewCodeData({
        code: '',
        maxUses: '10',
        expirationDays: '30'
      });
    } catch (err) {
      console.error('Error creating beta code:', err);
      setError('Failed to create beta code');
    }
  };

  const handleDeleteCode = async (code: string) => {
    try {
      if (!confirm('Are you sure you want to delete this beta code?')) {
        return;
      }
      
      const { error } = await supabase
        .from('beta_codes')
        .delete()
        .eq('code', code);

      if (error) {
        throw error;
      }
      
      fetchBetaCodes();
    } catch (err) {
      console.error('Error deleting beta code:', err);
      setError('Failed to delete beta code');
    }
  };

  const copyToClipboard = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopySuccess(code);
      setTimeout(() => setCopySuccess(null), 2000);
    } catch (err) {
      console.error('Could not copy text: ', err);
    }
  };

  // Check if current user is admin (you should implement proper admin check)
  // For demo purposes, only certain emails will be considered admins
  const isAdmin = user?.email && 
                 ['your-admin-email@example.com', 'danabrams999@yahoo.com', 'dan@corpania.com']
                 .includes(user.email.toLowerCase());

  if (!isAdmin) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-[#586D78] flex items-center">
          <Key className="mr-2" />
          Beta Code Management
        </h1>
        <Card>
          <div className="text-center py-8">
            <p className="text-red-600 text-lg">Unauthorized access. Admin privileges required.</p>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-[#586D78] flex items-center">
        <Key className="mr-2" />
        Beta Code Management
      </h1>
      
      <Card>
        <div className="flex justify-between items-center mb-4">
          <p className="text-gray-700">
            Create and manage beta codes for premium trial access.
          </p>
          <Button
            onClick={() => setShowCreateModal(true)}
            icon={<PlusCircle className="w-4 h-4" />}
          >
            Create New Code
          </Button>
        </div>
        
        {error && (
          <div className="bg-red-50 border border-red-200 rounded p-3 mb-4 text-red-600">
            {error}
          </div>
        )}
      </Card>
      
      <Card title="Beta Codes">
        {loading ? (
          <div className="text-center py-4">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500 mx-auto"></div>
            <p className="mt-2 text-gray-600">Loading codes...</p>
          </div>
        ) : betaCodes.length === 0 ? (
          <div className="text-center py-4">
            <p className="text-gray-500">No beta codes found. Create one to get started.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full border-collapse">
              <thead>
                <tr className="bg-indigo-50">
                  <th className="px-4 py-2 text-left text-[#586D78] font-medium">Code</th>
                  <th className="px-4 py-2 text-left text-[#586D78] font-medium">Usage</th>
                  <th className="px-4 py-2 text-left text-[#586D78] font-medium">Expires On</th>
                  <th className="px-4 py-2 text-left text-[#586D78] font-medium">Status</th>
                  <th className="px-4 py-2 text-right text-[#586D78] font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {betaCodes.map((code) => {
                  const isExpired = code.expires_on && new Date(code.expires_on) < new Date();
                  const isMaxedOut = code.max_uses && code.uses >= code.max_uses;
                  const status = isExpired ? 'Expired' : isMaxedOut ? 'Maxed Out' : 'Active';
                  
                  return (
                    <tr key={code.code} className="border-b">
                      <td className="px-4 py-3 font-medium">
                        <div className="flex items-center">
                          {code.code}
                          <button 
                            onClick={() => copyToClipboard(code.code)}
                            className="ml-2 text-gray-500 hover:text-[#586D78]"
                            title="Copy code"
                          >
                            <ClipboardCopy size={16} />
                            {copySuccess === code.code && (
                              <span className="ml-1 text-xs text-green-600">Copied!</span>
                            )}
                          </button>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {code.uses}{code.max_uses ? `/${code.max_uses}` : ''}
                      </td>
                      <td className="px-4 py-3">
                        {code.expires_on ? new Date(code.expires_on).toLocaleDateString() : 'Never'}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-block px-2 py-1 rounded-full text-xs font-medium ${
                          status === 'Active' 
                            ? 'bg-green-100 text-green-700' 
                            : 'bg-red-100 text-red-700'
                        }`}>
                          {status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={() => handleDeleteCode(code.code)}
                          icon={<Trash2 className="w-4 h-4" />}
                        >
                          Delete
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      
      {showCreateModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full shadow-2xl">
            <h3 className="text-xl font-bold mb-4">Create New Beta Code</h3>
            <div className="space-y-4">
              <div>
                <label htmlFor="code" className="block text-sm font-medium text-gray-700 mb-1">
                  Code
                </label>
                <input
                  id="code"
                  type="text"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#586D78]"
                  placeholder="e.g., BETA2025"
                  value={newCodeData.code}
                  onChange={(e) => setNewCodeData(prev => ({...prev, code: e.target.value}))}
                />
              </div>
              
              <div>
                <label htmlFor="maxUses" className="block text-sm font-medium text-gray-700 mb-1">
                  Maximum Uses (leave empty for unlimited)
                </label>
                <input
                  id="maxUses"
                  type="number"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#586D78]"
                  placeholder="e.g., 10"
                  value={newCodeData.maxUses}
                  onChange={(e) => setNewCodeData(prev => ({...prev, maxUses: e.target.value}))}
                />
              </div>
              
              <div>
                <label htmlFor="expirationDays" className="block text-sm font-medium text-gray-700 mb-1">
                  Expires After Days (leave empty for no expiration)
                </label>
                <input
                  id="expirationDays"
                  type="number"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#586D78]"
                  placeholder="e.g., 30"
                  value={newCodeData.expirationDays}
                  onChange={(e) => setNewCodeData(prev => ({...prev, expirationDays: e.target.value}))}
                />
              </div>
              
              <div className="flex justify-end space-x-2 pt-2">
                <Button
                  variant="secondary"
                  onClick={() => setShowCreateModal(false)}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleCreateCode}
                >
                  Create Code
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default BetaCodeAdmin;