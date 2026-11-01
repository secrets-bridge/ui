/**
 * Panel on the page background: `surface` with a `border` edge and a
 * 12px radius. Panels are separated by borders, never by shadow.
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
      className={`px-4 py-3.5 border-b border-border flex items-center justify-between ${className}`}
      {...rest}
    />
  );
}

export function CardBody({ className = '', ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`p-4 ${className}`} {...rest} />;
}
