import React from "react";

type Props = { name: string };

/**
 * Renders a guest name with special styling for percentage markers.
 * If the name contains a '%' character, the single word immediately following it
 * is rendered in dark gray. The '%' itself is not shown.
 * 
 * Examples:
 * - "John %Smith" → "John <dark gray>Smith</dark gray>"
 * - "Alice %Jones & Bob" → "Alice <dark gray>Jones</dark gray> & Bob"
 * - "Test%" → "Test" (handles edge case)
 */
const FormatGuestName: React.FC<Props> = ({ name }) => {
  // Early return for invalid or non-special names
  if (!name || typeof name !== 'string' || !name.includes('%')) {
    return <span>{name}</span>;
  }

  // Split on % and handle multiple % characters gracefully
  const [prefix, ...restParts] = name.split('%');
  const rest = restParts.join('%');

  // Handle edge case where % is at the end
  if (!rest.trim()) {
    return <span>{prefix.replace('%', '')}</span>;
  }

  // Extract the first word after % for styling using robust regex
  const match = rest.match(/(\s*)(\S+)(.*)/);
  if (!match) {
    return <span>{prefix}{rest}</span>;
  }

  const [, leadingSpace, styledWord, suffixText] = match;

  return (
    <span>
      {prefix}
      {leadingSpace}
      <span style={{ color: '#959595' }}>
        {styledWord}
      </span>
      {suffixText}
    </span>
  );
};

export default FormatGuestName;