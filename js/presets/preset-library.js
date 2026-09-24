/**
 * KNITCAT - Pattern library, master index.
 *
 * Two halves are concatenated here into one `PATTERN_PRESETS`:
 *   - the original hand-written classics below (`CLASSIC_PRESETS`), and
 *   - the exhaustive recipe families authored in `patterns-*.js`, which build on the
 *     shared `preset-recipe-helpers.js` toolkit and are classified into the two-tier
 *     family/group taxonomy in `preset-catalog.js`.
 *
 * Everything is generative (`generate(rows, cols, seed)`), so the whole ~150-pattern
 * collection is code, not hand-typed matrices, and it sizes itself to whatever bed the
 * user has selected.
 */

import { STITCH_TYPE } from '../math/knit-topology.js';
import { LACE_PRESETS } from './patterns-lace.js';
import { COLORWORK_PRESETS } from './patterns-colorwork.js';
import { TEXTURE_PRESETS, DOUBLE_BED_PRESETS } from './patterns-texture-dbed.js';
import {
  GENERATIVE_PRESETS,
  EDGES_PRESETS,
  SHAPING_PRESETS
} from './patterns-generative-edges.js';
import { WEAVE_PRESETS } from './patterns-weave.js';
import { EXTENDED_PRESETS } from './patterns-extension.js';
import { MATH_STUDIO_PRESETS } from './patterns-math-studio.js';

const CLASSIC_PRESETS = [
  {
    id: 'feather_fan_lace',
    name: 'Feather & Fan (Old Shale Lace)',
    category: 'Lace',
    rows: 24,
    cols: 24,
    mode: 'lace',
    description: 'Traditional Shetland wavy lace with alternating eyelets and directional transfer decreases.',
    generate: (rows, cols) => {
      const matrix = [];
      for (let r = 0; r < rows; r++) {
        matrix[r] = new Array(cols).fill(STITCH_TYPE.KNIT);
        const cycle = r % 8;

        if (cycle === 0 || cycle === 4) {
          // Transfer row
          for (let c = 0; c < cols; c += 12) {
            // Decreases
            matrix[r][c] = STITCH_TYPE.TRANSFER_RIGHT;
            matrix[r][c + 1] = STITCH_TYPE.TRANSFER_RIGHT;
            matrix[r][c + 2] = STITCH_TYPE.TRANSFER_RIGHT;

            // Eyelets
            matrix[r][c + 4] = STITCH_TYPE.EYELET;
            matrix[r][c + 6] = STITCH_TYPE.EYELET;
            matrix[r][c + 8] = STITCH_TYPE.EYELET;

            // Left decreases
            matrix[r][c + 9] = STITCH_TYPE.TRANSFER_LEFT;
            matrix[r][c + 10] = STITCH_TYPE.TRANSFER_LEFT;
            matrix[r][c + 11] = STITCH_TYPE.TRANSFER_LEFT;
          }
        }
      }
      return matrix;
    }
  },

  {
    id: 'diamond_mesh_lace',
    name: 'Diamond Trellis Mesh Lace',
    category: 'Lace',
    rows: 32,
    cols: 24,
    mode: 'lace',
    description: 'Architectural diamond grid lace where eyelets form interlacing diagonal diamond walls.',
    generate: (rows, cols) => {
      const matrix = [];
      for (let r = 0; r < rows; r++) {
        matrix[r] = new Array(cols).fill(STITCH_TYPE.KNIT);
        const shift = (r % 4 === 0) ? 0 : (r % 4 === 2) ? 2 : -1;

        if (shift >= 0) {
          for (let c = 0; c < cols; c += 4) {
            const eyeCol = (c + shift) % cols;
            const decCol = (eyeCol + 1) % cols;
            matrix[r][eyeCol] = STITCH_TYPE.EYELET;
            matrix[r][decCol] = STITCH_TYPE.TRANSFER_LEFT;
          }
        }
      }
      return matrix;
    }
  },

  {
    id: 'horseshoe_lace',
    name: 'Horseshoe Arch Lace',
    category: 'Lace',
    rows: 32,
    cols: 24,
    mode: 'lace',
    description: 'Convex arched horseshoe ribs with paired yarnovers and centered spine decreases.',
    generate: (rows, cols) => {
      const matrix = [];
      const repeatW = 12;

      for (let r = 0; r < rows; r++) {
        matrix[r] = new Array(cols).fill(STITCH_TYPE.KNIT);
        const phase = r % 8;

        for (let base = 0; base < cols; base += repeatW) {
          if (phase === 0) {
            matrix[r][base + 1] = STITCH_TYPE.EYELET;
            matrix[r][base + 2] = STITCH_TYPE.TRANSFER_LEFT;
            matrix[r][base + 9] = STITCH_TYPE.TRANSFER_RIGHT;
            matrix[r][base + 10] = STITCH_TYPE.EYELET;
          } else if (phase === 2) {
            matrix[r][base + 2] = STITCH_TYPE.EYELET;
            matrix[r][base + 3] = STITCH_TYPE.TRANSFER_LEFT;
            matrix[r][base + 8] = STITCH_TYPE.TRANSFER_RIGHT;
            matrix[r][base + 9] = STITCH_TYPE.EYELET;
          } else if (phase === 4) {
            matrix[r][base + 3] = STITCH_TYPE.EYELET;
            matrix[r][base + 4] = STITCH_TYPE.TRANSFER_LEFT;
            matrix[r][base + 7] = STITCH_TYPE.TRANSFER_RIGHT;
            matrix[r][base + 8] = STITCH_TYPE.EYELET;
          } else if (phase === 6) {
            matrix[r][base + 5] = STITCH_TYPE.CENTER_DEC;
            matrix[r][base + 6] = STITCH_TYPE.EYELET;
          }
        }
      }
      return matrix;
    }
  },

  {
    id: 'leaf_vine_lace',
    name: 'Leaf & Branch Organic Lace',
    category: 'Lace',
    rows: 36,
    cols: 24,
    mode: 'lace',
    description: 'Delicate botanical lace motif with branching leaves formed by outward transfer vectors.',
    generate: (rows, cols) => {
      const matrix = [];
      for (let r = 0; r < rows; r++) {
        matrix[r] = new Array(cols).fill(STITCH_TYPE.KNIT);
        const step = r % 12;

        for (let b = 0; b < cols; b += 12) {
          if (step >= 1 && step <= 5) {
            const spread = step;
            const leftEye = Math.max(0, b + 5 - spread);
            const rightEye = Math.min(cols - 1, b + 6 + spread);
            matrix[r][leftEye] = STITCH_TYPE.EYELET;
            matrix[r][Math.min(cols - 1, leftEye + 1)] = STITCH_TYPE.TRANSFER_LEFT;
            matrix[r][rightEye] = STITCH_TYPE.EYELET;
            matrix[r][Math.max(0, rightEye - 1)] = STITCH_TYPE.TRANSFER_RIGHT;
          } else if (step >= 7 && step <= 11) {
            const decay = 11 - step;
            matrix[r][b + 2 + decay] = STITCH_TYPE.TRANSFER_RIGHT;
            matrix[r][b + 9 - decay] = STITCH_TYPE.TRANSFER_LEFT;
          }
        }
      }
      return matrix;
    }
  },

  {
    id: 'nordic_star_jacquard',
    name: 'Nordic Snowflake Fair Isle',
    category: 'Fair Isle',
    rows: 24,
    cols: 24,
    mode: 'fair_isle',
    description: 'Iconic Scandinavian 8-pointed star stranded jacquard colorwork.',
    generate: (rows, cols) => {
      const pat24 = [
        "....X..........X....",
        "...XXX........XXX...",
        "..XXXXX......XXXXX..",
        ".XX.X.XX....XX.X.XX.",
        "XXXX.XXXX..XXXX.XXXX",
        ".XX.X.XX....XX.X.XX.",
        "..XXXXX......XXXXX..",
        "...XXX........XXX...",
        "....X..........X....",
        "........XXXX........",
        "......XXXXXXXX......",
        ".....XXXXXXXXXX.....",
        "....XXXXXXXXXXXX....",
        ".....XXXXXXXXXX.....",
        "......XXXXXXXX......",
        "........XXXX........",
        "....X..........X....",
        "...XXX........XXX...",
        "..XXXXX......XXXXX..",
        ".XX.X.XX....XX.X.XX.",
        "XXXX.XXXX..XXXX.XXXX",
        ".XX.X.XX....XX.X.XX.",
        "..XXXXX......XXXXX..",
        "...XXX........XXX..."
      ];

      const matrix = [];
      for (let r = 0; r < rows; r++) {
        matrix[r] = [];
        const line = pat24[r % pat24.length];
        for (let c = 0; c < cols; c++) {
          const char = line[c % line.length];
          matrix[r][c] = (char === 'X') ? 1 : 0;
        }
      }
      return matrix;
    }
  },

  {
    id: 'houndstooth_jacquard',
    name: 'Houndstooth (Pied-de-poule)',
    category: 'Fair Isle',
    rows: 24,
    cols: 24,
    mode: 'fair_isle',
    description: 'Classic bespoke optical tessellation woven with alternating contrast checks.',
    generate: (rows, cols) => {
      const tile = [
        [1, 1, 1, 1, 0, 0, 0, 0],
        [1, 1, 1, 1, 0, 0, 0, 0],
        [1, 1, 1, 1, 0, 0, 0, 0],
        [1, 1, 1, 1, 0, 0, 0, 0],
        [0, 1, 0, 1, 1, 1, 1, 1],
        [0, 0, 1, 1, 1, 1, 1, 1],
        [0, 0, 0, 1, 1, 1, 1, 1],
        [0, 0, 0, 0, 1, 1, 1, 1]
      ];
      const matrix = [];
      for (let r = 0; r < rows; r++) {
        matrix[r] = [];
        for (let c = 0; c < cols; c++) {
          matrix[r][c] = tile[r % 8][c % 8];
        }
      }
      return matrix;
    }
  },

  {
    id: 'honeycomb_tuck',
    name: 'Honeycomb Dimensional Tuck',
    category: 'Tuck',
    rows: 24,
    cols: 24,
    mode: 'tuck',
    description: 'Cellular 3D textured honeycomb with alternating tucked loop accumulations.',
    generate: (rows, cols) => {
      const matrix = [];
      for (let r = 0; r < rows; r++) {
        matrix[r] = [];
        const phase = Math.floor(r / 3) % 2;
        for (let c = 0; c < cols; c++) {
          // In tuck mode: 0 = tuck, 1 = knit
          if (phase === 0) {
            matrix[r][c] = (c % 4 === 0) ? 0 : 1;
          } else {
            matrix[r][c] = (c % 4 === 2) ? 0 : 1;
          }
        }
      }
      return matrix;
    }
  },

  {
    id: 'benji_pixel_hearts_lace',
    name: "I LOVE YOU BENJI <3",
    category: 'Romance Lace',
    rows: 24,
    cols: 24,
    mode: 'lace',
    description: 'Bespoke romantic eyelet lace hearts framed with directional transfers pointing toward heart lobes. for my cute boy :3',
    generate: (rows, cols) => {
      const matrix = [];
      const heartPattern = [
        "..O...O.",
        ".O.O.O.O",
        "O...O...O",
        ".O.....O.",
        "..O...O..",
        "...O.O...",
        "....O...."
      ];

      for (let r = 0; r < rows; r++) {
        matrix[r] = new Array(cols).fill(STITCH_TYPE.KNIT);
        const subR = r % 12;

        if (subR === 0) {
          // Heart bottom tip eyelet + center dec
          for (let b = 0; b < cols; b += 12) {
            matrix[r][b + 5] = STITCH_TYPE.EYELET;
            matrix[r][b + 6] = STITCH_TYPE.CENTER_DEC;
          }
        } else if (subR === 2) {
          // Expanding lower heart lobes
          for (let b = 0; b < cols; b += 12) {
            matrix[r][b + 3] = STITCH_TYPE.EYELET;
            matrix[r][b + 4] = STITCH_TYPE.TRANSFER_LEFT;
            matrix[r][b + 7] = STITCH_TYPE.TRANSFER_RIGHT;
            matrix[r][b + 8] = STITCH_TYPE.EYELET;
          }
        } else if (subR === 4) {
          // Broad mid heart
          for (let b = 0; b < cols; b += 12) {
            matrix[r][b + 2] = STITCH_TYPE.EYELET;
            matrix[r][b + 3] = STITCH_TYPE.TRANSFER_LEFT;
            matrix[r][b + 8] = STITCH_TYPE.TRANSFER_RIGHT;
            matrix[r][b + 9] = STITCH_TYPE.EYELET;
          }
        } else if (subR === 6) {
          // Heart top lobes
          for (let b = 0; b < cols; b += 12) {
            matrix[r][b + 3] = STITCH_TYPE.EYELET;
            matrix[r][b + 5] = STITCH_TYPE.TRANSFER_RIGHT;
            matrix[r][b + 6] = STITCH_TYPE.TRANSFER_LEFT;
            matrix[r][b + 8] = STITCH_TYPE.EYELET;
          }
        }
      }
      return matrix;
    }
  },

  {
    id: 'sweetheart_pixel_fair_isle',
    name: 'Sweetheart Pixel Hearts (Fair Isle)',
    category: 'Romance Colorwork',
    rows: 24,
    cols: 24,
    mode: 'fair_isle',
    description: 'Charming 8-bit romantic pixel hearts designed with balanced yarn floats.',
    generate: (rows, cols) => {
      const heart12 = [
        '............',
        '...XX..XX...',
        '..XXXXXXXX..',
        '.XXXXXXXXXX.',
        '.XXXXXXXXXX.',
        '..XXXXXXXX..',
        '...XXXXXX...',
        '....XXXX....',
        '.....XX.....',
        '............',
        '............',
        '............'
      ];
      const matrix = [];
      for (let r = 0; r < rows; r++) {
        matrix[r] = [];
        const isOffset = Math.floor(r / 12) % 2 === 1;
        const line = heart12[r % 12];
        for (let c = 0; c < cols; c++) {
          const charIdx = (c + (isOffset ? 6 : 0)) % 12;
          matrix[r][c] = (line[charIdx] === 'X') ? 1 : 0;
        }
      }
      return matrix;
    }
  },

  // ─── Additional Lace Patterns ───────────────────────────────────────────────

  {
    id: 'rose_window_lace',
    name: 'Rose Window Cathedral Lace',
    category: 'Lace',
    rows: 32,
    cols: 24,
    mode: 'lace',
    description: 'Gothic rose-window inspired lace with radiating eyelet spokes and lattice arches.',
    generate: (rows, cols) => {
      const matrix = [];
      for (let r = 0; r < rows; r++) {
        matrix[r] = new Array(cols).fill(STITCH_TYPE.KNIT);
        const phase = r % 8;
        for (let b = 0; b < cols; b += 8) {
          if (phase === 0) {
            // Radial centre
            matrix[r][(b + 3) % cols] = STITCH_TYPE.EYELET;
            matrix[r][(b + 4) % cols] = STITCH_TYPE.EYELET;
          } else if (phase === 2) {
            matrix[r][(b + 1) % cols] = STITCH_TYPE.EYELET;
            matrix[r][(b + 2) % cols] = STITCH_TYPE.TRANSFER_LEFT;
            matrix[r][(b + 5) % cols] = STITCH_TYPE.TRANSFER_RIGHT;
            matrix[r][(b + 6) % cols] = STITCH_TYPE.EYELET;
          } else if (phase === 4) {
            matrix[r][(b + 0) % cols] = STITCH_TYPE.EYELET;
            matrix[r][(b + 3) % cols] = STITCH_TYPE.CENTER_DEC;
            matrix[r][(b + 4) % cols] = STITCH_TYPE.CENTER_DEC;
            matrix[r][(b + 7) % cols] = STITCH_TYPE.EYELET;
          } else if (phase === 6) {
            matrix[r][(b + 2) % cols] = STITCH_TYPE.TRANSFER_LEFT;
            matrix[r][(b + 5) % cols] = STITCH_TYPE.TRANSFER_RIGHT;
          }
        }
      }
      return matrix;
    }
  },

  {
    id: 'spiral_lace',
    name: 'Fibonacci Spiral Lace',
    category: 'Lace',
    rows: 32,
    cols: 24,
    mode: 'lace',
    description: 'Logarithmic spiral of eyelets following a Fibonacci angular progression.',
    generate: (rows, cols) => {
      const matrix = [];
      for (let r = 0; r < rows; r++) {
        matrix[r] = new Array(cols).fill(STITCH_TYPE.KNIT);
      }
      const phi = (1 + Math.sqrt(5)) / 2;
      const goldenAngle = 2 * Math.PI * (1 - 1 / phi);
      const N = Math.floor(rows * cols / 5);
      for (let i = 0; i < N; i++) {
        const t = i / N;
        const angle = i * goldenAngle;
        const radius = t * Math.min(rows, cols) / 2;
        const cx = cols / 2 + radius * Math.cos(angle) * 0.7;
        const cy = rows / 2 + radius * Math.sin(angle) * 0.7;
        const c = Math.round(cx) % cols;
        const r = Math.round(cy);
        if (r >= 0 && r < rows && c >= 0 && c < cols) {
          if (i % 3 === 0) matrix[r][c] = STITCH_TYPE.EYELET;
          else if (i % 3 === 1) matrix[r][c] = STITCH_TYPE.TRANSFER_LEFT;
          else matrix[r][c] = STITCH_TYPE.TRANSFER_RIGHT;
        }
      }
      return matrix;
    }
  },

  {
    id: 'double_faggot_lace',
    name: 'Double Faggot Net Lace',
    category: 'Lace',
    rows: 24,
    cols: 24,
    mode: 'lace',
    description: 'Classic open-work faggot net — every row alternates paired yarnover-decrease units.',
    generate: (rows, cols) => {
      const matrix = [];
      for (let r = 0; r < rows; r++) {
        matrix[r] = new Array(cols).fill(STITCH_TYPE.KNIT);
        const offset = (r % 2) * 2;
        for (let c = offset; c < cols - 1; c += 4) {
          matrix[r][c] = STITCH_TYPE.EYELET;
          matrix[r][c + 1] = STITCH_TYPE.TRANSFER_LEFT;
          if (c + 3 < cols) {
            matrix[r][c + 2] = STITCH_TYPE.EYELET;
            matrix[r][c + 3] = STITCH_TYPE.TRANSFER_RIGHT;
          }
        }
      }
      return matrix;
    }
  },

  {
    id: 'moss_diamond_lace',
    name: 'Moss Diamond Textured Lace',
    category: 'Lace',
    rows: 24,
    cols: 24,
    mode: 'lace',
    description: 'Nested diamonds with purled moss texture infill and eyelet border — Victorian era design.',
    generate: (rows, cols) => {
      const matrix = [];
      for (let r = 0; r < rows; r++) {
        matrix[r] = new Array(cols).fill(STITCH_TYPE.KNIT);
        const phase = r % 12;
        const span = phase <= 5 ? phase : 11 - phase;
        for (let b = 0; b < cols; b += 12) {
          const centre = b + 5;
          if (span > 0 && centre - span >= 0) {
            matrix[r][(centre - span) % cols] = STITCH_TYPE.EYELET;
          }
          if (span > 0 && centre + span < cols) {
            matrix[r][(centre + span) % cols] = STITCH_TYPE.EYELET;
          }
          if (span > 1) {
            if (centre - span + 1 >= 0) matrix[r][(centre - span + 1) % cols] = STITCH_TYPE.TRANSFER_RIGHT;
            if (centre + span - 1 < cols) matrix[r][(centre + span - 1) % cols] = STITCH_TYPE.TRANSFER_LEFT;
          }
        }
      }
      return matrix;
    }
  },

  {
    id: 'vine_trellis_lace',
    name: 'Vine Trellis Openwork',
    category: 'Lace',
    rows: 36,
    cols: 24,
    mode: 'lace',
    description: 'Winding diagonal vine trails with eyelet buds — Art Nouveau botanical motif.',
    generate: (rows, cols) => {
      const matrix = [];
      for (let r = 0; r < rows; r++) {
        matrix[r] = new Array(cols).fill(STITCH_TYPE.KNIT);
        // Two diagonal vine trails staggered by cols/2
        for (const offset of [0, Math.floor(cols / 2)]) {
          const c = (offset + Math.round(r * 0.75)) % cols;
          if (r % 3 === 0) {
            matrix[r][c] = STITCH_TYPE.EYELET;
            matrix[r][(c + 1) % cols] = STITCH_TYPE.TRANSFER_LEFT;
          } else if (r % 3 === 1) {
            matrix[r][(c - 1 + cols) % cols] = STITCH_TYPE.TRANSFER_RIGHT;
          }
        }
      }
      return matrix;
    }
  },

  // ─── Additional Fair Isle / Jacquard ────────────────────────────────────────

  {
    id: 'argyle_diamond',
    name: 'Argyle Diamond Plaid',
    category: 'Fair Isle',
    rows: 24,
    cols: 24,
    mode: 'fair_isle',
    description: 'Classic Scottish Argyle diamond grid with diagonal crossing lines.',
    generate: (rows, cols) => {
      const matrix = [];
      const size = 8;
      for (let r = 0; r < rows; r++) {
        matrix[r] = [];
        for (let c = 0; c < cols; c++) {
          const dx = ((c % size) - size / 2 + size) % size;
          const dy = ((r % size) - size / 2 + size) % size;
          const dist = Math.abs(dx - size / 2) + Math.abs(dy - size / 2);
          matrix[r][c] = (dist <= size / 2) ? 1 : 0;
        }
      }
      return matrix;
    }
  },

  {
    id: 'peacock_tail',
    name: 'Peacock Tail Feather',
    category: 'Fair Isle',
    rows: 32,
    cols: 24,
    mode: 'fair_isle',
    description: 'Bold stylised peacock eye/tail motif with iridescent layered arcs.',
    generate: (rows, cols) => {
      const matrix = [];
      for (let r = 0; r < rows; r++) {
        matrix[r] = [];
        for (let c = 0; c < cols; c++) {
          const cx = (c % 12) - 5.5;
          const cy = (r % 16) - 12;
          const dist = Math.sqrt(cx * cx + cy * cy * 0.5);
          matrix[r][c] = ((dist > 1.5 && dist < 3.5) || (dist > 5 && dist < 6.5)) ? 1 : 0;
        }
      }
      return matrix;
    }
  },

  {
    id: 'turkish_kilim',
    name: 'Turkish Kilim Geometric',
    category: 'Fair Isle',
    rows: 32,
    cols: 24,
    mode: 'fair_isle',
    description: 'Bold Anatolian kilim geometric with stepped triangles and cross-medallions.',
    generate: (rows, cols) => {
      const tile = [
        [1, 1, 0, 0, 1, 1, 0, 0],
        [1, 0, 0, 0, 0, 0, 0, 1],
        [0, 0, 1, 1, 1, 1, 0, 0],
        [0, 1, 1, 0, 0, 1, 1, 0],
        [0, 1, 1, 0, 0, 1, 1, 0],
        [0, 0, 1, 1, 1, 1, 0, 0],
        [1, 0, 0, 0, 0, 0, 0, 1],
        [1, 1, 0, 0, 1, 1, 0, 0]
      ];
      const matrix = [];
      for (let r = 0; r < rows; r++) {
        matrix[r] = [];
        for (let c = 0; c < cols; c++) {
          matrix[r][c] = tile[r % 8][c % 8];
        }
      }
      return matrix;
    }
  },

  {
    id: 'art_deco_fan',
    name: 'Art Déco Sunburst Fan',
    category: 'Fair Isle',
    rows: 32,
    cols: 24,
    mode: 'fair_isle',
    description: '1920s Art Déco sunburst motif with radiating fan arcs and chevron borders.',
    generate: (rows, cols) => {
      const matrix = [];
      for (let r = 0; r < rows; r++) {
        matrix[r] = [];
        for (let c = 0; c < cols; c++) {
          const cx = (c % 12) - 5.5;
          const cy = (r % 16);
          const angle = Math.atan2(cy, cx);
          const sector = Math.floor((angle / Math.PI + 1) * 5) % 2;
          const dist = Math.sqrt(cx * cx + cy * cy / 2);
          matrix[r][c] = (sector === 0 && dist > 2 && dist < 7) ? 1 : 0;
        }
      }
      return matrix;
    }
  },

  {
    id: 'tartan_plaid',
    name: 'Tartan Plaid Colorwork',
    category: 'Fair Isle',
    rows: 24,
    cols: 24,
    mode: 'fair_isle',
    description: 'Classic Scottish tartan warp-and-weft plaid — diagonal lines and crossing bands.',
    generate: (rows, cols) => {
      const matrix = [];
      const stripe = [2, 4]; // stripe widths
      for (let r = 0; r < rows; r++) {
        matrix[r] = [];
        for (let c = 0; c < cols; c++) {
          const diagPos = (r + c) % 8;
          const horzPos = r % 8;
          const vertPos = c % 8;
          const isStripe = (horzPos < 2 || vertPos < 2 || (diagPos < 1));
          matrix[r][c] = isStripe ? 1 : 0;
        }
      }
      return matrix;
    }
  },

  // ─── Tuck & Slip Stitch Textures ─────────────────────────────────────────────

  {
    id: 'seed_stitch_tuck',
    name: 'Seed Stitch Tuck Texture',
    category: 'Tuck',
    rows: 24,
    cols: 24,
    mode: 'tuck',
    description: 'Alternating knit-tuck checkerboard in a true seed-stitch arrangement.',
    generate: (rows, cols) => {
      const matrix = [];
      for (let r = 0; r < rows; r++) {
        matrix[r] = [];
        for (let c = 0; c < cols; c++) {
          matrix[r][c] = ((r + c) % 2 === 0) ? 1 : 0;
        }
      }
      return matrix;
    }
  },

  {
    id: 'welt_tuck',
    name: 'Welt & Fisherman Rib Tuck',
    category: 'Tuck',
    rows: 24,
    cols: 24,
    mode: 'tuck',
    description: 'Long-interval tuck sequences that produce welted horizontal welt ridges.',
    generate: (rows, cols) => {
      const matrix = [];
      for (let r = 0; r < rows; r++) {
        matrix[r] = [];
        const isTuckRow = r % 6 < 3;
        for (let c = 0; c < cols; c++) {
          if (isTuckRow) {
            matrix[r][c] = (c % 2 === 0) ? 0 : 1;
          } else {
            matrix[r][c] = 1;
          }
        }
      }
      return matrix;
    }
  },

  {
    id: 'bird_eye_slip',
    name: "Bird's Eye Slip Stitch",
    category: 'Slip',
    rows: 24,
    cols: 24,
    mode: 'slip',
    description: "Classic bird's eye float pattern — alternating slipped stitches create a speckled texture.",
    generate: (rows, cols) => {
      const matrix = [];
      for (let r = 0; r < rows; r++) {
        matrix[r] = [];
        const offset = (Math.floor(r / 2) % 2 === 0) ? 0 : 1;
        for (let c = 0; c < cols; c++) {
          if (r % 2 === 0) {
            matrix[r][c] = ((c + offset) % 2 === 0) ? 0 : 1;
          } else {
            matrix[r][c] = 1; // knit return rows
          }
        }
      }
      return matrix;
    }
  },

  // ─── Romance Special Editions ────────────────────────────────────────────────

  {
    id: 'xoxo_fair_isle',
    name: 'XOXO Love Letter (Fair Isle)',
    category: 'Romance Colorwork',
    rows: 24,
    cols: 24,
    mode: 'fair_isle',
    description: 'Charming XOXO Hugs and Kisses repeat in bold stranded colorwork.',
    generate: (rows, cols) => {
      const xo8 = [
        [1, 1, 0, 0, 0, 1, 1, 0],
        [0, 1, 1, 0, 1, 1, 0, 0],
        [0, 0, 1, 0, 1, 0, 0, 0],
        [0, 1, 1, 0, 1, 1, 0, 0],
        [1, 1, 0, 0, 0, 1, 1, 0],
        [0, 0, 0, 0, 0, 0, 0, 0],
        [0, 1, 1, 0, 0, 1, 1, 0],
        [1, 1, 1, 1, 1, 1, 1, 0]
      ];
      const matrix = [];
      for (let r = 0; r < rows; r++) {
        matrix[r] = [];
        for (let c = 0; c < cols; c++) {
          matrix[r][c] = xo8[r % 8][c % 8];
        }
      }
      return matrix;
    }
  },

  {
    id: 'rose_blossom_fair_isle',
    name: 'Rose Blossom Botanical',
    category: 'Romance Colorwork',
    rows: 24,
    cols: 24,
    mode: 'fair_isle',
    description: 'Botanical rose bloom repeat with petals and buds — classic English garden colorwork.',
    generate: (rows, cols) => {
      const rose12 = [
        '....XXXX....',
        '...XXXXXX...',
        '..X.XXXX.X..',
        '..XXXXXXXX..',
        '.XXXXXXXXXX.',
        '.XX.XXXX.XX.',
        '..XXXXXXXX..',
        '...XXXXXX...',
        '....X..X....',
        '....X..X....',
        '...XX..XX...',
        '............'
      ];
      const matrix = [];
      for (let r = 0; r < rows; r++) {
        matrix[r] = [];
        const rowOffset = Math.floor(r / 12) % 2 === 0 ? 0 : 6;
        const line = rose12[r % 12];
        for (let c = 0; c < cols; c++) {
          const ci = ((c + rowOffset) % 12);
          matrix[r][c] = (ci < line.length && line[ci] === 'X') ? 1 : 0;
        }
      }
      return matrix;
    }
  },

  {
    id: 'infinity_lace',
    name: 'Infinity Love Knot Lace',
    category: 'Romance Lace',
    rows: 24,
    cols: 24,
    mode: 'lace',
    description: 'Interlaced infinity loops in eyelet lace — an eternal bond knitted in every row.',
    generate: (rows, cols) => {
      const matrix = [];
      for (let r = 0; r < rows; r++) {
        matrix[r] = new Array(cols).fill(STITCH_TYPE.KNIT);
        const phase = r % 12;
        for (let b = 0; b < cols; b += 12) {
          // Left lobe
          if (phase === 0 || phase === 6) {
            matrix[r][(b + 2) % cols] = STITCH_TYPE.EYELET;
            matrix[r][(b + 3) % cols] = STITCH_TYPE.TRANSFER_LEFT;
          }
          if (phase === 2 || phase === 8) {
            matrix[r][(b + 1) % cols] = STITCH_TYPE.EYELET;
            matrix[r][(b + 4) % cols] = STITCH_TYPE.CENTER_DEC;
          }
          // Right lobe
          if (phase === 3 || phase === 9) {
            matrix[r][(b + 7) % cols] = STITCH_TYPE.TRANSFER_RIGHT;
            matrix[r][(b + 9) % cols] = STITCH_TYPE.EYELET;
          }
          if (phase === 5 || phase === 11) {
            matrix[r][(b + 8) % cols] = STITCH_TYPE.CENTER_DEC;
            matrix[r][(b + 10) % cols] = STITCH_TYPE.EYELET;
          }
        }
      }
      return matrix;
    }
  },

  // ─── Two-face (reversible) Fair Isle ────────────────────────────────────────
  // Engineered to sit inside a single 24-stitch punchcard AND tile edge-to-edge
  // with no visible seam, with balanced A/B stitch counts so both faces read a
  // motif. Honest caveat: on your SINGLE-bed machine these knit stranded, with
  // floats trapped between the two faces — a genuinely reversible fabric. A true
  // reversible rib/interlock additionally needs a second (double) needle bed.
  // The `reversible_double_bed_*` ids stay for saved-project compatibility.

  {
    id: 'reversible_double_bed_chevron',
    name: 'Two-Face Chevron (Reversible)',
    category: 'Reversible \u00b7 Two-Face',
    rows: 24,
    cols: 24,
    mode: 'fair_isle',
    description: 'Balanced 2-colour chevron that fits the 24-stitch card and repeats seamlessly, so both faces read a motif. Knits stranded on a single bed (floats trapped inside); a true reversible rib would need a second bed.',
    generate: (rows, cols) => {
      const W = 12, H = 12; // both divide 24 -> seamless tiling
      const matrix = [];
      for (let r = 0; r < rows; r++) {
        matrix[r] = [];
        const ry = r % H;
        for (let c = 0; c < cols; c++) {
          const cx = c % W;
          const ramp = Math.abs((cx % 6) - 2.5);       // zig-zag across the V
          matrix[r][c] = ((ry + Math.round(ramp)) % 6 < 3) ? 1 : 0;
        }
      }
      return matrix;
    }
  },

  {
    id: 'reversible_double_bed_diamond',
    name: 'Two-Face Diamond Lattice (Reversible)',
    category: 'Reversible \u00b7 Two-Face',
    rows: 24,
    cols: 24,
    mode: 'fair_isle',
    description: 'Nested diamond lattice on an 8x8 repeat (x3 across the 24 needles), colour-symmetric vertically so the wrong side mirrors the right. Stranded on a single bed; work it double-bed if you want rib instead of floats.',
    generate: (rows, cols) => {
      const S = 8;
      const matrix = [];
      for (let r = 0; r < rows; r++) {
        matrix[r] = [];
        for (let c = 0; c < cols; c++) {
          const x = c % S, y = r % S;
          // Manhattan distance from tile centre -> concentric diamond rings.
          const d = Math.abs(x - (S - 1) / 2) + Math.abs(y - (S - 1) / 2);
          matrix[r][c] = (Math.round(d) % 3 === 0) ? 1 : 0;
        }
      }
      return matrix;
    }
  },

  // ─── Detailed tessellations (crisp geometry, seamless repeats) ─────────────

  {
    id: 'hexagon_tessellation',
    name: 'Honeycomb Hexagon Tessellation',
    category: 'Fair Isle',
    rows: 24,
    cols: 24,
    mode: 'fair_isle',
    description: 'Honeycomb of outlined hexagons \u2014 walls only, no solid fill \u2014 on a seamless 8x8 grid.',
    generate: (rows, cols) => {
      const matrix = [];
      const s = 8; // hex cell size
      for (let r = 0; r < rows; r++) {
        matrix[r] = [];
        for (let c = 0; c < cols; c++) {
          // Pointy-top hex grid membership via axial rounding distance to centre.
          const q = (c / (s * 0.75));
          const rr = (r / s) + ((Math.floor(q) % 2) * 0.5);
          const cq = Math.round(q), cr = Math.round(rr);
          const dq = q - cq, dr = rr - cr;
          const edge = Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr) * 0.6);
          matrix[r][c] = (edge > 0.42) ? 1 : 0; // thin wall ring
        }
      }
      return matrix;
    }
  },

  {
    id: 'detailed_star_tessellation',
    name: 'Distant Starfield (Detailed)',
    category: 'Fair Isle',
    rows: 24,
    cols: 24,
    mode: 'fair_isle',
    description: 'Fine scattered 5-point stars with radiating spokes on a 12x12 seamless repeat \u2014 high detail, low floats.',
    generate: (rows, cols) => {
      const S = 12;
      const matrix = [];
      for (let r = 0; r < rows; r++) {
        matrix[r] = [];
        for (let c = 0; c < cols; c++) {
          const x = (c % S) - (S - 1) / 2;
          const y = (r % S) - (S - 1) / 2;
          const ang = Math.atan2(y, x);
          const dist = Math.sqrt(x * x + y * y);
          // 5-fold rose-modulated radius -> star shape; also a centred pixel.
          const rose = Math.abs(Math.cos(2.5 * ang));
          const starR = 1.5 + 3.2 * rose;
          const onStar = dist < starR && dist > starR - 1.4;
          matrix[r][c] = (onStar || (Math.abs(x) < 0.6 && Math.abs(y) < 0.6)) ? 1 : 0;
        }
      }
      return matrix;
    }
  }
];

/**
 * Force any generated chart to the exact rectangle the caller asked for.
 *
 * Several of the original hand-written classics step a motif across the bed with a
 * fixed stride (``for c += 12`` writing to ``c + 11``), so on a bed that is not an exact
 * multiple of the repeat they write a few cells past the last needle and hand back a
 * ragged matrix — which the editor and compiler must never see. Cropping the overhang
 * (a hole on a needle that does not exist is no hole at all) and padding any shortfall
 * keeps every recipe, old or new, a well-formed rectangle without editing each one.
 */
function normalizeChart(matrix, rows, cols, mode) {
  const blank = mode === 'lace' ? STITCH_TYPE.KNIT : 0;
  const source = Array.isArray(matrix) ? matrix : [];
  const out = new Array(rows);
  for (let r = 0; r < rows; r++) {
    const src = Array.isArray(source[r]) ? source[r] : null;
    const row = new Array(cols);
    for (let c = 0; c < cols; c++) {
      const value = src && c < src.length ? src[c] : undefined;
      row[c] = value === undefined || value === null ? blank : value;
    }
    out[r] = row;
  }
  return out;
}

/**
 * The complete collection: the original classics plus every authored recipe family.
 * `category` is kept as a friendly fallback label (new presets ship with a `family`/
 * `group` instead), so any older code that still reads a badge keeps working. Every
 * `generate` is wrapped so the chart is always the requested rectangle (see normalizeChart).
 */
export const PATTERN_PRESETS = [
  ...CLASSIC_PRESETS,
  ...LACE_PRESETS,
  ...COLORWORK_PRESETS,
  ...TEXTURE_PRESETS,
  ...DOUBLE_BED_PRESETS,
  ...GENERATIVE_PRESETS,
  ...EDGES_PRESETS,
  ...SHAPING_PRESETS,
  ...WEAVE_PRESETS,
  ...EXTENDED_PRESETS,
  ...MATH_STUDIO_PRESETS
].map(p => {
  const raw = p.generate.bind(p);
  return {
    ...p,
    category: p.category || (p.group ? p.group.replace(/-/g, ' ') : 'Unclassified'),
    generate: (rows, cols, seed) => normalizeChart(raw(rows, cols, seed), rows, cols, p.mode)
  };
});

export { CLASSIC_PRESETS };

