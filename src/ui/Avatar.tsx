/**
 * A person's initials in a circle. Round is only for people. Decoration:
 * their name always sits next to it, so it is hidden from screen readers.
 */

const SIZE = {
  sm: 'h-[30px] w-[30px] text-[11.5px]',
  md: 'h-8 w-8 text-[12px]',
  lg: 'h-10 w-10 text-[13.5px]',
};

function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  const first = words[0].charAt(0);
  const second = words.length > 1 ? words[words.length - 1].charAt(0) : '';
  return (first + second).toUpperCase();
}

export function Avatar({ name, size = 'md' }: { name: string; size?: keyof typeof SIZE }) {
  return (
    <span
      aria-hidden="true"
      className={'inline-flex shrink-0 items-center justify-center rounded-full border border-border bg-raised font-semibold text-ink ' + SIZE[size]}
    >
      {initialsOf(name)}
    </span>
  );
}
