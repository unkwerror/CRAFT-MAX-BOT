import type { ReactNode } from 'react';

export type IconName =
  | 'arrow'
  | 'back'
  | 'brief'
  | 'building'
  | 'chat'
  | 'check'
  | 'chevron'
  | 'clock'
  | 'close'
  | 'compass'
  | 'file'
  | 'home'
  | 'location'
  | 'mail'
  | 'paperclip'
  | 'phone'
  | 'plus'
  | 'projects'
  | 'search'
  | 'shield'
  | 'spark'
  | 'upload'
  | 'warning';

const paths: Readonly<Record<IconName, ReactNode>> = {
  arrow: <path d="m8 5 7 7-7 7M15 12H3" />,
  back: <path d="m15 5-7 7 7 7M8 12h13" />,
  brief: (
    <>
      <path d="M8 7V5.7A1.7 1.7 0 0 1 9.7 4h4.6A1.7 1.7 0 0 1 16 5.7V7" />
      <path d="M5 7h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z" />
      <path d="M3 12h18M10 12v2h4v-2" />
    </>
  ),
  building: (
    <>
      <path d="M4 21V7l8-4 8 4v14M8 21v-4h8v4" />
      <path d="M8 9h.01M12 9h.01M16 9h.01M8 13h.01M12 13h.01M16 13h.01" />
    </>
  ),
  chat: (
    <>
      <path d="M21 15a4 4 0 0 1-4 4H8l-5 3 1.5-5A8 8 0 1 1 21 15Z" />
      <path d="M8 12h.01M12 12h.01M16 12h.01" />
    </>
  ),
  check: <path d="m5 12 4 4L19 6" />,
  chevron: <path d="m9 18 6-6-6-6" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  close: <path d="m6 6 12 12M18 6 6 18" />,
  compass: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m15.5 8.5-2 5-5 2 2-5 5-2Z" />
    </>
  ),
  file: (
    <>
      <path d="M6 3h8l4 4v14H6z" />
      <path d="M14 3v5h5M9 13h6M9 17h4" />
    </>
  ),
  home: (
    <>
      <path d="m3 11 9-8 9 8" />
      <path d="M5 10v11h14V10M9 21v-7h6v7" />
    </>
  ),
  location: (
    <>
      <path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z" />
      <circle cx="12" cy="10" r="2.5" />
    </>
  ),
  mail: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m4 7 8 6 8-6" />
    </>
  ),
  paperclip: (
    <path d="m20 11-8.5 8.5a5 5 0 0 1-7-7L14 3a3.5 3.5 0 0 1 5 5l-9.5 9.5a2 2 0 0 1-3-3L15 6" />
  ),
  phone: (
    <path d="M6.6 3h3l1.5 4-2 1.5a14 14 0 0 0 6.4 6.4l1.5-2 4 1.5v3c0 2-1.6 3.6-3.6 3.6C9.4 21 3 14.6 3 6.6 3 4.6 4.6 3 6.6 3Z" />
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  projects: (
    <>
      <path d="M3 21h18M5 21V9l7-5 7 5v12" />
      <path d="M9 21v-6h6v6M8 10h.01M12 10h.01M16 10h.01" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-4-4" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3 5 6v5c0 5 3 8 7 10 4-2 7-5 7-10V6l-7-3Z" />
      <path d="m9 12 2 2 4-5" />
    </>
  ),
  spark: (
    <path d="m12 3 1.7 5.3L19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7L12 3ZM19 16l.7 2.3L22 19l-2.3.7L19 22l-.7-2.3L16 19l2.3-.7L19 16Z" />
  ),
  upload: (
    <>
      <path d="M12 16V4M7 9l5-5 5 5" />
      <path d="M4 15v5h16v-5" />
    </>
  ),
  warning: (
    <>
      <path d="M10.3 4.4 2.8 18a2 2 0 0 0 1.8 3h14.8a2 2 0 0 0 1.8-3L13.7 4.4a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9v5M12 18h.01" />
    </>
  ),
};

export interface IconProps {
  readonly className?: string;
  readonly name: IconName;
  readonly size?: number;
}

export const Icon = ({ className, name, size = 24 }: IconProps) => (
  <svg
    aria-hidden="true"
    className={className}
    fill="none"
    height={size}
    viewBox="0 0 24 24"
    width={size}
  >
    <g stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8">
      {paths[name]}
    </g>
  </svg>
);
