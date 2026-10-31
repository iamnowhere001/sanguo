import type { CSSProperties } from 'react';
import type { UnitClass } from '../core/state';
import { UNIT_CLASS_LABEL } from '../data/tables/unitClasses';

export function ClassTag({ c }: { c: UnitClass }) {
  return <span className={`tag class-${c}`}>{UNIT_CLASS_LABEL[c]}</span>;
}

export function FactionTag({
  name,
  color,
}: {
  name: string;
  color: string;
}) {
  return (
    <span className="faction-tag">
      <i style={{ background: color }} />
      {name}
    </span>
  );
}

export function Bar({
  value,
  max,
  color,
  style,
  label,
}: {
  value: number;
  max: number;
  color?: string;
  style?: CSSProperties;
  /** 有标签时暴露为 progressbar，纯装饰条保持不可见 */
  label?: string;
}) {
  const pct = Math.max(0, Math.min(100, max > 0 ? (value / max) * 100 : 0));
  return (
    <div
      className="bar-track"
      style={style}
      role={label ? 'progressbar' : undefined}
      aria-label={label}
      aria-valuemin={label ? 0 : undefined}
      aria-valuemax={label ? max : undefined}
      aria-valuenow={label ? value : undefined}
    >
      <i style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}
