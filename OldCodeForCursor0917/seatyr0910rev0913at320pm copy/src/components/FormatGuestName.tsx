import React from 'react';
import { extractPartySuffix, getDisplayName } from '../utils/guestCount';
import { seatingTokensFromGuestUnit, nOfNTokensFromSuffix } from '../utils/formatters'; // Import from centralized formatters

interface FormatGuestNameProps {
  name: string;
  seatIndex?: number;
  className?: string;
}

const FormatGuestName: React.FC<FormatGuestNameProps> = ({ name, seatIndex = -1, className = '' }) => {
    if (!name) return <span className={className}></span>;
    const originalName = name.trim();
    
    // Get base tokens (names) and extra tokens (ordinals)
    const baseTokens = seatingTokensFromGuestUnit(originalName);
    const extraTokens = nOfNTokensFromSuffix(originalName);
    
    // Determine which token to bold based on seat index
    let tokenToBold = '';
    let isOrdinal = false;
    
    if (seatIndex !== -1 && seatIndex < baseTokens.length) {
      tokenToBold = baseTokens[seatIndex];
    } else if (seatIndex !== -1 && seatIndex >= baseTokens.length && seatIndex < baseTokens.length + extraTokens.length) {
      tokenToBold = extraTokens[seatIndex - baseTokens.length];
      isOrdinal = true;
    }

    const nameParts: React.ReactNode[] = [];
    
    // Process base tokens
    baseTokens.forEach((token, index) => {
      if (tokenToBold === token && !isOrdinal) {
        nameParts.push(<strong key={index} className="text-[#586D78]">{token}</strong>);
      } else {
        nameParts.push(<span key={index}>{token}</span>);
      }
      if (index < baseTokens.length - 1) {
        nameParts.push(<span key={`sep-${index}`}> & </span>);
      }
    });

    // Process extra tokens (plus ones)
    if (extraTokens.length > 0) {
      nameParts.push(<span key="suffix-sep"> plus </span>);
      extraTokens.forEach((token, index) => {
        if (tokenToBold === token && isOrdinal) {
          nameParts.push(<strong key={`ordinal-${index}`}>{token}</strong>);
        } else {
          nameParts.push(<span key={`ordinal-${index}`}>{token}</span>);
        }
      });
    }

    return <span className={className}>{nameParts.length > 0 ? nameParts : originalName}</span>;
};

export default FormatGuestName;