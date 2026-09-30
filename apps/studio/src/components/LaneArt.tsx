/**
 * The ten lane illustrations of Photo Finish (A/3 SR.art, 600 x 360): stylised line-and-streak
 * art, one per use case, drawn in the lane colour. Decorative drawings, never a frame of a real
 * video (the caption says so where they appear). Unknown use cases get a neutral ruled lane.
 */
/* biome-ignore-all lint/style/useTemplate: ported string builders, kept close to the A/3 source */
import { useId } from "react";

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

  function P(d: string, i?: number, extra?: string): string {   /* a drawn stroke; dashed strokes fade in instead so their dash pattern survives */
    let dashed = extra && extra.indexOf('stroke-dasharray') >= 0;
    return '<path class="' + (dashed ? 'a-f' : 'a-d') + '" pathLength="1" style="--i:' + (i || 0) + '" d="' + d + '"' + (extra || '') + '/>';
  }
  function F(inner: string, i?: number): string { return '<g class="a-f" style="--i:' + (i || 0) + '">' + inner + '</g>'; }
  function streaks(id: string, list: [number, number, number, number, number][]): string {
    return list.map((s, i) => {
      return '<rect class="a-streak" style="--i:' + i + '" x="' + s[0] + '" y="' + s[1] + '" width="' + s[2] + '" height="' + s[3] + '" rx="' + (s[3] / 2) + '" fill="url(#' + id + ')" stroke="none" opacity="' + (s[4] || .5) + '"/>';
    }).join('');
  }
const ART: Record<string, (g: string) => string> = {
    'counterfactual-timelines': (g: string): string => {
      return streaks(g, [[20, 236, 300, 26, .5], [300, 66, 270, 20, .35]]) +
        '<path class="a-f" style="--i:1" d="M300 40V320" stroke-dasharray="3 6" opacity=".55"/>' +
        P('M40 250C110 242 150 204 200 210S268 192 300 170', 0, ' stroke-width="4"') +
        P('M300 170C338 152 372 214 430 218S520 238 562 226', 6, ' stroke-width="4"') +
        P('M300 170C340 148 388 120 440 100S522 68 562 58', 10, ' stroke-width="3" stroke-dasharray=".02 .025"') +
        F('<circle cx="300" cy="170" r="9" fill="var(--art-ground)" stroke-width="3"/><circle cx="300" cy="170" r="3" fill="currentColor" stroke="none"/>', 6) +
        F('<circle cx="562" cy="226" r="7" fill="currentColor" stroke="none"/>', 12) +
        F('<circle cx="562" cy="58" r="8" fill="var(--art-ground)" stroke-width="2.5" stroke-dasharray="3 3"/>', 16) +
        F('<path d="M300 170L562 58L562 226Z" fill="currentColor" stroke="none" opacity=".07"/>', 14);
    },
    'era-adjusted-rankings': (g: string): string => {
      let map = [5, 4, 6, 8, 7, 2, 3, 1], h = streaks(g, [[170, 50, 260, 24, .55]]), y = (r: number): number => 60 + (r - 1) * 34;
      h += '<path d="M170 44V316M430 44V316" stroke-width="1.5" opacity=".6"/>';
      map.forEach((to, i) => {
        let hero = i === 7;
        h += P('M170 ' + y(i + 1) + 'L430 ' + y(to), hero ? 12 : i, hero ? ' stroke-width="6"' : ' stroke-width="1.8" opacity=".7"');
        h += F('<circle cx="170" cy="' + y(i + 1) + '" r="' + (hero ? 8 : 4.5) + '" fill="' + (hero ? 'currentColor' : 'var(--art-ground)') + '"/><path d="M128 ' + y(i + 1) + 'h' + (26 - i * 2) + '" stroke-width="3" opacity=".45"/>', i);
        h += F('<circle cx="430" cy="' + y(to) + '" r="' + (hero ? 8 : 4.5) + '" fill="' + (hero ? 'currentColor' : 'var(--art-ground)') + '"/><path d="M446 ' + y(to) + 'h' + (hero ? 60 : 30 - to * 2) + '" stroke-width="' + (hero ? 6 : 3) + '" opacity="' + (hero ? 1 : .45) + '"/>', hero ? 18 : i + 6);
      });
      return h;
    },
    'spatial-career-maps': (g: string): string => {
      let r = rng(31), h = streaks(g, [[300, 150, 250, 60, .35]]);
      h += P('M70 40H530V320H70Z', 0) + P('M530 95H410V265H530', 3) + P('M530 140H490V220H530', 5) + P('M410 145A50 50 0 0 0 410 215', 6) +
        P('M70 134A46 46 0 0 1 70 226', 2) + P('M530 160h12v40h-12', 7, ' stroke-width="3"');
      for (let i = 0; i < 40; i++) {
        let a = r() * Math.PI * 2, d = Math.pow(r(), .7) * 150, x = 462 - Math.abs(Math.cos(a)) * d * 1.25, y = 180 + Math.sin(a) * d * .72;
        let goal = r() > .8, rad = 3 + r() * 7;
        h += F('<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="' + rad.toFixed(1) + '" ' + (goal ? 'fill="currentColor" stroke="none"' : 'fill="currentColor" fill-opacity=".12" stroke-width="1.5"') + '/>', 8 + i * .6);
      }
      return h;
    },
    'network-flow-timelines': (g: string): string => {
      let n: [number, number][] = [[70, 180], [172, 66], [160, 142], [160, 218], [172, 294], [292, 106], [270, 180], [292, 254], [424, 78], [452, 180], [424, 282]];
      let e: [number, number, number][] = [[0, 2, 3], [0, 3, 3], [1, 2, 2], [2, 3, 5], [3, 4, 2], [1, 5, 4], [2, 6, 7], [3, 6, 6], [4, 7, 3], [5, 6, 5], [6, 7, 4], [5, 8, 5], [6, 9, 8], [7, 10, 4], [8, 9, 3], [9, 10, 3], [5, 9, 2], [2, 5, 2], [3, 7, 2]];
      let size = [9, 10, 13, 13, 10, 14, 19, 13, 12, 16, 12], h = streaks(g, [[250, 168, 300, 24, .4]]);
      e.forEach((x, i) => {
        const a = n[x[0]] as [number, number], b = n[x[1]] as [number, number];
        h += P('M' + a[0] + ' ' + a[1] + 'L' + b[0] + ' ' + b[1], i * .6, ' stroke-width="' + x[2] + '" opacity="' + (.25 + x[2] / 12) + '"');
      });
      n.forEach((p, i) => {
        h += F('<circle cx="' + p[0] + '" cy="' + p[1] + '" r="' + size[i] + '" fill="' + (i === 6 || i === 9 ? 'currentColor' : 'var(--art-ground)') + '" stroke-width="2.5"/>', 6 + i);
      });
      return h + F('<path d="M486 180h70M540 166l16 14-16 14" stroke-width="3"/>', 20);
    },
    'distribution-races': (g: string): string => {
      let h = streaks(g, [[330, 286, 230, 22, .4]]);
      for (let i = 0; i < 6; i++) {
        let base = 96 + i * 46, cx = 170 + i * 52, sd = 44 + i * 9, amp = 70 - i * 3, d = 'M40 ' + base;
        for (let x = 40; x <= 560; x += 10) {
          let y = base - amp * Math.exp(-Math.pow(x - cx, 2) / (2 * sd * sd)) - (i > 2 ? 16 * Math.exp(-Math.pow(x - cx - 110, 2) / 1800) : 0);
          d += 'L' + x + ' ' + y.toFixed(1);
        }
        h += '<path class="a-f" style="--i:' + (i * 2) + '" d="' + d + 'L560 ' + base + 'Z" fill="var(--art-ground)" stroke="none"/>' +
          '<path class="a-f" style="--i:' + (i * 2) + '" d="' + d + 'L560 ' + base + 'Z" fill="currentColor" fill-opacity="' + (.06 + i * .035) + '" stroke="none"/>' +
          P(d, i * 2, ' stroke-width="' + (i === 5 ? 3.5 : 2) + '"');
      }
      return h;
    },
    'probability-narratives': (g: string): string => {
      let pts = [[50, 180], [90, 168], [120, 176], [150, 150], [185, 158], [215, 120], [250, 132], [285, 196], [320, 236], [350, 228], [378, 262], [410, 150], [440, 96], [470, 108], [505, 70], [550, 52]];
      let d = 'M' + pts.map((p) => `${p[0]} ${p[1]}`).join('L');
      return streaks(g, [[380, 78, 180, 24, .4]]) +
        '<path d="M50 180H550" stroke-dasharray="2 7" opacity=".7"/><path d="M50 40V320" stroke-width="1.5" opacity=".5"/>' +
        F('<path d="' + d + 'L550 180L50 180Z" fill="currentColor" fill-opacity=".1" stroke="none"/>', 8) +
        P(d, 0, ' stroke-width="4"') +
        F('<path d="M378 262V322" stroke-dasharray="3 4"/><circle cx="378" cy="262" r="9" fill="var(--art-ground)" stroke-width="3"/>', 10) +
        F('<path d="M440 96V322" stroke-dasharray="3 4"/><circle cx="440" cy="96" r="9" fill="currentColor"/>', 13) +
        F('<circle cx="550" cy="52" r="6" fill="currentColor" stroke="none"/>', 16);
    },
    'similarity-dna': (g: string): string => {
      let r = rng(7), h = streaks(g, [[190, 168, 190, 22, .4]]), cl: [number, number, number][] = [[170, 120, 70], [400, 110, 80], [300, 250, 90]];
      h += F('<circle cx="170" cy="120" r="92" stroke-dasharray="2 8" opacity=".5"/><circle cx="400" cy="112" r="104" stroke-dasharray="2 8" opacity=".5"/><circle cx="300" cy="252" r="110" stroke-dasharray="2 8" opacity=".5"/>', 0);
      for (let i = 0; i < 72; i++) {
        let c = cl[i % 3] as [number, number, number], a = r() * 6.283, d = Math.sqrt(r()) * c[2];
        h += F('<circle cx="' + (c[0] + Math.cos(a) * d * 1.15).toFixed(1) + '" cy="' + (c[1] + Math.sin(a) * d * .85).toFixed(1) + '" r="' + (2.6 + r() * 3).toFixed(1) + '" fill="currentColor" fill-opacity="' + (.2 + r() * .4).toFixed(2) + '" stroke="none"/>', 1 + i * .25);
      }
      return h + P('M236 176L352 214', 18, ' stroke-width="3"') +
        F('<circle cx="236" cy="176" r="15" fill="var(--art-ground)" stroke-width="3"/><circle cx="236" cy="176" r="6" fill="currentColor" stroke="none"/>', 16) +
        F('<circle cx="352" cy="214" r="15" fill="var(--art-ground)" stroke-width="3" stroke-dasharray="4 3"/><circle cx="352" cy="214" r="6" fill="var(--art-ground)" stroke-width="2.5"/>', 20);
    },
    'metric-explainer-shorts': (g: string): string => {
      let h = streaks(g, [[30, 150, 190, 26, .45], [380, 210, 190, 20, .35]]);
      h += P('M210 20H390V340H210Z', 0, ' stroke-width="3"');
      h += F('<text x="228" y="98" font-family="Barlow Condensed, sans-serif" font-weight="800" font-size="72" fill="currentColor" stroke="none">xT</text>' +
        '<path d="M312 62h60M312 80h40" stroke-width="5" opacity=".4"/>', 4);
      for (let r = 0; r < 4; r++) for (let c = 0; c < 6; c++) {
        let v = Math.min(1, Math.pow((c + 1) / 6, 2.2) * (1 - Math.abs(r - 1.5) / 3.2) + .04);
        h += F('<rect x="' + (228 + c * 24) + '" y="' + (128 + r * 30) + '" width="22" height="28" fill="currentColor" fill-opacity="' + v.toFixed(2) + '" stroke="none"/>', 6 + c + r * .5);
      }
      return h + F('<path d="M228 270h144M244 290h112" stroke-width="7" opacity=".85"/><path d="M228 318h40" stroke-width="3" opacity=".5"/>', 14) +
        F('<path d="M150 60V300M140 60h20M140 300h20M450 60V300M440 60h20M440 300h20" stroke-width="1.5" opacity=".55"/>', 2);
    },
    'reactive-weekend-pipeline': (g: string): string => {
      let h = streaks(g, [[60, 166, 420, 28, .45]]), t = '';
      for (let i = 0; i <= 26; i++) t += 'M' + (40 + i * 20) + ' 250v' + (i % 6 === 0 ? 16 : 8);
      h += F('<rect x="40" y="110" width="260" height="140" fill="currentColor" fill-opacity=".1" stroke="none"/>', 0) +
        P('M40 110H560V250H40Z', 0) + '<path d="' + t + '" stroke-width="1.5" opacity=".7"/>' +
        '<path d="M300 96V264" stroke-dasharray="3 5"/>' +
        F('<text x="54" y="98" font-family="Barlow Condensed, sans-serif" font-weight="800" font-size="46" fill="currentColor" stroke="none">SUN</text>' +
          '<text x="314" y="98" font-family="Barlow Condensed, sans-serif" font-weight="500" font-size="46" fill="currentColor" stroke="none">MON</text>', 2);
      h += P('M96 180H474', 4, ' stroke-width="3"');
      h += F('<circle cx="96" cy="180" r="13" fill="currentColor"/>', 4) +
        F('<rect x="186" y="166" width="28" height="28" fill="var(--art-ground)" stroke-width="3"/>', 8) +
        F('<rect x="330" y="150" width="34" height="60" fill="var(--art-ground)" stroke-width="3"/><path d="M340 196h14" stroke-width="3"/>', 12) +
        F('<path d="M474 126V270" stroke-width="3"/><path d="M474 128l34 12-34 12z" fill="currentColor"/>', 16);
      return h;
    },
    'interactive-companion-loop': (g: string): string => {
      return streaks(g, [[20, 176, 140, 22, .4]]) +
        P('M150 36H560V324H150Z', 0, ' stroke-width="3"') + P('M150 76H560', 2) +
        F('<circle cx="172" cy="56" r="5"/><circle cx="192" cy="56" r="5"/><circle cx="212" cy="56" r="5"/><rect x="240" y="46" width="230" height="20" rx="10" fill="currentColor" fill-opacity=".1"/>', 3) +
        F('<path d="M190 110V250H520" stroke-width="1.5" opacity=".6"/>', 5) +
        P('M190 230C240 220 270 170 320 172S390 120 430 128S490 100 520 104', 6, ' stroke-width="4"') +
        P('M190 196C250 200 300 214 350 204S460 182 520 176', 9, ' stroke-width="2" stroke-dasharray=".02 .02" opacity=".8"') +
        F('<path d="M372 104V262" stroke-dasharray="3 4"/><circle cx="372" cy="146" r="8" fill="currentColor"/>', 12) +
        F('<path d="M190 288H520" stroke-width="3" opacity=".4"/><path d="M190 288H372" stroke-width="3"/><circle cx="372" cy="288" r="11" fill="var(--art-ground)" stroke-width="3"/>', 14) +
        F('<path d="M384 296l4 30 8-10 13 1z" fill="currentColor" stroke-width="1.5"/>', 17) +
        F('<rect x="34" y="120" width="78" height="44" fill="var(--art-ground)" stroke-width="2.5"/><path d="M66 133l14 9-14 9z" fill="currentColor" stroke="none"/>' +
          '<path d="M74 172C76 236 100 262 142 262M132 252l12 10-12 10" stroke-width="2.5"/>', 10);
    }
  };

const NEUTRAL = (g: string): string =>
  streaks(g, [[60, 170, 300, 22, 0.35]]) +
  '<path d="M40 300H560M40 60V300" stroke-width="1.5" opacity=".5"/>' +
  P("M40 260L160 210L280 228L400 140L560 110", 0, ' stroke-width="4"');

const cache = new Map<string, string>();
function markup(id: string, g: string): string {
  const key = `${id}|${g}`;
  let m = cache.get(key);
  if (m === undefined) {
    m = (ART[id] ?? NEUTRAL)(g);
    cache.set(key, m);
  }
  return m;
}

export const hasLaneArt = (id: string): boolean => id in ART;

/** One lane illustration; `live` draws it in (reduced motion: shown at once via CSS). */
export function LaneArt({ id, name, live = true, className = "" }: { id: string; name?: string; live?: boolean; className?: string }) {
  const g = `lartg${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const html =
    `<defs><linearGradient id="${g}" x1="0" x2="1"><stop offset="0" stop-color="currentColor" stop-opacity="0"/><stop offset=".8" stop-color="currentColor" stop-opacity=".5"/><stop offset="1" stop-color="currentColor" stop-opacity=".12"/></linearGradient></defs>` +
    `<g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${markup(id, g)}</g>`;
  return (
    <svg
      className={`lart${live ? " is-live" : ""} ${className}`}
      viewBox="0 0 600 360"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={`Stylised illustration: ${name ?? id}`}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: static drawing markup built in this module
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
