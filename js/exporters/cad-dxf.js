/**
 * Professional AutoCAD DXF (ASCII R12) Exporter
 * 
 * Generates industry-standard CAD/CAM files for laser cutters, vinyl cutters,
 * and milling machines. Fully organized into distinct CAM layers:
 * 
 * - CUT_HOLES      (Layer Color 1 / Red): Pattern stitch holes
 * - CUT_SPROCKETS  (Layer Color 2 / Yellow): Tractor feed sprockets
 * - CUT_OUTLINE    (Layer Color 3 / Green): Outer card boundary cut
 * - ENGRAVE_TEXT   (Layer Color 5 / Blue): Row numbers, column index, alignment text
 * - ALIGN_MARKS    (Layer Color 4 / Cyan): Center guides and overlap registration crosses
 */

import { calculateCardDimensions } from '../machine/profiles.js';

export class CadDxfExporter {
  /**
   * Generates standard AutoCAD DXF R12 text stream
   */
  static generateDxf(profile, cardMatrix, options = {}) {
    const {
      includeSprockets = true,
      includeText = true,
      includeAlignMarks = true,
      kerfOffsetMm = 0.0 // Laser kerf compensation
    } = options;

    const cols = cardMatrix[0]?.length || 24;
    // Physical leader: the sensor reads the card a fixed number of rows below the
    // needles, and that offset differs by machine (Brother 7, Silver Reed 5, etc.).
    // Prepending blank rows makes the punched pattern sit at the correct physical
    // height so two machines' cards are genuinely different, not identical.
    const lead = profile.carriageRules?.cardReadingOffsetRows || 0;
    if (lead > 0) cardMatrix = [...Array.from({ length: lead }, () => new Array(cols).fill(false)), ...cardMatrix];
    const rows = cardMatrix.length;
    const dims = calculateCardDimensions(profile, rows, cols);

    const dxf = [];

    // Header Section
    dxf.push('0\nSECTION');
    dxf.push('2\nHEADER');
    dxf.push('9\n$ACADVER');
    dxf.push('1\nAC1009'); // AutoCAD Release 12 format (universal CAM compatibility)
    dxf.push('9\n$INSUNITS');
    dxf.push('70\n4'); // 4 = Millimeters
    dxf.push('9\n$MEASUREMENT');
    dxf.push('70\n1'); // 1 = Metric
    dxf.push('9\n$EXTMIN');
    dxf.push('10\n0.0');
    dxf.push('20\n0.0');
    dxf.push('30\n0.0');
    dxf.push('9\n$EXTMAX');
    dxf.push(`10\n${dims.widthMm.toFixed(4)}`);
    dxf.push(`20\n${dims.heightMm.toFixed(4)}`);
    dxf.push('30\n0.0');
    dxf.push('0\nENDSEC');

    // Tables Section (Layers)
    dxf.push('0\nSECTION');
    dxf.push('2\nTABLES');
    dxf.push('0\nTABLE');
    dxf.push('2\nLAYER');
    dxf.push('70\n5');

    const addLayerDef = (name, color) => {
      dxf.push('0\nLAYER');
      dxf.push(`2\n${name}`);
      dxf.push('70\n0');
      dxf.push(`62\n${color}`);
      dxf.push('6\nCONTINUOUS');
    };

    addLayerDef('CUT_HOLES', 1);     // Red
    addLayerDef('CUT_SPROCKETS', 2); // Yellow
    addLayerDef('CUT_OUTLINE', 3);   // Green
    addLayerDef('ENGRAVE_TEXT', 5);  // Blue
    addLayerDef('ALIGN_MARKS', 4);   // Cyan

    dxf.push('0\nENDTAB');
    dxf.push('0\nENDSEC');

    // Blocks Section
    dxf.push('0\nSECTION');
    dxf.push('2\nBLOCKS');
    dxf.push('0\nENDSEC');

    // Entities Section
    dxf.push('0\nSECTION');
    dxf.push('2\nENTITIES');

    // Entity Helper: Circle
    const addCircle = (layer, cx, cy, radius) => {
      const r = Math.max(0.1, radius - kerfOffsetMm);
      dxf.push('0\nCIRCLE');
      dxf.push(`8\n${layer}`);
      dxf.push(`10\n${cx.toFixed(4)}`);
      dxf.push(`20\n${cy.toFixed(4)}`);
      dxf.push('30\n0.0');
      dxf.push(`40\n${r.toFixed(4)}`);
    };

    // Entity Helper: Line
    const addLine = (layer, x1, y1, x2, y2) => {
      dxf.push('0\nLINE');
      dxf.push(`8\n${layer}`);
      dxf.push(`10\n${x1.toFixed(4)}`);
      dxf.push(`20\n${y1.toFixed(4)}`);
      dxf.push('30\n0.0');
      dxf.push(`11\n${x2.toFixed(4)}`);
      dxf.push(`21\n${y2.toFixed(4)}`);
      dxf.push('31\n0.0');
    };

    // Entity Helper: Text
    const addText = (layer, text, x, y, height = 2.0) => {
      dxf.push('0\nTEXT');
      dxf.push(`8\n${layer}`);
      dxf.push(`10\n${x.toFixed(4)}`);
      dxf.push(`20\n${y.toFixed(4)}`);
      dxf.push('30\n0.0');
      dxf.push(`40\n${height.toFixed(4)}`);
      dxf.push(`1\n${text}`);
    };

    // 1. Cut Pattern Holes
    const holeRadius = profile.holeDiameter / 2.0;
    for (let r = 0; r < rows; r++) {
      const y = dims.rowOffsetYMm + r * profile.pitchY;
      for (let c = 0; c < cols; c++) {
        if (cardMatrix[r][c]) {
          const x = dims.colOffsetXMm + c * profile.pitchX;
          addCircle('CUT_HOLES', x, y, holeRadius);
        }
      }
    }

    // 2. Cut Tractor Sprockets
    if (includeSprockets) {
      const sprockRadius = profile.sprocketDiameter / 2.0;
      for (let r = 0; r < rows; r++) {
        const y = dims.rowOffsetYMm + r * profile.sprocketPitchY;
        addCircle('CUT_SPROCKETS', dims.leftSprocketXMm, y, sprockRadius);
        addCircle('CUT_SPROCKETS', dims.rightSprocketXMm, y, sprockRadius);
      }
    }

    // 3. Cut Perimeter Outline (Rectangle)
    const w = dims.widthMm;
    const h = dims.heightMm;
    addLine('CUT_OUTLINE', 0, 0, w, 0);
    addLine('CUT_OUTLINE', w, 0, w, h);
    addLine('CUT_OUTLINE', w, h, 0, h);
    addLine('CUT_OUTLINE', 0, h, 0, 0);

    // 4. Alignment Marks & Centerlines
    if (includeAlignMarks) {
      const midX = w / 2;
      // Centerline notches on top and bottom
      addLine('ALIGN_MARKS', midX, 0, midX, 4);
      addLine('ALIGN_MARKS', midX, h, midX, h - 4);

      // Overlap card joint lines (at leader & trailer)
      addLine('ALIGN_MARKS', 0, dims.rowOffsetYMm - profile.pitchY * 0.5, w, dims.rowOffsetYMm - profile.pitchY * 0.5);
      addLine('ALIGN_MARKS', 0, dims.heightMm - dims.rowOffsetYMm + profile.pitchY * 0.5, w, dims.heightMm - dims.rowOffsetYMm + profile.pitchY * 0.5);
    }

    // 5. Engraving Text (Row Numbers and Profile Title)
    if (includeText) {
      addText('ENGRAVE_TEXT', `${profile.name.toUpperCase()} - ${cols} STITCH`, dims.colOffsetXMm, 5.0, 2.5);
      
      // Row numbers on left and right borders
      for (let r = 0; r < rows; r += 2) {
        const y = dims.rowOffsetYMm + r * profile.pitchY - 0.7;
        const rowNumStr = `${r + 1}`;
        addText('ENGRAVE_TEXT', rowNumStr, dims.leftSprocketXMm + 3.0, y, 1.8);
        addText('ENGRAVE_TEXT', rowNumStr, dims.rightSprocketXMm - 5.5, y, 1.8);
      }
    }

    // End Entities & File
    dxf.push('0\nENDSEC');
    dxf.push('0\nEOF');

    return dxf.join('\n');
  }
}
