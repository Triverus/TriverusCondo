import React from 'react';

interface CondoMarkdownProps {
  content: string;
  className?: string;
}

export function CondoMarkdown({ content, className = '' }: CondoMarkdownProps) {
  if (!content) return null;

  // Split content into blocks by double newlines or single newlines
  const blocks = content.split(/\n\n+/);

  const renderFormattedInline = (text: string) => {
    // URL regex matching http, https or mailto
    const urlRegex = /(https?:\/\/[^\s<]+|mailto:[^\s<]+)/g;

    // First split by URLs
    const parts = text.split(urlRegex);

    return parts.map((part, pIdx) => {
      // If it's a URL
      if (/^(https?:\/\/|mailto:)/i.test(part)) {
        // Block unsafe protocols
        if (/^(javascript|data|vbscript):/i.test(part)) {
          return <span key={pIdx}>{part}</span>;
        }

        const isMailto = part.toLowerCase().startsWith('mailto:');
        const displayLabel = isMailto ? part.replace(/^mailto:/i, '') : part;

        return (
          <a
            key={pIdx}
            href={part}
            target={isMailto ? '_self' : '_blank'}
            rel={isMailto ? undefined : 'noopener noreferrer'}
            className="text-[#FF6600] font-semibold underline decoration-1 underline-offset-2 hover:opacity-80 break-all transition-opacity"
          >
            {displayLabel}
          </a>
        );
      }

      // Handle bold (**text**), italics (*text*), inline code (`code`)
      const inlineParts = part.split(/(\*\*.*?\*\*|\*.*?\*|`.*?`)/g);

      return (
        <span key={pIdx}>
          {inlineParts.map((inlineItem, iIdx) => {
            if (inlineItem.startsWith('**') && inlineItem.endsWith('**')) {
              return (
                <strong key={iIdx} className="font-bold text-slate-100 dark:text-slate-100">
                  {inlineItem.slice(2, -2)}
                </strong>
              );
            }
            if (inlineItem.startsWith('*') && inlineItem.endsWith('*')) {
              return (
                <em key={iIdx} className="italic opacity-90">
                  {inlineItem.slice(1, -1)}
                </em>
              );
            }
            if (inlineItem.startsWith('`') && inlineItem.endsWith('`')) {
              return (
                <code key={iIdx} className="px-1.5 py-0.5 rounded bg-slate-800 text-amber-300 font-mono text-[11px]">
                  {inlineItem.slice(1, -1)}
                </code>
              );
            }
            return inlineItem;
          })}
        </span>
      );
    });
  };

  return (
    <div className={`space-y-3 text-xs sm:text-[13px] leading-relaxed ${className}`}>
      {blocks.map((block, bIdx) => {
        const trimmed = block.trim();

        // Check if block is a heading (### Heading)
        if (trimmed.startsWith('### ')) {
          return (
            <h3 key={bIdx} className="text-sm font-bold text-[#FF6600] mt-2 mb-1">
              {renderFormattedInline(trimmed.replace(/^###\s+/, ''))}
            </h3>
          );
        }

        // Check if block is a list (unordered or ordered)
        const lines = trimmed.split('\n');
        const isBulletList = lines.every((line) => /^[\s•\-\*]+\s*/.test(line.trim()));
        const isNumberedList = lines.every((line) => /^\d+[\.\)]\s*/.test(line.trim()));

        if (isBulletList) {
          return (
            <ul key={bIdx} className="space-y-1.5 my-1.5 pl-1">
              {lines.map((line, lIdx) => {
                const cleanLine = line.replace(/^[\s•\-\*]+\s*/, '');
                return (
                  <li key={lIdx} className="flex items-start gap-2">
                    <span className="text-[#FF6600] font-bold shrink-0 select-none">•</span>
                    <span className="flex-1">{renderFormattedInline(cleanLine)}</span>
                  </li>
                );
              })}
            </ul>
          );
        }

        if (isNumberedList) {
          return (
            <ol key={bIdx} className="space-y-1.5 my-1.5 pl-1">
              {lines.map((line, lIdx) => {
                const match = line.match(/^(\d+)[\.\)]\s*(.*)/);
                const num = match ? match[1] : `${lIdx + 1}`;
                const text = match ? match[2] : line;
                return (
                  <li key={lIdx} className="flex items-start gap-2">
                    <span className="text-[#FF6600] font-bold shrink-0 select-none">{num}.</span>
                    <span className="flex-1">{renderFormattedInline(text)}</span>
                  </li>
                );
              })}
            </ol>
          );
        }

        // Standard paragraph
        return (
          <p key={bIdx} className="m-0">
            {lines.map((line, lIdx) => (
              <React.Fragment key={lIdx}>
                {lIdx > 0 && <br />}
                {renderFormattedInline(line)}
              </React.Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}

export default CondoMarkdown;
