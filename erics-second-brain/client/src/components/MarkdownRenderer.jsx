import React, { useMemo } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

// Support ==highlight== syntax (Layer 3) → <mark>
function preprocessMd(md) {
  return md.replace(/==([^=]+)==/g, '<mark>$1</mark>');
}

export default function MarkdownRenderer({ md, className = '' }) {
  const html = useMemo(() => {
    if (!md) return '';
    const raw = marked.parse(preprocessMd(md), { breaks: true, gfm: true });
    return DOMPurify.sanitize(raw, { ADD_TAGS: ['mark'] });
  }, [md]);

  return (
    <div
      className={`md-content ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
