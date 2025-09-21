import React from "react";

type Props = { name: string };

/**
 * Renders a guest name while styling exactly one %-prefixed token at ~70% black gray.
 * - The leading `%` marker is not displayed.
 * - Inter-word spacing is preserved by tokenizing on whitespace with capture.
 * - No sort logic is touched; this is purely presentational.
 */
const FormatGuestName: React.FC<Props> = ({ name }) => {
  // Split on whitespace and keep the whitespace so we can reassemble spacing exactly.
  const parts = name.split(/(\s+)/);

  return (
    <span>
      {parts.map((part, idx) => {
        if (/^\s+$/.test(part)) {
          // Preserve whitespace tokens verbatim
          return <span key={idx}>{part}</span>;
        }
        // Style exactly one %-prefixed *word* within multi-word names
        const isMarked = part.startsWith("%") && part.trim().length > 1;
        const display = isMarked ? part.slice(1) : part;
        return (
          <span key={idx} style={isMarked ? { color: "#4D4D4D" } : undefined}>
            {display}
          </span>
        );
      })}
    </span>
  );
};

export default FormatGuestName;