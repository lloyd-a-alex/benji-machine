/**
 * KNITCAT V2 — Reverse Engineer: reconstruction (spec §5.8).
 *
 * The payoff. Every earlier stage produced an *estimate* with a confidence; this one folds them
 * into something a knitter can actually use — a KnitScript project. Given the physical scale, the
 * silhouette bounding box, the counted gauge, the recognised pattern and the inferred construction,
 * it back-computes plausible body measurements (garment pixel width × cm/px ÷ (1 + ease) → body
 * circumference), chooses a yarn weight from the gauge, and serialises a `.knit` file that, when
 * loaded into the app, drives the *entire* forward pipeline (Fit Engine → Compiler → every output).
 *
 * That is the round-trip the spec promises: photo → KnitScript → finished, fitted, machine-ready
 * pattern. Everything here is honest about uncertainty: measurements carry a `derived` flag and the
 * script opens with a comment block recording each estimate's confidence so the maker knows exactly
 * what to verify before casting on. DOM-free; the only import is the colour type used for palette
 * names, kept minimal.
 *
 * @module reverse/reconstruct
 */

import { clamp } from './_image.js';

/** Gauge (sts/10cm) → a standard yarn-weight name, for the yarn block. */
function weightFromGauge(stsPer10cm) {
  const s = Number(stsPer10cm) || 20;
  if (s >= 33) return 'lace';
  if (s >= 28) return 'fingering';
  if (s >= 24) return 'sport';
  if (s >= 20) return 'dk';
  if (s >= 16) return 'worsted';
  if (s >= 13) return 'aran';
  if (s >= 10) return 'bulky';
  return 'super-bulky';
}

/**
 * Estimate body measurements from a garment silhouette + scale + gauge.
 * @param {{bbox:{width:number,height:number}, cmPerPixel:number, gauge:{stitchesPer10cm:number,rowsPer10cm:number}}} ctx
 * @param {{easeCm?:number}} [opts]
 * @returns {{bust:number, waist:number, hip:number, length:number, sleeveLength:number, upperArm:number, shoulderWidth:number, neck:number, derived:boolean}}
 */
export function estimateMeasurements(ctx, opts = {}) {
  const bbox = (ctx && ctx.bbox) || { width: 0, height: 0 };
  const cmPerPixel = Number(ctx && ctx.cmPerPixel) || 0;
  const ease = Number(opts.easeCm) || 8;
  if (!bbox.width || !cmPerPixel) {
    // No scale: fall back to a straight medium adult block so the KnitScript is still loadable.
    return { bust: 96, waist: 82, hip: 100, length: 62, sleeveLength: 46, upperArm: 32, shoulderWidth: 42, neck: 38, derived: false };
  }
  // Garment chest circumference ≈ body width in cm × π (front + back, wrapped), minus the ease we assume.
  const chestCm = bbox.width * cmPerPixel * 2; // front + back panels laid flat
  const bust = round1(clamp(chestCm - ease, 60, 200));
  const length = round1(clamp(bbox.height * cmPerPixel, 20, 130));
  return {
    bust,
    waist: round1(bust * 0.86),
    hip: round1(bust * 1.04),
    length,
    sleeveLength: round1(clamp(length * 0.74, 20, 70)),
    upperArm: round1(clamp(bust * 0.34, 20, 60)),
    shoulderWidth: round1(clamp(bust * 0.44, 28, 62)),
    neck: round1(clamp(bust * 0.40, 30, 52)),
    derived: true
  };
}

/**
 * Build a KnitScript string from a reverse-engineering result.
 * @param {{gauge?:object, colors?:Array, pattern?:object, silhouette?:object, construction?:object, cmPerPixel?:number}} analysis
 * @param {{name?:string, machine?:string, easeCm?:number}} [opts]
 * @returns {{knitScript:string, measurements:object, warnings:string[]}}
 */
export function reconstruct(analysis = {}, opts = {}) {
  const warnings = [];
  const gauge = analysis.gauge || { stitchesPer10cm: 22, rowsPer10cm: 30 };
  const sts = Number(gauge.stitchesPer10cm) || Number(gauge.stsPer10cm) || 22;
  const rows = Number(gauge.rowsPer10cm) || 30;
  const construction = (analysis.construction && analysis.construction.templateId) || 'bottom-up-raglan';
  const colors = Array.isArray(analysis.colors) ? analysis.colors : [];
  const measurements = estimateMeasurements({ bbox: analysis.silhouette && analysis.silhouette.bbox, cmPerPixel: analysis.cmPerPixel, gauge }, { easeCm: opts.easeCm });

  if (!(analysis.cmPerPixel > 0)) warnings.push('No physical scale — body measurements use a standard block; add a reference object and re-run for a true fit.');
  if ((analysis.gauge && analysis.gauge.confidence) < 0.5) warnings.push('Gauge confidence is low; verify with a swatch before committing yarn.');
  if ((analysis.construction && analysis.construction.confidence) < 0.45) warnings.push('Construction guess is weak; confirm the template.');
  if (!colors.length) warnings.push('No dominant colours extracted; add yarn colours manually.');

  const name = (opts.name || 'Reverse-engineered garment').replace(/"/g, '\\"');
  const L = [];
  L.push(`// KNITCAT Reverse Engineer — reconstructed from a photo.`);
  L.push(`// Confidence: gauge ${pct(analysis.gauge && analysis.gauge.confidence)}, construction ${pct(analysis.construction && analysis.construction.confidence)}.`);
  L.push(`// Verify the highlighted estimates before casting on.`);
  if (warnings.length) for (const w of warnings) L.push(`// NOTE: ${w}`);
  L.push('');
  L.push(`project "${name}" {`);
  L.push('  body: measurements {');
  L.push('    system: custom');
  L.push(`    bust: ${measurements.bust}cm`);
  L.push(`    waist: ${measurements.waist}cm`);
  L.push(`    hip: ${measurements.hip}cm`);
  L.push(`    upperArm: ${measurements.upperArm}cm`);
  L.push(`    shoulderWidth: ${measurements.shoulderWidth}cm`);
  L.push(`    neck: ${measurements.neck}cm`);
  L.push(`    easePreference: relaxed`);
  L.push('  }');
  L.push('');
  L.push('  gauge {');
  L.push(`    stitchesPer10cm: ${round1(sts)}`);
  L.push(`    rowsPer10cm: ${round1(rows)}`);
  L.push('  }');
  L.push('');
  const weight = weightFromGauge(sts);
  if (colors.length) {
    L.push('  yarn "main": {');
    L.push(`    weight: ${weight}`);
    L.push(`    color: "${colors[0].hex || '#888888'}"`);
    L.push('  }');
    if (colors[1]) {
      L.push('  yarn "contrast": {');
      L.push(`    weight: ${weight}`);
      L.push(`    color: "${colors[1].hex || '#eeeeee'}"`);
      L.push('  }');
    }
    L.push('');
  }
  L.push(`  machine: "${opts.machine || 'brother_standard_24'}" { }`);
  L.push('');
  L.push(`  garment {`);
  L.push(`    construction: ${construction}`);
  L.push(`    length: ${measurements.length}cm`);
  L.push(`    sleeveLength: ${measurements.sleeveLength}cm`);
  L.push('  }');
  if (analysis.chart) {
    L.push('');
    L.push('  chart "yoke": {');
    L.push(`    repeat: ${analysis.chart.repeat || 'auto'}`);
    L.push('    colors: [main, contrast]');
    L.push('  }');
  }
  L.push('}');
  return { knitScript: L.join('\n'), measurements, warnings };
}

function pct(v) { return v == null ? 'n/a' : `${Math.round(clamp(Number(v), 0, 1) * 100)}%`; }
function round1(n) { return Math.round((Number(n) || 0) * 10) / 10; }
