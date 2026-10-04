/**
 * OFL fonts from the repo `fonts/` directory only (DESIGN.md §6.5): imported as bundler assets,
 * registered with the FontFace API, and the render is held with delayRender until every face has
 * loaded. No network, no CDN. Runs once at module load (no effects, no state).
 */
import { cancelRender, continueRender, delayRender } from "remotion";
import barlow500 from "../../../fonts/barlow-condensed/BarlowCondensed-500.woff2";
import barlow600 from "../../../fonts/barlow-condensed/BarlowCondensed-600.woff2";
import barlow700 from "../../../fonts/barlow-condensed/BarlowCondensed-700.woff2";
import barlow800 from "../../../fonts/barlow-condensed/BarlowCondensed-800.woff2";
import manifest from "../../../fonts/fonts.manifest.json";
import interVar from "../../../fonts/inter/Inter-Variable.woff2";
import jetbrainsVar from "../../../fonts/jetbrains-mono/JetBrainsMono-Variable.woff2";

export type FontFaceSpec = { family: string; file: string; url: string; weight: string };

export const FONT_FACES: readonly FontFaceSpec[] = [
  {
    family: "Barlow Condensed",
    file: "fonts/barlow-condensed/BarlowCondensed-500.woff2",
    url: barlow500,
    weight: "500",
  },
  {
    family: "Barlow Condensed",
    file: "fonts/barlow-condensed/BarlowCondensed-600.woff2",
    url: barlow600,
    weight: "600",
  },
  {
    family: "Barlow Condensed",
    file: "fonts/barlow-condensed/BarlowCondensed-700.woff2",
    url: barlow700,
    weight: "700",
  },
  {
    family: "Barlow Condensed",
    file: "fonts/barlow-condensed/BarlowCondensed-800.woff2",
    url: barlow800,
    weight: "800",
  },
  { family: "Inter", file: "fonts/inter/Inter-Variable.woff2", url: interVar, weight: "100 900" },
  {
    family: "JetBrains Mono",
    file: "fonts/jetbrains-mono/JetBrainsMono-Variable.woff2",
    url: jetbrainsVar,
    weight: "100 800",
  },
];

type ManifestEntry = { family: string; file: string; license: string; sha256: string; version: string; tnum: boolean };

/** Fonts this composition draws with, joined to `fonts/fonts.manifest.json` for the provenance manifest. */
export const FONTS_USED: readonly { family: string; file: string; license: string; sha256: string; version: string }[] =
  FONT_FACES.map((f) => {
    const m = (manifest.fonts as ManifestEntry[]).find((e) => e.file === f.file);
    if (!m) throw new Error(`font ${f.file} missing from fonts/fonts.manifest.json`);
    return { family: m.family, file: m.file, license: m.license, sha256: m.sha256, version: m.version };
  });

/** Prefix of the console line carrying the font report (keep in sync with apps/server/src/render-support.ts). */
export const FONTS_REPORT_PREFIX = "[statreel-fonts]";

/** Families the composition requires; a render must fail if any falls back (DESIGN.md §6.3). */
export const REQUIRED_FAMILIES = [...new Set(FONT_FACES.map((f) => f.family))];

declare global {
  interface Window {
    /** set once all StatReel faces are loaded; the render worker can assert on it */
    __statreelFonts?: { loaded: string[]; failed: string[] };
  }
}

function loadFonts(): void {
  if (typeof window === "undefined" || typeof FontFace === "undefined" || typeof document === "undefined") return;
  const handle = delayRender("Loading OFL fonts from fonts/");
  const status = { loaded: [] as string[], failed: [] as string[] };
  window.__statreelFonts = status;
  // every face settles before anything is decided, so the report and the error list all failures
  Promise.allSettled(
    FONT_FACES.map(async (f) => {
      const face = new FontFace(f.family, `url("${f.url}") format("woff2")`, {
        weight: f.weight,
        style: "normal",
        display: "block",
      });
      try {
        await face.load();
        document.fonts.add(face);
        status.loaded.push(`${f.family} ${f.weight}`);
      } catch (err) {
        status.failed.push(`${f.family} ${f.weight}`);
        // the browser's rejection ("A network error occurred.") names no font: say which face it was
        throw new Error(`OFL font ${f.family} ${f.weight} (${f.file}) failed to load: ${err instanceof Error ? err.message : String(err)}`);
      }
    }),
  )
    .then((results) => {
      const check = Object.fromEntries(
        REQUIRED_FAMILIES.map((family) => [
          family,
          [...document.fonts].some((f) => f.family.replace(/["']/g, "") === family && f.status === "loaded"),
        ]),
      );
      // machine-readable: the render worker forwards this line and the server turns it into
      // checks.font_fallbacks (apps/server/src/render-support.ts parseFontsReport). `fallbacks` counts
      // faces that failed to load plus required families the document does not report as loaded.
      const fallbacks = status.failed.length + Object.values(check).filter((ok) => !ok).length;
      console.log(`${FONTS_REPORT_PREFIX}${JSON.stringify({ ...status, check, fallbacks })}`);
      const errors = results.flatMap((r) => (r.status === "rejected" ? [r.reason instanceof Error ? r.reason.message : String(r.reason)] : []));
      if (errors.length) cancelRender(new Error(errors.join("; ")));
      else continueRender(handle);
    })
    .catch((err: unknown) => cancelRender(err instanceof Error ? err : new Error(String(err))));
}

loadFonts();
