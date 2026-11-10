import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export interface SafeAgentMarkdownProps {
  content: string;
  className?: string;
}

/**
 * Renderizador de Markdown seguro e performático para mensagens dos agentes de IA.
 * Bloqueia a execução de HTML/scripts arbitrários e garante a segurança contra protocolos perigosos em links.
 */
export function SafeAgentMarkdown({ content, className = '' }: SafeAgentMarkdownProps) {
  if (!content || typeof content !== 'string') return null;

  return (
    <div className={`text-xs sm:text-sm leading-normal text-slate-200 space-y-1.5 select-text ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml={true}
        components={{
          a: ({ href, children }) => {
            if (!href) return <span>{children}</span>;
            const cleanHref = href.trim();
            // Bloquear protocolos inseguros (javascript:, data:, vbscript:)
            if (/^(javascript|data|vbscript):/i.test(cleanHref)) {
              return <span>{children}</span>;
            }
            const isMailto = cleanHref.toLowerCase().startsWith('mailto:');
            return (
              <a
                href={cleanHref}
                target={isMailto ? '_self' : '_blank'}
                rel={isMailto ? undefined : 'noopener noreferrer'}
                className="text-[#FF6600] font-semibold underline decoration-1 underline-offset-2 hover:opacity-80 transition-opacity break-all"
              >
                {children}
              </a>
            );
          },
          p: ({ children }) => <p className="mb-1.5 last:mb-0 leading-normal">{children}</p>,
          h1: ({ children }) => <h1 className="text-sm sm:text-base font-bold text-white mt-2 mb-1">{children}</h1>,
          h2: ({ children }) => <h2 className="text-xs sm:text-sm font-bold text-white mt-2 mb-1">{children}</h2>,
          h3: ({ children }) => <h3 className="text-xs sm:text-sm font-bold text-[#FF6600] mt-1.5 mb-0.5">{children}</h3>,
          h4: ({ children }) => <h4 className="text-xs font-bold text-slate-100 mt-1 mb-0.5">{children}</h4>,
          ul: ({ children }) => <ul className="list-disc list-inside my-1 space-y-0.5 pl-1 text-slate-200">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal list-inside my-1 space-y-0.5 pl-1 text-slate-200">{children}</ol>,
          li: ({ children }) => <li className="leading-snug">{children}</li>,
          strong: ({ children }) => <strong className="font-bold text-slate-100">{children}</strong>,
          em: ({ children }) => <em className="italic text-slate-300">{children}</em>,
          code: ({ className: codeClassName, children }) => {
            const isInline = !codeClassName || !codeClassName.includes('language-');
            if (isInline) {
              return (
                <code className="px-1.5 py-0.5 rounded bg-slate-800/90 text-amber-300 font-mono text-[11px] border border-slate-700/60">
                  {children}
                </code>
              );
            }
            return (
              <pre className="p-2.5 my-1.5 rounded-xl bg-slate-950 border border-slate-800/90 text-slate-200 font-mono text-xs overflow-x-auto">
                <code>{children}</code>
              </pre>
            );
          },
          table: ({ children }) => (
            <div className="overflow-x-auto my-1.5 rounded-xl border border-slate-800">
              <table className="min-w-full text-xs text-slate-200 divide-y divide-slate-800">{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead className="bg-slate-800/80">{children}</thead>,
          tbody: ({ children }) => <tbody className="divide-y divide-slate-800/60">{children}</tbody>,
          tr: ({ children }) => <tr>{children}</tr>,
          th: ({ children }) => <th className="px-2.5 py-1 font-bold text-left text-slate-100">{children}</th>,
          td: ({ children }) => <td className="px-2.5 py-1">{children}</td>,
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-[#FF6600] pl-2.5 py-0.5 my-1.5 text-slate-400 italic bg-slate-900/40 rounded-r-lg">
              {children}
            </blockquote>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

export default SafeAgentMarkdown;
