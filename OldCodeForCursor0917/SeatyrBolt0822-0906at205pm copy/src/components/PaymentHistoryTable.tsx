import React, { useState, useEffect } from 'react';
import { CreditCard, Clock } from 'lucide-react';
import { getPaymentHistory } from '../lib/stripe';

interface PaymentHistoryTableProps {
  userId: string;
}

interface Payment {
  id: string;
  amount: number;
  currency: string;
  status: string;
  payment_date: string;
  stripe_invoice_id?: string;
}

const PaymentHistoryTable: React.FC<PaymentHistoryTableProps> = ({ userId }) => {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchPaymentHistory = async () => {
      try {
        setLoading(true);
        const data = await getPaymentHistory(userId);
        setPayments(data);
        setError(null);
      } catch (err) {
        setError('Unable to load payment history');
        console.error('Error loading payment history:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchPaymentHistory();
  }, [userId]);

  const formatCurrency = (amount: number, currency: string) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency.toUpperCase(),
    }).format(amount);
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  const getStatusBadge = (status: string) => {
    const statusColors = {
      paid: 'bg-green-100 text-green-800',
      pending: 'bg-yellow-100 text-yellow-800',
      failed: 'bg-red-100 text-red-800',
      refunded: 'bg-blue-100 text-blue-800',
    };

    const color = statusColors[status.toLowerCase()] || 'bg-gray-100 text-gray-800';
    
    return (
      <span className={`px-2 py-1 rounded-full text-xs font-medium ${color}`}>
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </span>
    );
  };

  if (loading) {
    return (
      <div className="flex justify-center py-6">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#7973BB]"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 bg-red-50 border border-red-200 rounded-md text-red-700">
        <p className="font-medium">Failed to load payment history</p>
        <p className="text-sm">Please try again later or contact support.</p>
      </div>
    );
  }

  if (payments.length === 0) {
    return (
      <div className="p-6 text-center text-gray-500 bg-gray-50 border border-gray-200 rounded-md">
        <Clock className="w-8 h-8 mx-auto text-gray-400 mb-2" />
        <p className="font-medium">No payment history yet</p>
        <p className="text-sm">Your payment records will show up here once available.</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200">
        <thead>
          <tr className="bg-gray-50">
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Date
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Amount
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Status
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Invoice
            </th>
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {payments.map((payment) => (
            <tr key={payment.id} className="hover:bg-gray-50">
              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                {formatDate(payment.payment_date)}
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                {formatCurrency(payment.amount, payment.currency)}
              </td>
              <td className="px-6 py-4 whitespace-nowrap">
                {getStatusBadge(payment.status)}
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-[#7973BB]">
                {payment.stripe_invoice_id ? (
                  <a
                    href="#"
                    className="flex items-center text-[#7973BB] hover:text-[#5d59a5]"
                    onClick={(e) => {
                      e.preventDefault();
                      // Open Stripe portal to view invoice
                    }}
                  >
                    <CreditCard className="w-4 h-4 mr-1" />
                    View Receipt
                  </a>
                ) : (
                  "N/A"
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default PaymentHistoryTable;