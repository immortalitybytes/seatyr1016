import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import Card from '../components/Card';
import Button from '../components/Button';
import { 
  BarChart3, 
  Users, 
  CreditCard, 
  RefreshCw, 
  ArrowUpRight, 
  ArrowDownRight,
  Crown,
  CalendarRange,
  CheckSquare
} from 'lucide-react';
import { useApp } from '../context/AppContext';

const AdminDashboard: React.FC = () => {
  const navigate = useNavigate();
  const { state } = useApp();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dailyMetrics, setDailyMetrics] = useState<any>(null);
  const [subscriptionMetrics, setSubscriptionMetrics] = useState<any[]>([]);
  const [betaCodePerformance, setBetaCodePerformance] = useState<any[]>([]);
  const [timeFrame, setTimeFrame] = useState<'7days' | '30days' | '90days'>('30days');

  // Check if current user is admin (very basic check)
  const isAdmin = state.user?.email && (
    state.user.email.toLowerCase() === 'danabrams999@yahoo.com' || 
    state.user.email.toLowerCase() === 'dan@corpania.com' ||
    state.user.email.toLowerCase() === 'immortality.bytes.book@gmail.com'
  );

  useEffect(() => {
    if (!isAdmin) {
      navigate('/');
      return;
    }

    fetchDashboardData();
  }, [isAdmin, timeFrame]);

  const fetchDashboardData = async () => {
    try {
      setLoading(true);
      setError(null);

      // Fetch daily metrics summary
      const { data: summaryData, error: summaryError } = await supabase
        .from('daily_metrics_summary')
        .select('*')
        .single();

      if (summaryError) {
        console.error('Error fetching metrics summary:', summaryError);
        throw new Error('Failed to load dashboard metrics');
      }

      setDailyMetrics(summaryData);

      // Fetch subscription metrics
      const dateFilter = getDateFilter();
      const { data: subData, error: subError } = await supabase
        .from('subscription_analytics')
        .select('*')
        .gte('date', dateFilter)
        .order('date', { ascending: false });

      if (subError) {
        console.error('Error fetching subscription metrics:', subError);
        throw new Error('Failed to load subscription metrics');
      }

      setSubscriptionMetrics(subData || []);

      // Fetch beta code performance
      const { data: betaData, error: betaError } = await supabase
        .from('beta_code_performance')
        .select('*')
        .order('uses', { ascending: false });

      if (betaError) {
        console.error('Error fetching beta code performance:', betaError);
        throw new Error('Failed to load beta code performance data');
      }

      setBetaCodePerformance(betaData || []);

    } catch (err) {
      console.error('Error fetching dashboard data:', err);
      setError(err.message || 'An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  };

  const getDateFilter = () => {
    const date = new Date();
    switch (timeFrame) {
      case '7days':
        date.setDate(date.getDate() - 7);
        break;
      case '30days':
        date.setDate(date.getDate() - 30);
        break;
      case '90days':
        date.setDate(date.getDate() - 90);
        break;
    }
    return date.toISOString().split('T')[0];
  };

  const formatNumber = (num: number | null) => {
    if (num === null || num === undefined) return '-';
    return num.toLocaleString();
  };

  const formatPercentage = (num: number | null) => {
    if (num === null || num === undefined) return '-';
    return `${num}%`;
  };

  if (!isAdmin) {
    return null;
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-[#586D78] flex items-center">
          <BarChart3 className="mr-2" />
          Admin Dashboard
        </h1>
        <Card>
          <div className="flex justify-center items-center py-12">
            <RefreshCw className="w-8 h-8 animate-spin text-[#586D78]" />
            <span className="ml-2 text-gray-600">Loading dashboard data...</span>
          </div>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-[#586D78] flex items-center">
          <BarChart3 className="mr-2" />
          Admin Dashboard
        </h1>
        <Card>
          <div className="p-6 text-center">
            <p className="text-red-600 mb-4">{error}</p>
            <Button onClick={fetchDashboardData} icon={<RefreshCw className="w-4 h-4" />}>
              Retry
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-[#586D78] flex items-center">
          <BarChart3 className="mr-2" />
          Admin Dashboard
        </h1>
        <div className="flex space-x-2">
          <Button
            variant={timeFrame === '7days' ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => setTimeFrame('7days')}
          >
            7 Days
          </Button>
          <Button
            variant={timeFrame === '30days' ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => setTimeFrame('30days')}
          >
            30 Days
          </Button>
          <Button
            variant={timeFrame === '90days' ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => setTimeFrame('90days')}
          >
            90 Days
          </Button>
          <Button 
            variant="secondary" 
            size="sm"
            onClick={fetchDashboardData}
            icon={<RefreshCw className="w-4 h-4" />}
          >
            Refresh
          </Button>
        </div>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="bg-gradient-to-br from-indigo-50 to-blue-50">
          <div className="p-4">
            <div className="flex justify-between">
              <h3 className="text-[#586D78] font-medium">Total Users</h3>
              <Users className="w-5 h-5 text-[#586D78]" />
            </div>
            <p className="text-3xl font-bold mt-2">{formatNumber(dailyMetrics?.total_users)}</p>
            <div className="mt-2 text-sm text-green-600 flex items-center">
              <ArrowUpRight className="w-4 h-4 mr-1" />
              <span>Active Growth</span>
            </div>
          </div>
        </Card>

        <Card className="bg-gradient-to-br from-amber-50 to-yellow-50">
          <div className="p-4">
            <div className="flex justify-between">
              <h3 className="text-[#586D78] font-medium">Premium Users</h3>
              <Crown className="w-5 h-5 text-[#586D78]" />
            </div>
            <p className="text-3xl font-bold mt-2">{formatNumber(dailyMetrics?.active_subscriptions)}</p>
            <div className="mt-2 text-sm text-gray-600 flex items-center">
              <span>+{dailyMetrics?.active_trials || 0} active trials</span>
            </div>
          </div>
        </Card>

        <Card className="bg-gradient-to-br from-green-50 to-emerald-50">
          <div className="p-4">
            <div className="flex justify-between">
              <h3 className="text-[#586D78] font-medium">Saved Settings</h3>
              <CheckSquare className="w-5 h-5 text-[#586D78]" />
            </div>
            <p className="text-3xl font-bold mt-2">{formatNumber(dailyMetrics?.total_saved_settings)}</p>
            <div className="mt-2 text-sm text-green-600 flex items-center">
              <span>Average {Math.round((dailyMetrics?.total_saved_settings || 0) / (dailyMetrics?.total_users || 1))} per user</span>
            </div>
          </div>
        </Card>
      </div>

      {/* Subscription Metrics */}
      <Card title="Subscription Metrics">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead>
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">New Subs</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Active</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Cancellations</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Past Due</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Non-Renewing</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Retention</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {subscriptionMetrics.length > 0 ? (
                subscriptionMetrics.map((metric) => (
                  <tr key={metric.date} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {new Date(metric.date).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 font-medium">
                      {formatNumber(metric.new_subscriptions)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-green-600 font-medium">
                      {formatNumber(metric.active_subscriptions)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-red-600 font-medium">
                      {formatNumber(metric.cancellations)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-amber-600 font-medium">
                      {formatNumber(metric.past_due_subscriptions)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600 font-medium">
                      {formatNumber(metric.non_renewing_subscriptions)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-[#586D78] font-medium">
                      {formatPercentage(metric.retention_rate)}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} className="px-6 py-4 text-center text-sm text-gray-500">
                    No subscription data available for the selected time period
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Beta Code Performance */}
      <Card title="Beta Code Performance">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead>
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Code</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Uses</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Max Uses</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Total Trials</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Converted</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Conversion Rate</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Expires</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {betaCodePerformance.length > 0 ? (
                betaCodePerformance.map((code) => (
                  <tr key={code.code} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-[#586D78]">
                      {code.code}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {code.uses}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {code.max_uses || 'Unlimited'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {code.total_trials}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-green-600">
                      {code.converted_to_paid}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                      {formatPercentage(code.conversion_rate)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {code.expires_on ? new Date(code.expires_on).toLocaleDateString() : 'Never'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                        code.is_expired 
                          ? 'bg-red-100 text-red-800' 
                          : 'bg-green-100 text-green-800'
                      }`}>
                        {code.is_expired ? 'Expired' : 'Active'}
                      </span>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={8} className="px-6 py-4 text-center text-sm text-gray-500">
                    No beta code data available
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* User Activity */}
      <Card title="Recent User Activity">
        <div className="flex items-center justify-center py-8">
          <div className="flex flex-col items-center">
            <p className="text-2xl font-bold text-[#586D78]">{dailyMetrics?.active_users_last_7_days || 0}</p>
            <p className="text-sm text-gray-600">Active Users (Last 7 Days)</p>
          </div>
        </div>
      </Card>

      {/* Actions */}
      <div className="flex justify-end">
        <Button 
          onClick={() => navigate('/admin/beta-codes')}
          variant="secondary"
        >
          Manage Beta Codes
        </Button>
      </div>
    </div>
  );
};

export default AdminDashboard;