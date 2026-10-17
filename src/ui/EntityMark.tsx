/**
 * A project's or team's mark: its initials in a small square tile, so a
 * row can be found at a glance. Projects are filled, teams are outlined.
 *
 * Brand rules: square corners (round is only for people), neutrals only
 * (the accent is a signal and the status colours mean status), Plex Sans
 * 600. The mark is decoration; the name always sits next to it, so it is
 * hidden from screen readers.
 *
 * Pass `src` (from `logoUrl`) when the project or team has an uploaded
 * logo: the image fills the same tile. If it fails to load, the initials
 * show instead.
 */

import { useState } from 'react';

const SIZE = {
  sm: 'h-5 w-5 text-[9.5px] rounded-xs',
  md: 'h-7 w-7 text-[11.5px] rounded-sm',
  lg: 'h-10 w-10 text-[15px] rounded-md',
};

/** "Example Payments" → "EP", "billing-core" → "BC", "Ledger" → "LE". */
function initials(name: string): string {
  const words = name
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

export function EntityMark({
  name,
  kind = 'project',
  size = 'sm',
  src,
  className = '',
}: {
  name: string;
  kind?: 'project' | 'team';
  size?: keyof typeof SIZE;
  src?: string;
  className?: string;
}) {
  // A logo that fails to load (removed meanwhile, or offline) falls back
  // to the initials rather than a broken image.
  const [failed, setFailed] = useState<string | null>(null);
  const showImage = !!src && failed !== src;
  return (
    <span
      aria-hidden="true"
      className={
        'inline-flex shrink-0 select-none items-center justify-center overflow-hidden border align-middle font-semibold leading-none tracking-[0.02em] ' +
        SIZE[size] +
        (showImage ? ' border-border bg-surface' : kind === 'team' ? ' border-edge bg-transparent text-muted' : ' border-border bg-sunken text-ink') +
        ' ' +
        className
      }
    >
      {showImage ? (
        <img src={src} alt="" loading="lazy" decoding="async" onError={() => setFailed(src)} className="h-full w-full object-cover" />
      ) : (
        initials(name)
      )}
    </span>
  );
}
