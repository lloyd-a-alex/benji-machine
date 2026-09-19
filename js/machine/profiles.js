/**
 * Industrial Knitting Machine & Punchcard Profiles
 * Defines physical gauge parameters, hole metrics, feed sprockets,
 * carriage mechanics, and carriage transfer characteristics.
 */

export const MACHINE_PROFILES = {
  brother_standard_24: {
    id: 'brother_standard_24',
    name: 'Brother Standard Gauge (24-Stitch)',
    gauge: 'Standard (4.5mm)',
    columns: 24,
    defaultRows: 60,
    minRows: 12,
    maxRows: 240,
    pitchX: 4.5,            // Horizontal needle spacing in mm (4.5mm standard gauge)
    pitchY: 5.08,           // Vertical row pitch in mm (0.2 inch / 5.08mm)
    holeDiameter: 3.2,      // Standard punchcard hole diameter in mm
    sprocketDiameter: 3.5,  // Drive sprocket hole diameter in mm
    sprocketPitchY: 5.08,   // Sprocket vertical pitch (1 per row)
    marginSide: 6.0,        // Distance from card edge to sprocket center in mm
    sprocketToFirstHole: 7.5, // Distance from sprocket center to 1st column center in mm
    marginTopBottom: 15.0,  // Leader and trailer margin in mm
    cardWidth: 140.0,       // Total width of standard 24-stitch punchcard strip in mm
    cardColor: '#f7f2e4',   // Vintage cardstock beige
    inkColor: '#1d2a44',    // Deep industrial navy ink
    carriageRules: {
      type: 'brother_separated', // Dedicated Lace Carriage (L-Carriage) + Knit Carriage (K-Carriage)
      laceCarriageDirectionalTransfers: true,
      transfersInCarriageDirection: true, // L->R transfers needle i to i+1; R->L transfers i to i-1
      knitsYarnDuringLace: false, // L-Carriage only transfers, K-Carriage knits plain rows with yarn
      minPlainRowsAfterLace: 2,   // Brother fashion lace requires at least 2 plain knit rows
      requiresEmptyNeedleSelection: true,
      cardReadingOffsetRows: 7,   // Sensor drum reads card 7 rows below active needles
    },
    description: 'Standard 4.5mm gauge for Brother KH-830, KH-836, KH-881, KH-890, KH-892, KH-894 with LC-2 lace carriage.'
  },

  silver_reed_standard_24: {
    id: 'silver_reed_standard_24',
    name: 'Silver Reed / Studio / Singer (24-Stitch)',
    gauge: 'Standard (4.5mm)',
    columns: 24,
    defaultRows: 60,
    minRows: 12,
    maxRows: 240,
    pitchX: 4.5,
    pitchY: 5.0,            // Metric 5.0mm vertical pitch
    holeDiameter: 3.2,
    sprocketDiameter: 3.6,
    sprocketPitchY: 5.0,
    marginSide: 5.5,
    sprocketToFirstHole: 7.0,
    marginTopBottom: 15.0,
    cardWidth: 136.0,
    cardColor: '#fbf8ee',
    inkColor: '#a12b2b',    // Burgundy/red ink style
    carriageRules: {
      type: 'silver_reed_combined', // LC-1 / LC-2 Lace Carriage transfers AND knits yarn simultaneously
      laceCarriageDirectionalTransfers: true,
      transfersInCarriageDirection: true,
      knitsYarnDuringLace: true,  // Simultaneous transfer and yarn feeding
      minPlainRowsAfterLace: 0,
      requiresEmptyNeedleSelection: false,
      cardReadingOffsetRows: 5,
    },
    description: 'Standard 4.5mm gauge for Silver Reed SK-280, SK-700, Singer Memo-Matic, Studio with LC-580 or punchcard LC-1.'
  },

  passap_duo_40: {
    id: 'passap_duo_40',
    name: 'Passap Duo 80 / E6000 (40-Stitch)',
    gauge: 'Fine-Mid (5.0mm)',
    columns: 40,
    defaultRows: 60,
    minRows: 16,
    maxRows: 300,
    pitchX: 5.0,            // 5mm needle spacing
    pitchY: 5.0,            // 5mm vertical row pitch
    holeDiameter: 2.8,      // Slightly smaller punch holes
    sprocketDiameter: 3.2,
    sprocketPitchY: 5.0,
    marginSide: 5.0,
    sprocketToFirstHole: 6.0,
    marginTopBottom: 20.0,
    cardWidth: 220.0,       // Wider 40-stitch format
    cardColor: '#eef2f7',   // Cool industrial grey-white
    inkColor: '#1a365d',
    carriageRules: {
      type: 'passap_pushers',  // Pushers with dual lock systems (N-X-GX)
      laceCarriageDirectionalTransfers: false,
      transfersInCarriageDirection: true,
      knitsYarnDuringLace: true,
      minPlainRowsAfterLace: 1,
      requiresEmptyNeedleSelection: false,
      cardReadingOffsetRows: 0,
    },
    description: 'Double-bed 5mm system for Passap Duo 80 with U-100E transfer carriage or Deco punchcard reader.'
  },

  brother_bulky_24: {
    id: 'brother_bulky_24',
    name: 'Brother Chunky / Bulky (9.0mm Gauge)',
    gauge: 'Bulky (9.0mm)',
    columns: 24,
    defaultRows: 48,
    minRows: 12,
    maxRows: 180,
    pitchX: 9.0,            // 9mm wide needle spacing
    pitchY: 6.5,            // 6.5mm vertical card pitch
    holeDiameter: 4.2,      // Larger mechanical sensing holes
    sprocketDiameter: 4.5,
    sprocketPitchY: 6.5,
    marginSide: 8.0,
    sprocketToFirstHole: 10.0,
    marginTopBottom: 20.0,
    cardWidth: 240.0,
    cardColor: '#f5edd6',
    inkColor: '#2d3748',
    carriageRules: {
      type: 'brother_bulky',
      laceCarriageDirectionalTransfers: true,
      transfersInCarriageDirection: true,
      knitsYarnDuringLace: false,
      minPlainRowsAfterLace: 2,
      requiresEmptyNeedleSelection: true,
      cardReadingOffsetRows: 6,
    },
    description: '9mm heavy yarn machine for Brother KH-260, KH-270 with punchcard patterning.'
  },

  toyota_standard_24: {
    id: 'toyota_standard_24',
    name: 'Toyota Standard (24-Stitch Simplex)',
    gauge: 'Standard (4.5mm)',
    columns: 24,
    defaultRows: 60,
    minRows: 12,
    maxRows: 240,
    pitchX: 4.5,
    pitchY: 5.08,
    holeDiameter: 3.2,
    sprocketDiameter: 3.5,
    sprocketPitchY: 5.08,
    marginSide: 6.0,
    sprocketToFirstHole: 7.5,
    marginTopBottom: 15.0,
    cardWidth: 140.0,
    cardColor: '#fef3c7',
    inkColor: '#78350f',
    carriageRules: {
      type: 'toyota_simplex',
      laceCarriageDirectionalTransfers: true,
      transfersInCarriageDirection: true,
      knitsYarnDuringLace: false,
      minPlainRowsAfterLace: 2,
      requiresEmptyNeedleSelection: true,
      cardReadingOffsetRows: 7,
    },
    description: 'Toyota KS-901, KS-950 standard 4.5mm punchcard machines.'
  },

  custom_parametric: {
    id: 'custom_parametric',
    name: 'Parametric / Custom CNC Punchcard',
    gauge: 'Parametric',
    columns: 24,
    defaultRows: 60,
    minRows: 4,
    maxRows: 600,
    pitchX: 4.5,
    pitchY: 5.0,
    holeDiameter: 3.2,
    sprocketDiameter: 3.5,
    sprocketPitchY: 5.0,
    marginSide: 6.0,
    sprocketToFirstHole: 7.5,
    marginTopBottom: 15.0,
    cardWidth: 140.0,
    cardColor: '#f8fafc',
    inkColor: '#0f172a',
    carriageRules: {
      type: 'brother_separated',
      laceCarriageDirectionalTransfers: true,
      transfersInCarriageDirection: true,
      knitsYarnDuringLace: false,
      minPlainRowsAfterLace: 2,
      requiresEmptyNeedleSelection: true,
      cardReadingOffsetRows: 0,
    },
    description: 'Fully customizable physical parameters for experimental CNC cut cards or DIY knitting machines.'
  }
};

/**
 * Calculates physical geometric bounding box for a card configuration
 */
export function calculateCardDimensions(profile, rows, cols) {
  const c = cols || profile.columns;
  const r = rows || profile.defaultRows;

  // Total active grid width: distance between col 0 and col (c-1)
  const gridWidth = (c - 1) * profile.pitchX;

  // Card width: left margin + sprocket + sprocketToFirstHole + gridWidth + sprocketToFirstHole + sprocket + right margin
  const calculatedCardWidth = (profile.marginSide * 2) +
    (profile.sprocketToFirstHole * 2) +
    gridWidth;

  const width = Math.max(profile.cardWidth, calculatedCardWidth);

  // Total active height
  const gridHeight = (r - 1) * profile.pitchY;
  const totalHeight = gridHeight + (profile.marginTopBottom * 2);

  return {
    widthMm: width,
    heightMm: totalHeight,
    gridWidthMm: gridWidth,
    gridHeightMm: gridHeight,
    colOffsetXMm: (width - gridWidth) / 2, // Centered horizontally
    rowOffsetYMm: profile.marginTopBottom,
    leftSprocketXMm: profile.marginSide,
    rightSprocketXMm: width - profile.marginSide,
    rows: r,
    cols: c
  };
}
