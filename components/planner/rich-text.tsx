"use client";

import { Fragment } from "react";

/**
 * The little bit of markdown the models actually produce.
 *
 * Both the plan summary and the chat come back as prose with the occasional
 * **emphasis** on a course title or a number, which was being printed with the
 * asterisks still in it. This renders bold and inline code and nothing else, on
 * purpose: a full markdown renderer would let a model produce headings, tables
 * and links, and every one of those is a way for generated text to look more
 * authoritative than the plain sentences around it. Bold is enough to make a
 * course name findable in a paragraph, and that is all it is for.
 */
export function RichText({ text, className = "" }: { text: string; className?: string }) {
  const paragraphs = text.split(/\n\n+/).filter((p) => p.trim());
  return (
    <div className={className}>
      {paragraphs.map((para, i) => (
        <p key={i} className={i > 0 ? "mt-3" : undefined}>
          {inline(para.trim())}
        </p>
      ))}
    </div>
  );
}

/**
 * One paragraph, with **bold** and `code` turned into elements.
 *
 * Text arriving a few characters at a time will regularly end mid-markup, so a
 * half-written "**System desig" would otherwise be printed with its asterisks
 * showing until the closing pair caught up. Any unclosed run at the very end is
 * treated as bold that has not finished yet, which is exactly what it is.
 */
export function inline(raw: string) {
  let text = raw;
  const opens = (text.match(/\*\*/g) ?? []).length;
  if (opens % 2 === 1) text = text + "**";
  const ticks = (text.match(/`/g) ?? []).length;
  if (ticks % 2 === 1) text = text + "`";

  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return <strong key={i} className="font-semibold">{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return <code key={i} className="code rounded bg-foreground/[0.06] px-1 py-0.5 text-[0.9em]">{part.slice(1, -1)}</code>;
    }
    return <Fragment key={i}>{part}</Fragment>;
  });
}
