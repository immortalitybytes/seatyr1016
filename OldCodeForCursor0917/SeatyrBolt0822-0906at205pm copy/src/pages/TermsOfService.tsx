import React from 'react';
import { Scale } from 'lucide-react';
import Card from '../components/Card';

const TermsOfService: React.FC = () => {
  return (
    <div className="space-y-6 pb-8">
      <h1 className="text-2xl font-bold text-gray-800 flex items-center">
        <Scale className="mr-2" />
        Terms of Service
      </h1>

      <Card>
        <div className="prose max-w-none">
          <h2 className="text-xl font-semibold mb-4">Effective Date: May 9, 2025</h2>
          
          <p className="mb-6">
            Welcome to Seatyr.com. These Terms of Service ("Terms") govern your access to and use of our website, applications, and related services (collectively, the "Service") provided by Exabyte LLC ("we," "us," or "our"). By using Seatyr.com, you agree to be bound by these Terms.
          </p>
          
          <p className="mb-6">Please read them carefully.</p>
          
          <h3 className="text-lg font-semibold mt-8 mb-4">1. Service Overview</h3>
          <p className="mb-4">
            Seatyr.com is a web-based application that helps users organize and optimize seating arrangements for events such as weddings, banquets, and conferences. Features include guest list management, table assignments, seating permutations, and constraint-based arrangement tools.
          </p>
          
          <h3 className="text-lg font-semibold mt-8 mb-4">2. Eligibility</h3>
          <p className="mb-4">
            To use Seatyr.com, you must be at least 13 years old. By using the Service, you represent and warrant that you have the legal capacity to enter into these Terms.
          </p>
          
          <h3 className="text-lg font-semibold mt-8 mb-4">3. User Accounts</h3>
          <p className="mb-4">
            You may use Seatyr.com without an account, but some features may require registration.
          </p>
          <p className="mb-4">
            You are responsible for maintaining the confidentiality of any account credentials and for all activities that occur under your account.
          </p>
          <p className="mb-4">
            You agree to provide accurate and current information.
          </p>
          
          <h3 className="text-lg font-semibold mt-8 mb-4">4. Acceptable Use</h3>
          <p className="mb-4">You agree not to:</p>
          <ul className="list-disc pl-6 mb-4">
            <li>Use the Service for any unlawful purpose;</li>
            <li>Reverse-engineer, copy, or resell any part of the Service;</li>
            <li>Attempt to interfere with the operation or security of Seatyr.com;</li>
            <li>Upload or share content that is offensive, harmful, or infringing.</li>
          </ul>
          
          <h3 className="text-lg font-semibold mt-8 mb-4">5. Intellectual Property</h3>
          <p className="mb-4">
            All content on Seatyr.com, including design, code, and trademarks, is owned by Exabyte LLC or its licensors. You may not reproduce, distribute, or modify any portion of the Service without explicit permission.
          </p>
          
          <h3 className="text-lg font-semibold mt-8 mb-4">6. User Content</h3>
          <p className="mb-4">
            You retain ownership of content (e.g., guest lists) you upload to the Service.
          </p>
          <p className="mb-4">
            By using the Service, you grant us a limited license to store, display, and process your content to provide the functionality of the Service.
          </p>
          <p className="mb-4">
            We do not claim ownership over your event data.
          </p>
          
          <h3 className="text-lg font-semibold mt-8 mb-4">7. Data & Privacy</h3>
          <p className="mb-4">
            Our Privacy Policy explains how we collect, use, and protect your personal data. By using Seatyr.com, you consent to our data practices as outlined there.
          </p>
          
          <h3 className="text-lg font-semibold mt-8 mb-4">8. Availability & Modifications</h3>
          <p className="mb-4">
            We strive to maintain uptime but do not guarantee uninterrupted access.
          </p>
          <p className="mb-4">
            We may modify or discontinue any part of the Service at any time, with or without notice.
          </p>
          
          <h3 className="text-lg font-semibold mt-8 mb-4">9. Third-Party Services</h3>
          <p className="mb-4">
            The Service may integrate with third-party platforms or APIs. We are not responsible for the content, functionality, or policies of those third parties.
          </p>
          
          <h3 className="text-lg font-semibold mt-8 mb-4">10. Disclaimers</h3>
          <p className="mb-4">
            The Service is provided "as is" and "as available." We make no warranties regarding reliability, accuracy, or suitability for your specific needs.
          </p>
          
          <h3 className="text-lg font-semibold mt-8 mb-4">11. Limitation of Liability</h3>
          <p className="mb-4">
            To the fullest extent permitted by law, Seatyr.com and Exabyte LLC shall not be liable for any indirect, incidental, special, or consequential damages arising from your use of the Service.
          </p>
          
          <h3 className="text-lg font-semibold mt-8 mb-4">12. Indemnification</h3>
          <p className="mb-4">
            You agree to indemnify and hold harmless Exabyte LLC from any claims, liabilities, or expenses arising from your use of the Service or violation of these Terms.
          </p>
          
          <h3 className="text-lg font-semibold mt-8 mb-4">13. Governing Law</h3>
          <p className="mb-4">
            These Terms are governed by the laws of the State of New York, without regard to its conflict of law principles.
          </p>
          
          <h3 className="text-lg font-semibold mt-8 mb-4">14. Changes to These Terms</h3>
          <p className="mb-4">
            We may update these Terms at any time. Continued use of the Service after changes are posted constitutes your acceptance of the revised Terms.
          </p>
          
          <h3 className="text-lg font-semibold mt-8 mb-4">15. Contact Us</h3>
          <p className="mb-4">
            If you have questions about these Terms, please contact us at:<br />
            info@seatyr.com
          </p>
        </div>
      </Card>
    </div>
  );
};

export default TermsOfService;