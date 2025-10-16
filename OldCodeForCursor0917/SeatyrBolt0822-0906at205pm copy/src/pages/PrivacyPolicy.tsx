import React from 'react';
import { Shield } from 'lucide-react';
import Card from '../components/Card';

const PrivacyPolicy: React.FC = () => {
  return (
    <div className="space-y-6 pb-8">
      <h1 className="text-2xl font-bold text-gray-800 flex items-center">
        <Shield className="mr-2" />
        Privacy Policy
      </h1>

      <Card>
        <div className="prose max-w-none">
          <h2 className="text-xl font-semibold mb-4">Effective Date: May 9, 2025</h2>
          
          <p className="mb-6">
            This Privacy Policy explains how Exabyte LLC ("we," "us," "our") collects, uses, shares, and protects information about users of Seatyr.com (the "Service").
          </p>
          
          <p className="mb-6">
            By using Seatyr.com, you agree to the terms of this policy.
          </p>
          
          <h3 className="text-lg font-semibold mt-8 mb-4">1. Information We Collect</h3>
          <p>We collect the following types of information:</p>
          
          <h4 className="font-semibold mt-4 mb-2">a. Information You Provide</h4>
          <ul className="list-disc pl-6 mb-4">
            <li>Guest lists and event data (names, seating preferences, constraints)</li>
            <li>Your email address or name (if provided via contact form or optional account registration)</li>
          </ul>
          
          <h4 className="font-semibold mt-4 mb-2">b. Automatically Collected Information</h4>
          <ul className="list-disc pl-6 mb-4">
            <li>Device and browser type</li>
            <li>IP address and usage data</li>
            <li>Cookies and similar technologies (see Section 6)</li>
          </ul>
          
          <h3 className="text-lg font-semibold mt-8 mb-4">2. How We Use Your Information</h3>
          <p>We use the information we collect to:</p>
          <ul className="list-disc pl-6 mb-4">
            <li>Provide and maintain the Service</li>
            <li>Improve functionality and performance</li>
            <li>Respond to user inquiries and support requests</li>
            <li>Protect against misuse or unauthorized access</li>
            <li>Analyze aggregate usage trends (non-personally identifiable)</li>
          </ul>
          <p className="mb-4">We do not sell or rent your personal data.</p>
          
          <h3 className="text-lg font-semibold mt-8 mb-4">3. Data Storage & Security</h3>
          <p className="mb-4">
            We use industry-standard measures to protect your data, including encryption, secure servers, and access controls.
          </p>
          <p className="mb-4">
            However, no internet-based service is 100% secure. You use the Service at your own risk and are responsible for safeguarding any personal data you choose to upload.
          </p>
          
          <h3 className="text-lg font-semibold mt-8 mb-4">4. Data Retention</h3>
          <p className="mb-4">
            Event and guest data is retained only as long as needed to operate the Service or as requested by you.
          </p>
          <p className="mb-4">
            You may request deletion of your data at any time by contacting us at info@seatyr.com.
          </p>
          
          <h3 className="text-lg font-semibold mt-8 mb-4">5. Sharing of Information</h3>
          <p className="mb-4">We do not share personal information with third parties except:</p>
          <ul className="list-disc pl-6 mb-4">
            <li>As required by law or court order</li>
            <li>To third-party service providers who support site functionality (e.g., hosting)</li>
            <li>In the event of a merger, acquisition, or asset sale</li>
          </ul>
          
          <h3 className="text-lg font-semibold mt-8 mb-4">6. Cookies and Analytics</h3>
          <p className="mb-4">
            Seatyr.com may use cookies and third-party analytics (such as Google Analytics) to enhance user experience and gather usage data. You can disable cookies in your browser settings, though this may affect site performance.
          </p>
          
          <h3 className="text-lg font-semibold mt-8 mb-4">7. Children's Privacy</h3>
          <p className="mb-4">
            Seatyr.com is not intended for use by children under 13. We do not knowingly collect personal information from children.
          </p>
          
          <h3 className="text-lg font-semibold mt-8 mb-4">8. Your Rights</h3>
          <p className="mb-4">Depending on your location, you may have the right to:</p>
          <ul className="list-disc pl-6 mb-4">
            <li>Access or correct your personal data</li>
            <li>Request deletion of your data</li>
            <li>Object to certain types of data processing</li>
          </ul>
          <p className="mb-4">
            To make such a request, email us at info@seatyr.com.
          </p>
          
          <h3 className="text-lg font-semibold mt-8 mb-4">9. International Users</h3>
          <p className="mb-4">
            If you are accessing Seatyr.com from outside the United States, be aware that your data may be processed and stored in the U.S. By using the Service, you consent to this transfer.
          </p>
          
          <h3 className="text-lg font-semibold mt-8 mb-4">10. Changes to This Policy</h3>
          <p className="mb-4">
            We may update this Privacy Policy periodically. Changes will be posted on this page with the updated effective date. Continued use of the Service after changes constitutes acceptance.
          </p>
          
          <h3 className="text-lg font-semibold mt-8 mb-4">11. Contact Us</h3>
          <p className="mb-4">
            If you have questions about this Privacy Policy or how your data is handled, contact:
          </p>
          <p className="mb-4">
            Exabyte LLC<br />
            Email: info@seatyr.com<br />
            Website: https://seatyr.com
          </p>
        </div>
      </Card>
    </div>
  );
};

export default PrivacyPolicy;