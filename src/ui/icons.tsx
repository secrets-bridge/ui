/**
 * Console icons on a 24px grid: 1.75 stroke, mitred joins, butt ends,
 * one colour (`currentColor`). Right angles and 45 degrees only; no
 * padlocks, shields, keys or clouds. The four product icons (request,
 * approval, agent, audit) come from the brand files; the rest are the
 * prototype's interface icons.
 *
 * Icons are decorative (aria-hidden). Give the button or link around
 * them an accessible name.
 */

import type { ReactNode, SVGProps } from 'react';

type IconProps = Omit<SVGProps<SVGSVGElement>, 'children'> & { size?: number };

function Icon({ size = 18, className = '', children, ...rest }: IconProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinejoin="miter"
      strokeLinecap="butt"
      className={'shrink-0 ' + className}
      {...rest}
    >
      {children}
    </svg>
  );
}

export function RequestIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <rect x="3.5" y="4" width="11" height="16" />
      <path d="M10 12H20.5M17 8.5L20.5 12L17 15.5" />
    </Icon>
  );
}

export function ApprovalIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M5 3.5V20.5" />
      <path d="M9.5 12.5L13 16L20 8" />
    </Icon>
  );
}

export function AgentIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M3.5 11H20.5V20.5H3.5Z" />
      <path d="M12 16V3.5M8.5 7L12 3.5L15.5 7" />
    </Icon>
  );
}

export function AuditIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M9 6H20.5M9 12H20.5M9 18H16" />
      <path d="M4 5H6.5V7.5H4ZM4 11H6.5V13.5H4ZM4 17H6.5V19.5H4Z" />
    </Icon>
  );
}

export function OverviewIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M3.5 3.5H10.5V10.5H3.5ZM13.5 3.5H20.5V10.5H13.5ZM3.5 13.5H10.5V20.5H3.5ZM13.5 13.5H20.5V20.5H13.5Z" />
    </Icon>
  );
}

export function MenuIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M3.5 6H20.5M3.5 12H20.5M3.5 18H20.5" />
    </Icon>
  );
}

export function CloseIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M5 5L19 19M19 5L5 19" />
    </Icon>
  );
}

export function SearchIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M10.5 4A6.5 6.5 0 1 1 10.5 17A6.5 6.5 0 1 1 10.5 4Z" />
      <path d="M15.2 15.2L20.5 20.5" />
    </Icon>
  );
}

export function InfoIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 10.5V16.5M12 7.5V9" />
    </Icon>
  );
}

/** Square with a bar: "nothing here" / collapsed. */
export function MinusSquareIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M3.5 3.5H20.5V20.5H3.5Z" />
      <path d="M8 12H16" />
    </Icon>
  );
}

/** Inbox: the agent icon reversed, a value arriving into the box. */
export function InboxIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M3.5 11H20.5V20.5H3.5Z" />
      <path d="M12 3.5V16M8.5 12.5L12 16L15.5 12.5" />
    </Icon>
  );
}

/** Catalog: stacked records. */
export function CatalogIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M3.5 4H20.5V8.5H3.5ZM3.5 10H20.5V14.5H3.5ZM3.5 16H20.5V20.5H3.5Z" />
    </Icon>
  );
}
