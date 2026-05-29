/**
 * Card surface — rounded container the Figma design uses to wrap
 * tables, panels, and grouped content. Subtle border, deeper bg than
 * the page canvas, ~16-20px padding by default.
 */

import type { HTMLAttributes } from 'react';

export function Card({ className = '', ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`bg-surface border border-border rounded-xl ${className}`}
      {...rest}
    />
  );
}

export function CardHeader({ className = '', ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`px-5 py-4 border-b border-border/60 flex items-center justify-between ${className}`}
      {...rest}
    />
  );
}

export function CardBody({ className = '', ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`p-5 ${className}`} {...rest} />;
}
