import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { XCircle } from 'lucide-react';
import Card from '../components/Card';
import Button from '../components/Button';

const PremiumCancel: React.FC = () => {
  const navigate = useNavigate();

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-800 flex items-center">
        <XCircle className="mr-2" />
        Premium Upgrade Cancelled
      </h1>

      <Card>
        <div className="text-center py-8">
          <XCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-gray-800 mb-4">
            Premium upgrade cancelled
          </h2>
          <p className="text-gray-600 mb-8">
            No worries! You can still use all the free features of Seatyr.
            If you change your mind, you can upgrade to Premium at any time.
          </p>
          <Button
            onClick={() => navigate('/')}
            className="mx-auto"
          >
            Return to Home
          </Button>
        </div>
      </Card>
    </div>
  );
};

export default PremiumCancel;