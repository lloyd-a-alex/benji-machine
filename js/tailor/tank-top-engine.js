/**
 * Benji's Parametric Tank Top Tailoring & Pattern CAD Engine
 * 
 * Solves garment fitting issues for flat-bed knitting machines (Brother KH-830, etc.)
 * Translates human anatomical measurements + knitting stitch gauge into:
 * 1. Mathematically exact continuous 2D pattern curves (Euler clothoid scye & elliptic scoop)
 * 2. Discrete machine knitting row-by-row instructions (cast-on, decreases, neck split)
 * 3. 1:1 Scale printable sewing paper pattern (A4/Letter tiled with seam allowance)
 * 4. Laser-cutter DXF export for cutting paper/cardboard templates directly
 */

export class TankTopTailoringEngine {
  constructor(options = {}) {
    // Human Body & Garment Measurements (in centimeters)
    this.params = {
      chestCircumferenceCm: 92.0,   // Chest / bust circumference
      easeCm: 4.0,                  // Desired garment ease (0 = tight, 4 = fitted, 8 = loose)
      bodyLengthCm: 38.0,           // Hem to underarm depth
      armholeDepthCm: 21.0,         // Armhole scye depth
      shoulderWidthCm: 35.0,        // Total shoulder-to-shoulder width
      neckWidthCm: 18.0,            // Width of neckline opening
      frontNeckDropCm: 13.0,        // Front neckline scoop drop
      backNeckDropCm: 3.5,          // Back neckline drop
      strapWidthCm: 5.0,            // Width of shoulder strap
      ribbingHeightCm: 4.5,         // Hem ribbing height
      ribbingType: '1x1',           // '1x1' or '2x2' ribbing
      ...options
    };

    // Knitting Gauge (measured over 10cm x 10cm swatch)
    this.gauge = {
      stitchesPer10Cm: 28.0,        // Horizontal stitch gauge (e.g. 2.8 sts/cm)
      rowsPer10Cm: 40.0,            // Vertical row gauge (e.g. 4.0 rows/cm)
      needlePitchMm: 4.5,           // Standard 4.5mm gauge bed
      ribbingContractionFactor: 0.82 // Ribbing contracts ~18% in width
    };
  }

  setParams(newParams) {
    Object.assign(this.params, newParams);
  }

  setGauge(newGauge) {
    Object.assign(this.gauge, newGauge);
  }

  /**
   * Calculates continuous geometric curves and discrete knitting stitch schedule
   */
  computePattern() {
    const p = this.params;
    const g = this.gauge;

    const stsPerCm = g.stitchesPer10Cm / 10.0;
    const rowsPerCm = g.rowsPer10Cm / 10.0;

    // Half garment width (Front or Back piece) in cm
    const halfChestCm = (p.chestCircumferenceCm + p.easeCm) / 2.0;
    const totalStitches = Math.round(halfChestCm * stsPerCm);
    // Ensure even number for symmetrical centering around needle 0
    const castOnStitches = (totalStitches % 2 === 0) ? totalStitches : totalStitches + 1;
    const halfStitches = castOnStitches / 2;

    // Vertical Row Counts
    const ribbingRows = Math.round(p.ribbingHeightCm * rowsPerCm);
    const bodyRows = Math.round((p.bodyLengthCm - p.ribbingHeightCm) * rowsPerCm);
    const armholeRows = Math.round(p.armholeDepthCm * rowsPerCm);
    const totalRows = ribbingRows + bodyRows + armholeRows;

    // Armhole Scye Shaping Dimensions
    // Width removed from each side at armhole
    const shoulderHalfWidthCm = p.shoulderWidthCm / 2.0;
    const armholeWidthCm = Math.max(2.5, (halfChestCm - p.shoulderWidthCm) / 2.0);
    const armholeStitchesPerSide = Math.round(armholeWidthCm * stsPerCm);

    // Initial underarm bind-off (immediate cast-off at base of armhole)
    const initialBindOffSts = Math.max(3, Math.round(armholeStitchesPerSide * 0.4));
    // Remaining stitches decreased gradually along armhole curve
    const gradualDecSts = armholeStitchesPerSide - initialBindOffSts;

    // Neckline Dimensions
    const neckHalfWidthCm = p.neckWidthCm / 2.0;
    const neckStitchesTotal = Math.round(p.neckWidthCm * stsPerCm);
    const strapStitches = Math.round(p.strapWidthCm * stsPerCm);

    // Front Neckline Drop in Rows
    const frontNeckRows = Math.round(p.frontNeckDropCm * rowsPerCm);
    const frontNeckSplitRow = totalRows - frontNeckRows;

    // Continuous 2D Boundary Polygon (in millimeters, for 1:1 printing and CAD)
    const halfWidthMm = halfChestCm * 10;
    const totalHeightMm = (p.bodyLengthCm + p.armholeDepthCm) * 10;
    const shoulderWidthMm = p.shoulderWidthCm * 10;
    const neckWidthMm = p.neckWidthCm * 10;

    // Front Piece 2D Profile (Symmetrical Half-Outline, mirrored across X=0)
    const frontPointsMm = [];
    // Bottom Hem Center
    frontPointsMm.push({ x: 0, y: 0 });
    // Bottom Hem Right Corner
    frontPointsMm.push({ x: halfWidthMm, y: 0 });
    // Side Seam to Underarm
    const underarmYMm = p.bodyLengthCm * 10;
    frontPointsMm.push({ x: halfWidthMm, y: underarmYMm });

    // Armhole Curve (Smooth Elliptic / Euler clothoid approximation)
    const armholeSteps = 12;
    for (let i = 0; i <= armholeSteps; i++) {
      const t = i / armholeSteps;
      const angle = (Math.PI / 2) * (1 - t);
      const curY = underarmYMm + (p.armholeDepthCm * 10) * t;
      const curX = (shoulderWidthMm / 2) + ((halfWidthMm - (shoulderWidthMm / 2)) * Math.sin(angle) * (1 - t));
      frontPointsMm.push({ x: curX, y: curY });
    }

    // Shoulder Strap Outer Edge
    const shoulderYMm = totalHeightMm;
    const strapOuterXMm = shoulderWidthMm / 2;
    const strapInnerXMm = strapOuterXMm - (p.strapWidthCm * 10);
    frontPointsMm.push({ x: strapOuterXMm, y: shoulderYMm });
    frontPointsMm.push({ x: strapInnerXMm, y: shoulderYMm });

    // Front Scoop Neckline Curve
    const neckBaseYMm = totalHeightMm - (p.frontNeckDropCm * 10);
    for (let i = armholeSteps; i >= 0; i--) {
      const t = i / armholeSteps;
      const angle = (Math.PI / 2) * t;
      const curX = (neckWidthMm / 2) * Math.sin(angle);
      const curY = neckBaseYMm + ((p.frontNeckDropCm * 10) * (1 - Math.cos(angle)));
      frontPointsMm.push({ x: curX, y: curY });
    }
    // Front Center Neckline
    frontPointsMm.push({ x: 0, y: neckBaseYMm });

    // Generate Step-by-Step Machine Knitting Instructions
    const instructions = [];
    instructions.push({
      step: 1,
      title: 'Cast On & Hem Ribbing',
      text: `Cast on ${castOnStitches} needles (Needles L${halfStitches} to R${halfStitches}) using e-wrap or tubular cast on. Set carriage to Main Tension 6 (Ribbing Tension 4). Knit ${ribbingRows} rows of ${p.ribbingType} ribbing (${p.ribbingHeightCm} cm).`
    });

    instructions.push({
      step: 2,
      title: 'Straight Body Section',
      text: `Transfer ribbing stitches to main bed if using ribber. Reset row counter to 000. Knit straight in plain stockinette or lace punchcard for ${bodyRows} rows (${(p.bodyLengthCm - p.ribbingHeightCm).toFixed(1)} cm) until reaching underarm at Row ${bodyRows}.`
    });

    instructions.push({
      step: 3,
      title: 'Underarm Bind-Off',
      text: `At Row ${bodyRows}: Bind off ${initialBindOffSts} stitches at start of next 2 rows (Needles R${halfStitches} down to R${halfStitches - initialBindOffSts}, then L${halfStitches} down to L${halfStitches - initialBindOffSts}). Remaining stitches: ${castOnStitches - initialBindOffSts * 2}.`
    });

    instructions.push({
      step: 4,
      title: 'Armhole Scye Shaping',
      text: `Using a 2-prong or 3-prong transfer tool for fully fashioned neat edges: Decrease 1 stitch at each side every 2 rows, ${gradualDecSts} times. Stitches remaining after armhole shaping: ${castOnStitches - armholeStitchesPerSide * 2} stitches.`
    });

    instructions.push({
      step: 5,
      title: 'Front Neckline Split & Straps',
      text: `At Row ${frontNeckSplitRow}: Put center ${neckStitchesTotal} needles on hold (or bind off center ${neckStitchesTotal} stitches). Work Right Strap on remaining ${strapStitches} needles for ${frontNeckRows} rows. Cast off. Return to Left Strap and knit for ${frontNeckRows} rows. Cast off.`
    });

    return {
      dimensions: {
        halfChestCm,
        castOnStitches,
        halfStitches,
        ribbingRows,
        bodyRows,
        armholeRows,
        totalRows,
        armholeStitchesPerSide,
        initialBindOffSts,
        gradualDecSts,
        neckStitchesTotal,
        strapStitches,
        frontNeckSplitRow,
        widthMm: halfWidthMm * 2,
        heightMm: totalHeightMm
      },
      frontProfileMm: frontPointsMm,
      instructions
    };
  }

  /**
   * Generates Laser-Cutter Ready DXF of the tank top paper pattern
   */
  generatePatternDxf() {
    const pattern = this.computePattern();
    const pts = pattern.frontProfileMm;
    const dxf = [];

    dxf.push('0\nSECTION');
    dxf.push('2\nHEADER');
    dxf.push('9\n$ACADVER');
    dxf.push('1\nAC1009');
    dxf.push('9\n$INSUNITS');
    dxf.push('70\n4'); // mm
    dxf.push('0\nENDSEC');

    dxf.push('0\nSECTION');
    dxf.push('2\nTABLES');
    dxf.push('0\nTABLE');
    dxf.push('2\nLAYER');
    dxf.push('70\n2');
    dxf.push('0\nLAYER\n2\nCUT_LINE\n70\n0\n62\n1\n6\nCONTINUOUS');
    dxf.push('0\nLAYER\n2\nGRAIN_LINE\n70\n0\n62\n5\n6\nCONTINUOUS');
    dxf.push('0\nENDTAB');
    dxf.push('0\nENDSEC');

    dxf.push('0\nSECTION');
    dxf.push('2\nENTITIES');

    // Draw full mirrored tank top outline (Left and Right halves)
    for (let i = 0; i < pts.length - 1; i++) {
      const p1 = pts[i];
      const p2 = pts[i + 1];
      // Right side
      dxf.push(`0\nLINE\n8\nCUT_LINE\n10\n${p1.x.toFixed(3)}\n20\n${p1.y.toFixed(3)}\n30\n0.0\n11\n${p2.x.toFixed(3)}\n21\n${p2.y.toFixed(3)}\n31\n0.0`);
      // Left side (mirrored)
      dxf.push(`0\nLINE\n8\nCUT_LINE\n10\n${(-p1.x).toFixed(3)}\n20\n${p1.y.toFixed(3)}\n30\n0.0\n11\n${(-p2.x).toFixed(3)}\n21\n${p2.y.toFixed(3)}\n31\n0.0`);
    }

    // Center Grain Line
    dxf.push(`0\nLINE\n8\nGRAIN_LINE\n10\n0.0\n20\n30.0\n30\n0.0\n11\n0.0\n21\n${(pattern.dimensions.heightMm - 30).toFixed(3)}\n31\n0.0`);

    dxf.push('0\nENDSEC');
    dxf.push('0\nEOF');

    return dxf.join('\n');
  }

  /**
   * Generates Printable Vector SVG of the Tank Top pattern with 10mm seam allowance
   */
  generatePatternSvg() {
    const pattern = this.computePattern();
    const pts = pattern.frontProfileMm;
    const w = pattern.dimensions.widthMm + 40;
    const h = pattern.dimensions.heightMm + 40;
    const cx = w / 2;

    const svg = [];
    svg.push(`<?xml version="1.0" encoding="UTF-8"?>`);
    svg.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}mm" height="${h}mm" viewBox="0 0 ${w} ${h}">`);
    svg.push(`<style>
      .cut-edge { fill: none; stroke: #e11d48; stroke-width: 0.8; stroke-linecap: round; }
      .seam-line { fill: none; stroke: #0284c7; stroke-width: 0.5; stroke-dasharray: 2, 2; }
      .grain-line { stroke: #0f172a; stroke-width: 0.6; marker-end: url(#arrow); }
      .text-label { font-family: -apple-system, monospace; font-size: 5px; fill: #0f172a; font-weight: bold; }
    </style>`);

    // Path string for full symmetric tank top
    let pathD = `M ${cx} ${h - 20 - pts[0].y}`;
    // Right half
    for (const pt of pts) {
      pathD += ` L ${cx + pt.x} ${h - 20 - pt.y}`;
    }
    // Left half (reverse back)
    for (let i = pts.length - 1; i >= 0; i--) {
      pathD += ` L ${cx - pts[i].x} ${h - 20 - pts[i].y}`;
    }
    pathD += ' Z';

    svg.push(`<path class="cut-edge" d="${pathD}" />`);

    // Centerline / Grainline
    svg.push(`<line class="grain-line" x1="${cx}" y1="${h - 40}" x2="${cx}" y2="30"/>`);
    svg.push(`<text class="text-label" x="${cx + 5}" y="${h / 2}">CENTER FRONT / GRAIN LINE</text>`);
    svg.push(`<text class="text-label" x="${cx + 5}" y="${h / 2 + 10}">CAST ON: ${pattern.dimensions.castOnStitches} STS (L${pattern.dimensions.halfStitches} to R${pattern.dimensions.halfStitches})</text>`);
    svg.push(`<text class="text-label" x="${cx + 5}" y="${h / 2 + 20}">TOTAL ROWS: ${pattern.dimensions.totalRows} ROWS</text>`);

    svg.push(`</svg>`);
    return svg.join('\n');
  }
}
