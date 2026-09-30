/**
 * Format idents: one drawn ident per use case (400x300), in that use case's ident colour. Ported
 * from the On Air baseline. The drawings are static markup built here (no user data inside).
 * A use case without a drawing (a new YAML) gets a neutral ident, never someone else's.
 */
import { identColors } from "@statreel/design-tokens";

function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

const ART: Record<string, () => string> = {
  "counterfactual-timelines": () =>
    '<path class="a-rule" d="M20 250H380M170 40V250"/>' +
    '<path class="a-line a-draw" pathLength="1" d="M20 222 62 204 104 214 170 160 214 172 262 140 318 156 380 128"/>' +
    '<path class="a-ghost a-fade" style="--i:6;--o:.85" d="M170 160 212 124 258 104 312 66 380 44"/>' +
    '<circle class="a-white a-pop" style="--i:8" cx="170" cy="160" r="9"/><circle class="a-fill a-pop" style="--i:9" cx="170" cy="160" r="4.5"/>' +
    '<circle class="a-fill a-pop" style="--i:14" cx="380" cy="128" r="7"/>' +
    '<circle class="a-pop" style="--i:16" cx="380" cy="44" r="7" fill="none" stroke="var(--color-text)" stroke-width="2.4"/>' +
    '<path class="a-soft a-fade" style="--i:7;--o:.16" d="M170 160 212 124 258 104 312 66 380 44V128L318 156 262 140 214 172Z"/>',
  "era-adjusted-rankings": () => {
    const to = [4, 3, 6, 1, 2, 5];
    let s = '<path class="a-rule" d="M96 30V270M304 30V270"/>';
    for (let i = 0; i < 6; i++) {
      const y1 = 50 + i * 40;
      const y2 = 50 + ((to[i] ?? 1) - 1) * 40;
      const hot = i === 3;
      s +=
        `<path class="${hot ? "a-line" : "a-thin"} a-draw" pathLength="1" style="--i:${hot ? 7 : i}${hot ? ";stroke-width:5" : ""}" d="M96 ${y1}L304 ${y2}"/>` +
        `<circle class="${hot ? "a-fill" : "a-white"} a-pop" style="--i:${i}" cx="96" cy="${y1}" r="${hot ? 8 : 4.5}"/>` +
        `<circle class="${hot ? "a-fill" : "a-white"} a-pop" style="--i:${i + 10}" cx="304" cy="${y2}" r="${hot ? 10 : 4.5}"/>`;
    }
    return (
      s +
      '<text class="a-fade" style="--i:9" x="326" y="66" font-size="46">1</text><text class="a-fade" style="--i:2;--o:.5" x="46" y="186" font-size="46" opacity=".5">4</text>'
    );
  },
  "spatial-career-maps": () => {
    const r = rng(11);
    let s =
      '<path class="a-thin a-draw" pathLength="1" d="M30 30H370V270H30Z"/><path class="a-thin a-draw" pathLength="1" style="--i:1" d="M110 30V118H290V30M160 30V62H240V30"/><path class="a-thin a-draw" pathLength="1" style="--i:2" d="M158 118A46 46 0 0 0 242 118"/><path class="a-line" d="M176 30V18H224V30"/>';
    for (let i = 0; i < 26; i++) {
      const x = 70 + r() * 260;
      const y = 60 + r() * 170;
      const rad = 3 + r() * 8;
      s += `<circle class="${i % 5 === 0 ? "a-fill" : "a-soft"} a-pop" style="--i:${i + 4}${i % 5 === 0 ? "" : ";opacity:.5"}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${rad.toFixed(1)}"/>`;
    }
    return (
      s +
      '<path class="a-line a-draw" pathLength="1" style="--i:12" d="M262 214Q236 120 204 34"/><circle class="a-white a-pop" style="--i:30" cx="262" cy="214" r="7"/>'
    );
  },
  "network-flow-timelines": () => {
    const n = [
      [60, 150],
      [130, 70],
      [140, 228],
      [210, 140],
      [270, 60],
      [290, 222],
      [350, 140],
      [206, 262],
    ] as const;
    const e = [
      [0, 1, 2],
      [0, 2, 5],
      [1, 3, 7],
      [2, 3, 3],
      [3, 4, 4],
      [3, 5, 8],
      [4, 6, 3],
      [5, 6, 6],
      [2, 7, 2],
      [7, 5, 3],
      [1, 4, 2],
    ] as const;
    let s = "";
    e.forEach((x, i) => {
      const a = n[x[0]] ?? [0, 0];
      const b = n[x[1]] ?? [0, 0];
      s += `<path class="a-line a-draw" pathLength="1" style="--i:${i};stroke-width:${x[2]};opacity:${0.35 + x[2] / 13}" d="M${a[0]} ${a[1]}L${b[0]} ${b[1]}"/>`;
    });
    n.forEach((p, i) => {
      const big = i === 3 || i === 5;
      s += `<circle class="a-pop" style="--i:${i * 2}" cx="${p[0]}" cy="${p[1]}" r="${big ? 17 : 11}" fill="var(--color-bg)" stroke="currentColor" stroke-width="3"/>`;
      if (big) s += `<circle class="a-fill a-pop" style="--i:${i * 2 + 4}" cx="${p[0]}" cy="${p[1]}" r="7"/>`;
    });
    return s;
  },
  "distribution-races": () => {
    let s = "";
    for (let i = 0; i < 5; i++) {
      const y = 78 + i * 46;
      const mu = 110 + i * 42;
      const sd = 58 - i * 6;
      const h = 50 + i * 9;
      let d = `M24 ${y}`;
      for (let x = 24; x <= 376; x += 8) {
        const v = Math.exp(-(((x - mu) / sd) ** 2) / 2) * h;
        d += `L${x} ${(y - v).toFixed(1)}`;
      }
      s +=
        `<path class="a-fade" style="--i:${i};--o:1" fill="var(--color-bg)" d="${d}L376 ${y}Z"/>` +
        `<path class="a-soft a-fade" style="--i:${i};--o:${(0.12 + i * 0.07).toFixed(2)}" d="${d}L376 ${y}Z"/>` +
        `<path class="a-line a-draw" pathLength="1" style="--i:${i};stroke-width:${i === 4 ? 4 : 2.4}" d="${d}"/>`;
    }
    return `${s}<path class="a-rule" d="M24 264H376"/>`;
  },
  "probability-narratives": () => {
    const pts = [
      [20, 150],
      [60, 138],
      [88, 162],
      [120, 120],
      [150, 176],
      [186, 206],
      [214, 150],
      [246, 96],
      [280, 124],
      [314, 62],
      [350, 48],
      [380, 34],
    ];
    const d = pts.map((p, i) => `${i ? "L" : "M"}${p[0]} ${p[1]}`).join("");
    return (
      '<path class="a-rule" d="M20 150H380" stroke-dasharray="2 6"/><path class="a-rule" d="M20 30H380M20 270H380"/>' +
      `<path class="a-soft a-fade" style="--i:5;--o:.16" d="${d}L380 150L20 150Z"/>` +
      `<path class="a-line a-draw" pathLength="1" d="${d}"/>` +
      '<path class="a-ghost a-fade" style="--i:8;--o:.7" d="M186 206V270M314 62V30"/>' +
      '<circle class="a-white a-pop" style="--i:16" cx="186" cy="206" r="8"/><circle class="a-white a-pop" style="--i:22" cx="314" cy="62" r="8"/>' +
      '<circle class="a-fill a-pop" style="--i:26" cx="380" cy="34" r="8"/>' +
      '<text class="a-fade" style="--i:9;--o:.5" x="24" y="142" font-size="24" opacity=".5">50</text>'
    );
  },
  "similarity-dna": () => {
    const r = rng(7);
    const c = [
      [110, 100, 50],
      [270, 110, 56],
      [200, 218, 46],
    ] as const;
    let s = "";
    for (let i = 0; i < 40; i++) {
      const k = c[i % 3] ?? c[0];
      const a = r() * 6.283;
      const q = Math.sqrt(r()) * k[2];
      s += `<circle class="a-soft a-pop" style="--i:${i};opacity:${(0.3 + r() * 0.5).toFixed(2)}" cx="${(k[0] + Math.cos(a) * q).toFixed(1)}" cy="${(k[1] + Math.sin(a) * q * 0.8).toFixed(1)}" r="${(3 + r() * 4).toFixed(1)}"/>`;
    }
    return (
      s +
      '<path class="a-line a-draw" pathLength="1" style="--i:8" d="M246 96 292 132"/>' +
      '<circle class="a-pop" style="--i:40" cx="246" cy="96" r="15" fill="none" stroke="currentColor" stroke-width="2"/><circle class="a-fill a-pop" style="--i:42" cx="246" cy="96" r="7"/>' +
      '<circle class="a-pop" style="--i:44" cx="292" cy="132" r="15" fill="none" stroke="var(--color-text)" stroke-width="2"/><circle class="a-white a-pop" style="--i:46" cx="292" cy="132" r="7"/>'
    );
  },
  "metric-explainer-shorts": () => {
    let s = '<rect class="a-line a-draw" pathLength="1" x="128" y="14" width="144" height="272" rx="10"/>';
    const o = [0.12, 0.3, 0.55, 0.2, 0.45, 0.9, 0.16, 0.36, 0.66];
    for (let i = 0; i < 9; i++)
      s += `<rect class="a-fill a-fade" style="--i:${i};--o:${o[i]}" x="${146 + (i % 3) * 38}" y="${150 + Math.floor(i / 3) * 38}" width="32" height="32"/>`;
    return (
      s +
      '<text class="a-fade" style="--i:3" x="200" y="116" font-size="92" text-anchor="middle">xT</text>' +
      '<path class="a-thin" d="M146 128H254"/><path class="a-rule" d="M60 60H104M60 84H92M296 210H340M308 234H340"/>'
    );
  },
  "reactive-weekend-pipeline": () => {
    let s =
      '<rect class="a-thin a-draw" pathLength="1" x="28" y="92" width="120" height="120"/><rect class="a-line a-draw" pathLength="1" style="--i:4" x="252" y="92" width="120" height="120"/>' +
      '<text class="a-fade" style="--i:1;--o:.55" x="88" y="172" font-size="58" text-anchor="middle" opacity=".55">SUN</text><text class="a-fade" style="--i:6" x="312" y="172" font-size="58" text-anchor="middle">MON</text>' +
      '<circle class="a-thin" cx="200" cy="152" r="40"/><path class="a-line a-draw" pathLength="1" style="--i:3" d="M200 112A40 40 0 1 1 160 152"/>' +
      '<path class="a-line" style="stroke-width:4" d="M200 152V124"/><circle class="a-fill" cx="200" cy="152" r="5"/><path class="a-line" d="M192 100H208M200 100V110"/>';
    for (let i = 0; i < 12; i++) {
      const a = (i * Math.PI) / 6;
      s += `<path class="a-rule" style="opacity:.5" d="M${(200 + Math.cos(a) * 33).toFixed(1)} ${(152 + Math.sin(a) * 33).toFixed(1)}L${(200 + Math.cos(a) * 37).toFixed(1)} ${(152 + Math.sin(a) * 37).toFixed(1)}"/>`;
    }
    return `${s}<path class="a-line a-draw" pathLength="1" style="--i:8" d="M152 236H244M234 226l12 10-12 10"/>`;
  },
  "interactive-companion-loop": () =>
    '<rect class="a-line a-draw" pathLength="1" x="34" y="36" width="332" height="228" rx="8"/><path class="a-thin" d="M34 72H366"/>' +
    '<circle class="a-fill a-pop" cx="56" cy="54" r="5"/><circle class="a-soft a-pop" style="--i:2;opacity:.6" cx="74" cy="54" r="5"/><circle class="a-soft a-pop" style="--i:4;opacity:.35" cx="92" cy="54" r="5"/>' +
    '<path class="a-thin a-draw" pathLength="1" style="--i:3" d="M60 210 108 176 150 190 204 128 250 150 300 104 340 116"/>' +
    '<path class="a-rule" d="M60 232H340"/><path class="a-line" style="stroke-width:4" d="M60 232H204"/><circle class="a-white a-pop" style="--i:12" cx="204" cy="232" r="9"/>' +
    '<path class="a-ghost a-fade" style="--i:6;--o:.6" d="M204 92V222"/><circle class="a-fill a-pop" style="--i:14" cx="204" cy="128" r="8"/>' +
    '<path class="a-pop" style="--i:18" d="M236 170l4 38 10-10 9 17 8-4-9-17 14-2z" fill="var(--color-text)" stroke="var(--color-bg)" stroke-width="2"/>',
};

const NEUTRAL = () =>
  '<path class="a-rule" d="M40 250H360M40 50V250"/><path class="a-line a-draw" pathLength="1" d="M40 220 120 180 200 196 280 120 360 100"/>';

const cache = new Map<string, string>();
function markup(id: string): string {
  let m = cache.get(id);
  if (m === undefined) {
    m = (ART[id] ?? NEUTRAL)();
    cache.set(id, m);
  }
  return m;
}

/** The ident colour of a use case, as a token reference (falls back to muted text). */
export const identVar = (id: string): string => (id in identColors ? `var(--ident-${id})` : "var(--color-text-muted)");

export const hasIdent = (id: string): boolean => id in ART;

export function Ident({ id, name, live = false }: { id: string; name?: string; live?: boolean }) {
  return (
    <svg
      className={`art${live ? " art--live" : ""}`}
      viewBox="0 0 400 300"
      style={{ ["--art" as string]: identVar(id) }}
      role="img"
      aria-label={`Drawn ident for ${name ?? id}`}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: static drawing markup built in this module
      dangerouslySetInnerHTML={{ __html: markup(id) }}
    />
  );
}
