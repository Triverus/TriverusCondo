import React from 'react';
import SafeAgentMarkdown from '../SafeAgentMarkdown.tsx';

interface CondoMarkdownProps {
  content: string;
  className?: string;
}

export function CondoMarkdown({ content, className = '' }: CondoMarkdownProps) {
  return <SafeAgentMarkdown content={content} className={className} />;
}

export default CondoMarkdown;
