/**
 * Secret key names, never values.
 * - `plain` (default): a mono comma list for tables; long lists
 *   truncate with the full list in the title.
 * - `chips`: one boxed name each, for detail panels.
 */

export function Keys({
  keys,
  variant = 'plain',
  className = '',
}: {
  keys: string[];
  variant?: 'plain' | 'chips';
  className?: string;
}) {
  if (keys.length === 0) {
    return <span className={'text-muted ' + className}>All keys</span>;
  }
  if (variant === 'chips') {
    return (
      <span className={'inline-flex flex-wrap gap-1.5 ' + className}>
        {keys.map((k) => (
          <span
            key={k}
            className="inline-flex h-[22px] items-center rounded-sm border border-border bg-sunken px-[7px] font-mono text-[12px]"
          >
            {k}
          </span>
        ))}
      </span>
    );
  }
  const list = keys.join(', ');
  return (
    <span title={list} className={'block truncate font-mono text-mono ' + className}>
      {list}
    </span>
  );
}
