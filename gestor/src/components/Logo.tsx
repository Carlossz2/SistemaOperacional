/** Marca da CADIGITAL (barras subindo + seta). Mesmo desenho do favicon e dos ícones do app. */
export function LogoMark({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="93 91 214 214" aria-hidden="true">
      <g fill="currentColor">
        <rect x="152" y="221" width="27" height="52" rx="1" />
        <rect x="192" y="196" width="27" height="77" rx="1" />
        <rect x="232" y="164" width="27" height="109" rx="1" />
        <path d="M227 134.5 L256.5 118.5 L246.5 150 Z" />
      </g>
      <polyline points="131,222 150,200 162.5,207 192,172.5 204.5,180 239,140" fill="none" stroke="currentColor" strokeWidth="5.6" strokeLinecap="round" strokeMiterlimit="3" />
      <line x1="139.5" y1="277" x2="269" y2="277" stroke="currentColor" strokeWidth="4.6" strokeLinecap="round" />
    </svg>
  );
}
