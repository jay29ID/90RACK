import { useRef, type CSSProperties, type ReactNode } from 'react';

/** A rack-mounted component: ears, screws, brand + model silkscreen. */
export function Unit(props: {
  u?: number;
  brand?: string;
  model: string;
  name: string;
  active?: boolean;
  finish?: 'black' | 'silver' | 'titanium';
  className?: string;
  children: ReactNode;
  id?: string;
}) {
  const { u = 2, brand = '90RACK', model, name, active, finish = 'black', className = '', children, id } = props;
  return (
    <section
      id={id}
      className={`unit unit-${finish} ${active ? 'is-active' : ''} ${className}`}
      style={{ '--u': u } as CSSProperties}
      aria-label={name}
    >
      <div className="ear left">
        <i className="screw" />
        <i className="screw" />
      </div>
      <div className="faceplate">
        <div className="silk">
          <span className="brand">{brand}</span>
          <span className="model">{model}</span>
          <span className="name">{name}</span>
        </div>
        {children}
      </div>
      <div className="ear right">
        <i className="screw" />
        <i className="screw" />
      </div>
    </section>
  );
}

export function Vfd(props: { children: ReactNode; color?: 'cyan' | 'amber' | 'green' | 'red'; className?: string; style?: CSSProperties }) {
  return (
    <div className={`vfd vfd-${props.color ?? 'cyan'} ${props.className ?? ''}`} style={props.style}>
      <div className="vfd-glass">{props.children}</div>
    </div>
  );
}

export function Led(props: { on?: boolean; color?: 'red' | 'green' | 'amber' | 'blue'; label?: string; blink?: boolean }) {
  return (
    <span className="led-wrap">
      <i className={`led led-${props.color ?? 'green'} ${props.on ? 'on' : ''} ${props.blink ? 'blink' : ''}`} />
      {props.label && <span className="led-label">{props.label}</span>}
    </span>
  );
}

export function Btn(props: {
  onClick?: () => void;
  label?: ReactNode;
  title?: string;
  children?: ReactNode;
  lit?: boolean;
  variant?: 'pill' | 'round' | 'square' | 'wide' | 'power';
  disabled?: boolean;
  className?: string;
}) {
  const { variant = 'pill' } = props;
  return (
    <div className={`btn-wrap ${props.className ?? ''}`}>
      <button
        type="button"
        className={`hw-btn hw-${variant} ${props.lit ? 'lit' : ''}`}
        onClick={props.onClick}
        title={props.title}
        aria-label={props.title ?? (typeof props.label === 'string' ? props.label : undefined)}
        disabled={props.disabled}
      >
        {props.children}
      </button>
      {props.label !== undefined && <span className="btn-label">{props.label}</span>}
    </div>
  );
}

/** Big rotary knob: drag up/down, scroll, or arrow keys. */
export function Knob(props: { value: number; onChange: (v: number) => void; size?: number; label?: string; detents?: boolean }) {
  const { value, onChange, size = 96, label } = props;
  const drag = useRef<{ y: number; v: number } | null>(null);
  const clamp = (v: number) => Math.max(0, Math.min(100, v));
  const angle = -135 + (value / 100) * 270;

  return (
    <div className="knob-wrap">
      <div
        className="knob"
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(value)}
        style={{ width: size, height: size }}
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          drag.current = { y: e.clientY, v: value };
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          onChange(clamp(drag.current.v + (drag.current.y - e.clientY) * 0.4));
        }}
        onPointerUp={() => (drag.current = null)}
        onWheel={(e) => onChange(clamp(value - Math.sign(e.deltaY) * 2))}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp' || e.key === 'ArrowRight') onChange(clamp(value + 2));
          else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') onChange(clamp(value - 2));
          else return;
          e.preventDefault();
          e.stopPropagation();
        }}
      >
        <div className="knob-ring" />
        <div className="knob-cap" style={{ transform: `rotate(${angle}deg)` }}>
          <i className="knob-dot" />
        </div>
      </div>
      {label && <span className="btn-label">{label}</span>}
    </div>
  );
}

/** Small transport icon glyphs, drawn rather than emoji so they look silkscreened. */
export function Glyph({ name }: { name: 'play' | 'pause' | 'playpause' | 'stop' | 'next' | 'prev' | 'ff' | 'rew' | 'eject' | 'rec' }) {
  const p: Record<string, ReactNode> = {
    play: <path d="M5 3l12 7-12 7z" />,
    pause: <path d="M4 3h4v14H4zM12 3h4v14h-4z" />,
    playpause: <path d="M2 3l8 7-8 7zM12 3h2.5v14H12zM16 3h2.5v14H16z" />,
    stop: <path d="M4 4h12v12H4z" />,
    next: <path d="M3 3l9 7-9 7zM13 3h3v14h-3z" />,
    prev: <path d="M17 3l-9 7 9 7zM4 3h3v14H4z" />,
    ff: <path d="M1 4l8 6-8 6zM10 4l8 6-8 6z" />,
    rew: <path d="M19 4l-8 6 8 6zM10 4l-8 6 8 6z" />,
    eject: <path d="M10 3l8 8H2zM2 14h16v3H2z" />,
    rec: <circle cx="10" cy="10" r="6" />,
  };
  return (
    <svg viewBox="0 0 20 20" className="glyph" aria-hidden>
      {p[name]}
    </svg>
  );
}

/** Cover art; demo items get a generated 90s-gradient sleeve instead. */
export function Cover(props: { src?: string; title: string; subtitle?: string; className?: string; style?: CSSProperties }) {
  const { src, title, subtitle, className = '', style } = props;
  if (src && !src.startsWith('demo:')) {
    return <img className={`cover ${className}`} src={src} alt={title} loading="lazy" style={style} />;
  }
  let h = 0;
  for (const c of title) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const hue = h % 360;
  const hue2 = (hue + 40 + (h % 120)) % 360;
  const pattern = h % 4;
  const bg = [
    `radial-gradient(circle at 30% 30%, hsl(${hue} 90% 65%), transparent 55%), linear-gradient(135deg, hsl(${hue2} 70% 25%), hsl(${hue} 60% 12%))`,
    `repeating-linear-gradient(45deg, hsl(${hue} 80% 55%) 0 12px, hsl(${hue2} 70% 30%) 12px 24px)`,
    `conic-gradient(from ${h % 360}deg, hsl(${hue} 85% 55%), hsl(${hue2} 80% 45%), hsl(${(hue + 200) % 360} 70% 35%), hsl(${hue} 85% 55%))`,
    `linear-gradient(180deg, hsl(${hue} 90% 60%) 0 40%, hsl(${hue2} 80% 20%) 40%), radial-gradient(circle at 50% 40%, #fff3 0 20%, transparent 21%)`,
  ][pattern];
  return (
    <div className={`cover cover-gen ${className}`} style={{ background: bg, ...style }} role="img" aria-label={title}>
      <span className="cover-gen-title">{title}</span>
      {subtitle && <span className="cover-gen-sub">{subtitle}</span>}
    </div>
  );
}
