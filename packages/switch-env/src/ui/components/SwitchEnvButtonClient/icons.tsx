import type { FC, SVGProps } from 'react'

export const SwitchIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg" {...props}>
    <path
      d="M8 5a1 1 0 1 0 0 2h5.586l-1.293 1.293a1 1 0 0 0 1.414 1.414l3-3a1 1 0 0 0 0-1.414l-3-3a1 1 0 1 0-1.414 1.414L13.586 5zm4 10a1 1 0 1 0 0-2H6.414l1.293-1.293a1 1 0 1 0-1.414-1.414l-3 3a1 1 0 0 0 0 1.414l3 3a1 1 0 0 0 1.414-1.414L6.414 15z"
      fill="currentColor"
    />
  </svg>
)

export const InfoIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" {...props}>
    <path
      d="M11 18h2v-2h-2zm1-16A10 10 0 0 0 2 12a10 10 0 0 0 10 10a10 10 0 0 0 10-10A10 10 0 0 0 12 2m0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8s8 3.59 8 8s-3.59 8-8 8m0-14a4 4 0 0 0-4 4h2a2 2 0 0 1 2-2a2 2 0 0 1 2 2c0 2-3 1.75-3 5h2c0-2.25 3-2.5 3-5a4 4 0 0 0-4-4"
      fill="currentColor"
    />
  </svg>
)

export const WarningIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    viewBox="0 0 24 24"
    xmlns="http://www.w3.org/2000/svg"
    {...props}
  >
    <path
      d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
)

export const LoadingSpinnerIcon: FC<SVGProps<SVGSVGElement>> = (props) => (
  <svg
    height="20px"
    preserveAspectRatio="xMidYMid"
    style={{ shapeRendering: 'auto' }}
    viewBox="0 0 100 100"
    width="20px"
    {...props}
  >
    <circle
      cx="50"
      cy="50"
      fill="none"
      r="35"
      stroke="currentColor"
      strokeDasharray="164.93361431346415 56.97787143782138"
      strokeWidth="10"
    >
      <animateTransform
        attributeName="transform"
        dur="1s"
        keyTimes="0;1"
        repeatCount="indefinite"
        type="rotate"
        values="0 50 50;360 50 50"
      />
    </circle>
  </svg>
)
