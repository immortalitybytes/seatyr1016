import React from 'react';
import { Github } from 'lucide-react';

const Footer: React.FC = () => {
 return (
  <footer className="bg-[#586D78] text-white py-4 mt-auto">
    <div className="container mx-auto px-4">
      <div className="flex flex-col md:flex-row items-center justify-between">
        <div className="text-sm mb-2 md:mb-0 flex items-center">
          &copy; 2025
          <img
            src="https://i.imgur.com/5AikU0W.png"
            alt="Seatyr Icon"
            className="w-4 h-4 mx-2"
          />
          Seatyr — Efficient Seating for Slightly Fewer Headaches
        </div>

        <div className="flex items-center space-x-4">
          <a
            href="https://github.com"
            target="_blank"
            rel="noopener noreferrer"
            className="text-white hover:text-white/80 transition-colors"
            aria-label="GitHub"
          >
            <Github className="w-5 h-5" />
          </a>

          <a
            href="/privacy"
            className="text-white hover:text-white/80 transition-colors text-sm"
          >
            Privacy Policy
          </a>

          <a
            href="/terms"
            className="text-white hover:text-white/80 transition-colors text-sm"
          >
            Terms of Service
          </a>

          <a
            href="https://www.corpania.com"
            target="_blank"
            rel="noopener noreferrer"
            className="ml-2"
          >
            <img
              src="https://i.imgur.com/2xCPeEE.png"
              alt="Corpania Logo"
              className="w-6 h-6 hover:opacity-80 transition-opacity"
            />
          </a>
        </div>
      </div>
    </div>
  </footer>
  );
};

export default Footer;