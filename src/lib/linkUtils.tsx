import React from 'react';

/**
 * Parses text containing URLs and renders clickable anchor tags safely.
 * Detects http://, https://, and www. links.
 */
export function renderFormattedTextWithLinks(text?: string | null): React.ReactNode {
  if (!text) return null;

  // Match URLs starting with http://, https://, or www.
  const urlRegex = /(https?:\/\/[^\s]+|www\.[^\s]+)/gi;
  const parts = text.split(urlRegex);

  return parts.map((part, index) => {
    if (urlRegex.test(part)) {
      const href = part.toLowerCase().startsWith('http') ? part : `https://${part}`;
      return (
        <a
          key={index}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="text-indigo-400 hover:text-indigo-300 underline font-medium transition-colors break-all"
        >
          {part}
        </a>
      );
    }
    return <React.Fragment key={index}>{part}</React.Fragment>;
  });
}
