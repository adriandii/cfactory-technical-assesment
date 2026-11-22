import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

function Icon(props: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    />
  );
}

export const UploadIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M12 15V4m0 0L7.5 8.5M12 4l4.5 4.5" />
    <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
  </Icon>
);

export const DownloadIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5" />
    <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
  </Icon>
);

export const CheckIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="12" cy="12" r="9" />
    <path d="m8.5 12.25 2.5 2.5 4.5-5" />
  </Icon>
);

export const AlertIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7.5v5.25M12 16.25v.01" />
  </Icon>
);
