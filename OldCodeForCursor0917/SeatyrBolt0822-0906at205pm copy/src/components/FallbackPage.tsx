import React from 'react';

const FallbackPage: React.FC = () => {
  return (
    <div className="min-h-screen bg-[#dde1e3] flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-md p-6 max-w-lg w-full">
        <h1 className="text-2xl font-bold text-[#7973BB] mb-4">Seatyr - Configuration Needed</h1>
        
        <div className="bg-[#88abc6] border border-[#88abc6] rounded-md p-4 mb-6">
          <h2 className="text-lg font-semibold text-white mb-2">Missing Environment Configuration</h2>
          <p className="text-white">
            The application is missing required environment variables. This is typically needed for the first setup.
          </p>
        </div>
        
        <div className="bg-gray-50 p-4 rounded-md border border-gray-200">
          <h3 className="font-medium mb-2">Required Environment Variables:</h3>
          <pre className="bg-gray-100 p-3 rounded text-sm overflow-auto">
            VITE_SUPABASE_URL=https://your-project-id.supabase.co
            VITE_SUPABASE_ANON_KEY=your-anon-key-here
          </pre>
        </div>
        
        <div className="mt-6 space-y-4">
          <p className="text-gray-600">
            These variables need to be configured in your Netlify Environment Variables settings
            or in your local .env file for local development.
          </p>
          
          <div className="flex justify-center">
            <button
              onClick={() => window.location.reload()}
              className="w-28 h-12 text-white font-semibold bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 rounded-lg shadow-lg hover:scale-105 duration-200 hover:drop-shadow-2xl hover:shadow-[#7dd3fc] hover:cursor-pointer"
            >
              Refresh Page
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default FallbackPage;