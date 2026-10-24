import type { SVGProps } from "react";

/** One icon family: 24px grid, 1.6 stroke, round caps. Decorative by default. */
function Icon({ children, size = 18, ...rest }: SVGProps<SVGSVGElement> & { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden {...rest}>
      {children}
    </svg>
  );
}

export const IconDecisions = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="4.5" /><circle cx="12" cy="12" r="1" fill="currentColor" /></Icon>
);
export const IconOrders = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}><path d="M4 7.5 12 3l8 4.5v9L12 21l-8-4.5z" /><path d="M4 7.5 12 12l8-4.5M12 12v9" /></Icon>
);
export const IconData = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}><ellipse cx="12" cy="6" rx="7.5" ry="2.8" /><path d="M4.5 6v6c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8V6" /><path d="M4.5 12v6c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8v-6" /></Icon>
);
export const IconRules = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}><path d="M5 5v14M12 5v14M19 5v14" /><circle cx="5" cy="9" r="2" /><circle cx="12" cy="15" r="2" /><circle cx="19" cy="8" r="2" /></Icon>
);
export const IconOversight = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="3" /></Icon>
);
export const IconClose = (p: SVGProps<SVGSVGElement>) => <Icon {...p}><path d="M6 6l12 12M18 6 6 18" /></Icon>;
export const IconSearch = (p: SVGProps<SVGSVGElement>) => <Icon {...p}><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" /></Icon>;
export const IconArrowRight = (p: SVGProps<SVGSVGElement>) => <Icon {...p}><path d="M5 12h14M13 6l6 6-6 6" /></Icon>;
export const IconArrowUpRight = (p: SVGProps<SVGSVGElement>) => <Icon {...p}><path d="M7 17 17 7M8 7h9v9" /></Icon>;
export const IconDownload = (p: SVGProps<SVGSVGElement>) => <Icon {...p}><path d="M12 4v11M7 10l5 5 5-5M5 20h14" /></Icon>;
export const IconCheck = (p: SVGProps<SVGSVGElement>) => <Icon {...p}><path d="m5 12.5 4.5 4.5L19 7.5" /></Icon>;
export const IconAlert = (p: SVGProps<SVGSVGElement>) => <Icon {...p}><path d="M12 4 2.8 19.5h18.4z" /><path d="M12 10v4.5M12 17.2v.1" /></Icon>;
export const IconPause = (p: SVGProps<SVGSVGElement>) => <Icon {...p}><path d="M9 6v12M15 6v12" /></Icon>;
export const IconUp = (p: SVGProps<SVGSVGElement>) => <Icon {...p}><path d="M12 19V5M6 11l6-6 6 6" /></Icon>;
export const IconQuestion = (p: SVGProps<SVGSVGElement>) => <Icon {...p}><circle cx="12" cy="12" r="8.5" /><path d="M9.6 9.5a2.5 2.5 0 1 1 3.4 2.3c-.6.3-1 .8-1 1.5v.4M12 16.6v.1" /></Icon>;
export const IconPulse = (p: SVGProps<SVGSVGElement>) => <Icon {...p}><path d="M3 12h4l2.5-6 4.5 12 2.5-6H21" /></Icon>;
export const IconUpload = (p: SVGProps<SVGSVGElement>) => <Icon {...p}><path d="M12 16V5M7 10l5-5 5 5M5 20h14" /></Icon>;
export const IconFile = (p: SVGProps<SVGSVGElement>) => <Icon {...p}><path d="M14 3H7a1.5 1.5 0 0 0-1.5 1.5v15A1.5 1.5 0 0 0 7 21h10a1.5 1.5 0 0 0 1.5-1.5V7.5z" /><path d="M14 3v4.5h4.5" /></Icon>;
export const IconSpark = (p: SVGProps<SVGSVGElement>) => <Icon {...p}><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18" /></Icon>;
export const IconUndo = (p: SVGProps<SVGSVGElement>) => <Icon {...p}><path d="M9 14 4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" /></Icon>;

/** The Freshroots mark: a core with one tilted orbit. */
export function Mark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <circle cx="16" cy="16" r="15" fill="var(--night-3)" />
      <ellipse cx="16" cy="16" rx="12" ry="5" fill="none" stroke="var(--spice)" strokeOpacity=".55" strokeWidth="1.2" transform="rotate(-24 16 16)" />
      <circle cx="16" cy="16" r="5" fill="var(--spice)" />
      <circle cx="26.4" cy="11.3" r="1.6" fill="var(--cream)" />
    </svg>
  );
}
