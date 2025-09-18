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
    
    // Handle percentage symbol for sorting word (hide % and style the word after it)
    if (originalName.includes('%')) {
      const [prefix, ...restParts] = originalName.split('%');
      const rest = restParts.join('%');
      
      // Handle edge case where % is at the end
      if (!rest.trim()) {
        return <span className={className}>{prefix.replace('%', '')}</span>;
      }
      
      // Extract the first word after % for styling
      const match = rest.match(/(\s*)(\S+)(.*)/);
      if (!match) {
        return <span className={className}>{prefix}{rest}</span>;
      }
      
      const [, leadingSpace, styledWord, suffixText] = match;
      
      return (
        <span className={className}>
          {prefix}
          {leadingSpace}
          <span style={{ color: '#666666', fontStyle: 'italic' }}>
            {styledWord}
          </span>
          {suffixText}
        </span>
      );
    }
    
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