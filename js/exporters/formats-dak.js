/**
 * Knitting Machine Electronic Formats & Data Exporter
 * 
 * Generates:
 * 1. DesignaKnit (DAK) PAT format representation
 * 2. Raw binary bitstream (.bin) for AYAB / Arduino / Brother KH-930 floppy emulator
 * 3. ASCII text punchcard matrix (.txt)
 * 4. Machine CSV matrix
 * 5. Full Project JSON Intermediate Representation (.kcard)
 */

import { buildProjectDocument } from '../project/kcard.js';
import { logger } from '../core/logging.js';

const log = logger('exporters/formats-dak');

export class FormatsExporter {
  /**
   * Generates ASCII punchcard matrix with row headers and alignment markings
   */
  static generateAsciiCard(profile, cardMatrix) {
    const rows = cardMatrix.length;
    const cols = cardMatrix[0]?.length || 24;
    if (!profile || typeof profile.name !== 'string') {
      log.warn('generateAsciiCard given a profile without a name — using a placeholder', { profileId: profile?.id });
    }
    const name = (profile && profile.name) ? String(profile.name) : 'KNITCAT CARD';
    const lines = [];

    lines.push(`+----+${'-'.repeat(cols * 2 + 1)}+----+`);
    lines.push(`|ROW | ${name.padEnd(cols * 2 - 1)} | SP |`);
    lines.push(`+----+${'-'.repeat(cols * 2 + 1)}+----+`);

    for (let r = rows - 1; r >= 0; r--) {
      const rowNum = String(r + 1).padStart(3, '0');
      let rowContent = '';
      for (let c = 0; c < cols; c++) {
        rowContent += cardMatrix[r][c] ? ' O' : ' .';
      }
      lines.push(`| ${rowNum}|${rowContent} | (*) |`);
    }

    lines.push(`+----+${'-'.repeat(cols * 2 + 1)}+----+`);
    let colHeader = '     ';
    for (let c = 1; c <= cols; c++) {
      colHeader += (c % 5 === 0) ? String(c % 10).padStart(2, ' ') : '  ';
    }
    lines.push(colHeader);
    return lines.join('\n');
  }

  /**
   * Generates CSV format
   */
  static generateCsv(cardMatrix) {
    const rows = cardMatrix.length;
    const cols = cardMatrix[0]?.length || 24;
    const lines = [];

    // Header
    const header = ['Row'];
    for (let c = 1; c <= cols; c++) header.push(`Col_${c}`);
    lines.push(header.join(','));

    for (let r = 0; r < rows; r++) {
      const rowData = [r + 1];
      for (let c = 0; c < cols; c++) {
        rowData.push(cardMatrix[r][c] ? '1' : '0');
      }
      lines.push(rowData.join(','));
    }
    return lines.join('\n');
  }

  /**
   * Generates raw binary bitstream (packed bytes, 1 bit per hole, MSB first)
   */
  static generateBinaryBitstream(cardMatrix) {
    const rows = cardMatrix.length;
    const cols = cardMatrix[0]?.length || 24;
    const bytesPerRow = Math.ceil(cols / 8);
    const totalBytes = rows * bytesPerRow;
    const buffer = new Uint8Array(totalBytes);

    let byteIdx = 0;
    for (let r = 0; r < rows; r++) {
      let currentByte = 0;
      let bitCount = 0;

      for (let c = 0; c < cols; c++) {
        if (cardMatrix[r][c]) {
          currentByte |= (1 << (7 - (c % 8)));
        }
        bitCount++;

        if (bitCount % 8 === 0 || c === cols - 1) {
          buffer[byteIdx++] = currentByte;
          currentByte = 0;
        }
      }
    }
    return buffer;
  }

  /**
   * Generates DesignaKnit (DAK) compatible stitch text mapping
   */
  static generateDakText(stitchMatrix) {
    const rows = stitchMatrix.length;
    const cols = stitchMatrix[0]?.length || 24;
    const lines = [];

    lines.push('[DESIGNAKNIT_STITCH_PATTERN]');
    lines.push(`WIDTH=${cols}`);
    lines.push(`HEIGHT=${rows}`);
    lines.push('DATA=');

    for (let r = rows - 1; r >= 0; r--) {
      lines.push(stitchMatrix[r].join(','));
    }
    return lines.join('\n');
  }

  /**
   * Complete Project JSON Bundle (.kcard)
   *
   * The envelope (format tag, schema version, timestamp) is owned by
   * ../project/kcard.js so that what we write and what we accept on load can
   * never drift apart.
   */
  static generateProjectJson(projectData) {
    try {
      return JSON.stringify(buildProjectDocument(projectData), null, 2);
    } catch (err) {
      log.logError('failed to serialise the .kcard project bundle', err, { context: { name: projectData?.name } });
      throw err;
    }
  }

  /**
   * Generates Knitic AYAB compatible format
   */
  static generateAyabFormat(cardMatrix) {
    const rows = cardMatrix.length;
    const cols = cardMatrix[0]?.length || 24;
    const lines = [];
    
    lines.push(`AYAB_FORMAT_V1`);
    lines.push(`ROWS:${rows}`);
    lines.push(`COLS:${cols}`);
    lines.push(`START_IMAGE`);
    
    for (let r = 0; r < rows; r++) {
      const rowBits = cardMatrix[r].map(b => b ? '1' : '0').join('');
      lines.push(rowBits);
    }
    
    lines.push(`END_IMAGE`);
    return lines.join('\n');
  }

  /**
   * Generates Brother KH-930 disk image format
   */
  static generateBrotherDiskFormat(cardMatrix) {
    const rows = cardMatrix.length;
    const cols = cardMatrix[0]?.length || 24;
    const buffer = new Uint8Array(2048); // Standard disk sector size
    
    // Brother format header
    const header = 'BROTHER_KH930';
    for (let i = 0; i < header.length; i++) {
      buffer[i] = header.charCodeAt(i);
    }
    
    // Dimensions
    buffer[16] = rows;
    buffer[17] = cols;
    
    // Pattern data
    let byteIdx = 32;
    for (let r = 0; r < rows; r++) {
      let currentByte = 0;
      let bitCount = 0;
      
      for (let c = 0; c < cols; c++) {
        if (cardMatrix[r][c]) {
          currentByte |= (1 << (7 - (c % 8)));
        }
        bitCount++;
        
        if (bitCount % 8 === 0 || c === cols - 1) {
          if (byteIdx >= buffer.length) {
            // Uint8Array silently drops out-of-range writes, so a too-large chart used
            // to produce a truncated disk image with no signal. Surface the overflow.
            log.error('Brother KH-930 disk image overflowed its 2048-byte sector', { rows, cols, byteIdx });
            return buffer;
          }
          buffer[byteIdx++] = currentByte;
          currentByte = 0;
        }
      }
    }
    
    return buffer;
  }

  /**
   * Generates XML-based pattern exchange format
   */
  static generateXmlPattern(projectData) {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<knitpattern xmlns="urn:knitcat:punchcard:v2">
  <metadata>
    <format>KNITCAT_Punchcard_V2</format>
    <version>2.0.0</version>
    <timestamp>${new Date().toISOString()}</timestamp>
    <profile>${projectData.profileId || 'standard'}</profile>
    <mode>${projectData.mode || 'lace'}</mode>
  </metadata>
  <dimensions>
    <rows>${projectData.rows || 24}</rows>
    <cols>${projectData.cols || 24}</cols>
  </dimensions>
  <pattern>
    ${this.generatePatternXmlData(projectData.stitchMatrix)}
  </pattern>
</knitpattern>`;
    return xml;
  }

  static generatePatternXmlData(stitchMatrix) {
    if (!stitchMatrix) return '';
    
    const rows = stitchMatrix.length;
    const cols = stitchMatrix[0]?.length || 24;
    let xml = '';
    
    for (let r = 0; r < rows; r++) {
      xml += `    <row index="${r}">`;
      for (let c = 0; c < cols; c++) {
        xml += `<cell col="${c}" type="${stitchMatrix[r][c] || 'K'}"/>`;
      }
      xml += `</row>\n`;
    }
    
    return xml;
  }

  /**
   * Generates enhanced documentation with statistics
   */
  static generateDocumentation(projectData, compilationResult) {
    const lines = [];
    
    lines.push(`# KNITCAT Pattern Documentation`);
    lines.push(``);
    lines.push(`## Project Information`);
    lines.push(`- **Format**: KNITCAT punchcard exchange v2.0`);
    lines.push(`- **Generated**: ${new Date().toISOString()}`);
    lines.push(`- **Profile**: ${projectData.profileId || 'standard'}`);
    lines.push(`- **Mode**: ${projectData.mode || 'lace'}`);
    lines.push(``);
    
    if (compilationResult) {
      lines.push(`## Compilation Statistics`);
      lines.push(`- **Total Carriage Passes**: ${compilationResult.totalPasses}`);
      lines.push(`- **Lace Passes**: ${compilationResult.totalLacePasses}`);
      lines.push(`- **Knit Passes**: ${compilationResult.totalKnitPasses}`);
      lines.push(`- **Card Rows**: ${compilationResult.cardMatrix?.length || 0}`);
      lines.push(``);
      
      if (compilationResult.diagnostics && compilationResult.diagnostics.length > 0) {
        lines.push(`## Diagnostics`);
        for (const diag of compilationResult.diagnostics) {
          lines.push(`- [${diag.type.toUpperCase()}] ${diag.message}`);
          if (diag.row !== null) {
            lines.push(`  Location: Row ${diag.row + 1}${diag.col !== null ? `, Col ${diag.col + 1}` : ''}`);
          }
        }
        lines.push(``);
      }
    }
    
    lines.push(`## Pattern Dimensions`);
    lines.push(`- **Rows**: ${projectData.rows || 24}`);
    lines.push(`- **Columns**: ${projectData.cols || 24}`);
    lines.push(`- **Total Cells**: ${(projectData.rows || 24) * (projectData.cols || 24)}`);
    lines.push(``);
    
    lines.push(`## Export Formats`);
    lines.push(`This pattern can be exported to:`);
    lines.push(`- DXF (AutoCAD/Laser Cutting)`);
    lines.push(`- G-Code (CNC Machines)`);
    lines.push(`- SVG (Vector Graphics)`);
    lines.push(`- PDF (1:1 Printable)`);
    lines.push(`- Binary (Arduino/AYAB)`);
    lines.push(`- CSV (Spreadsheet)`);
    lines.push(`- JSON (Project Data)`);
    lines.push(`- XML (Pattern Exchange)`);
    
    return lines.join('\n');
  }
}
