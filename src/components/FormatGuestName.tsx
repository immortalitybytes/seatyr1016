import React from 'react';
import { extractPartySuffix, getDisplayName } from '../utils/guestCount';

interface FormatGuestNameProps {
  name: string;
  className?: string;
}

/**
 * Renders a guest name with special styling for percentage markers.
 * If the name contains a '%' character, the single word immediately following it
 * is rendered in italic gray. The '%' itself is not shown.
 * 
 * Examples:
 * - "John %Smith" → "John <styled>Smith</styled>"
 * - "Alice %Jones & Bob" → "Alice <styled>Jones</styled> & Bob"
 * - "Test%" → "Test" (handles edge case)
 */
const FormatGuestName: React.FC<FormatGuestNameProps> = ({ name, className = '' }) => {
  const suffix = extractPartySuffix(name);
  const display = getDisplayName(name);

  // Early return for invalid or non-special names
  if (!display || typeof display !== 'string' || !display.includes('%')) {
    return (
      <span className={className}>
        {display}
        {suffix && <span className="ml-0.5 font-normal">{suffix}</span>}
      </span>
    );
  }

  // Split on % and handle multiple % characters gracefully
  const [prefix, ...restParts] = display.split('%');
  const rest = restParts.join('%');

  // Handle edge case where % is at the end
  if (!rest.trim()) {
    return (
      <span className={className}>
        {prefix.replace('%', '')}
        {suffix && <span className="ml-0.5 font-normal">{suffix}</span>}
      </span>
    );
  }

  // Extract the first word after % for styling using robust regex
  const match = rest.match(/(\s*)(\S+)(.*)/);
  if (!match) {
    return (
      <span className={className}>
        {prefix}{rest}
        {suffix && <span className="ml-0.5 font-normal">{suffix}</span>}
      </span>
    );
  }

  const [, leadingSpace, styledWord, suffixText] = match;

  return (
    <span className={className}>
      {prefix}
      {leadingSpace}
      <span style={{ color: '#959595', fontStyle: 'italic' }}>
        {styledWord}
      </span>
      {suffixText}
      {suffix && <span className="ml-0.5 font-normal">{suffix}</span>}
    </span>
  );
};

export default FormatGuestName;