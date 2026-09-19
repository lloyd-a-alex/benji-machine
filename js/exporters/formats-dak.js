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

export class FormatsExporter {
  /**
   * Generates ASCII punchcard matrix with row headers and alignment markings
   */
  static generateAsciiCard(profile, cardMatrix) {
    const rows = cardMatrix.length;
    const cols = cardMatrix[0]?.length || 24;
    const lines = [];

    lines.push(`+----+${'-'.repeat(cols * 2 + 1)}+----+`);
    lines.push(`|ROW | ${profile.name.padEnd(cols * 2 - 1)} | SP |`);
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
   */
  static generateProjectJson(projectData) {
    return JSON.stringify({
      format: 'Antigravity_Industrial_Knit_CAD',
      version: '2.0.0',
      timestamp: new Date().toISOString(),
      ...projectData
    }, null, 2);
  }
}
