/**
 * Beanie / Watch-Cap Tailoring Engine (self-contained, additive).
 *
 * Turns a head circumference + a measured gauge into a real, top-down-or-bottom-up
 * machine-knit beanie plan: ribbed brim, straight body, and an even crown decrease
 * that closes cleanly. Never throws on bad input — callers can treat it as data-only.
 *
 * Design notes:
 *   • Beanie is knit in the round (tubular), so cast-on is the FULL circumference.
 *   • Ribbing contracts, so the brim is cast on tighter than the body.
 *   • Cast-on is snapped to a multiple of `crownSegments` so the crown divides evenly.
 */

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const round = Math.round;

export class BeanieEngine {
  static DEFAULTS = {
    headCircumferenceCm: 56,
    beanieHeightCm: 20,
    ribbingHeightCm: 5,
    ribbingType: '1x1',   // '1x1' | '2x2'
    crownSegments: 6,     // 5 | 6 | 8 | 10
    negativeEaseCm: 2,    // beanie hugs the head a little
    pomPom: true
  };

  /**
   * @param {object} params  garment measurements (cm)
   * @param {object} gauge   { stitchesPer10Cm, rowsPer10Cm }
   */
  compute(params = {}, gauge = {}) {
    const p = { ...BeanieEngine.DEFAULTS, ...params };
    const stsPer10 = clamp(parseFloat(gauge.stitchesPer10Cm) || 28, 8, 120);
    const rowsPer10 = clamp(parseFloat(gauge.rowsPer10Cm) || 40, 8, 200);
    const stsPerCm = stsPer10 / 10;
    const rowsPerCm = rowsPer10 / 10;

    const segments = clamp(parseInt(p.crownSegments, 10) || 6, 4, 12);
    const headC = clamp(parseFloat(p.headCircumferenceCm) || 56, 40, 75);
    const heightC = clamp(parseFloat(p.beanieHeightCm) || 20, 12, 40);
    const ribC = clamp(parseFloat(p.ribbingHeightCm) || 5, 2, 12);

    // Body circumference (with a little negative ease) -> stitch count.
    const bodyC = Math.max(40, headC - (parseFloat(p.negativeEaseCm) || 0));
    let bodySts = round(bodyC * stsPerCm);
    // Snap cast-on down to a clean multiple of the crown segments (so it divides),
    // and keep it a multiple of 2 for tubular ribbing symmetry.
    const divisor = segments * (p.ribbingType === '2x2' ? 2 : 1);
    bodySts = Math.max(divisor, Math.floor(bodySts / divisor) * divisor);

    const ribbingSts = round(Math.max(divisor, Math.floor(bodySts * 0.86 / 2) * 2));
    const ribbingRows = round(ribC * rowsPerCm);
    const bodyRows = round((heightC - ribC) * rowsPerCm);
    const totalRows = ribbingRows + bodyRows;

    // Crown decrease plan: work even decreases every other round until closed.
    const stsPerSegment = bodySts / segments;
    const decreaseRounds = [];
    let remaining = bodySts;
    const decPerRoundPerSeg = stsPerSegment >= 4 ? 1 : 0;
    let guard = 0;
    while (remaining > segments && guard < 40) {
      guard++;
      const decTotal = Math.max(segments, Math.floor(remaining / 5 / segments) * segments || segments);
      remaining -= decTotal;
      decreaseRounds.push({ remaining, decTotal });
      if (decreaseRounds.length > 8) break;
    }

    const circumferenceMm = bodyC * 10;
    const heightMm = heightC * 10;
    const brimWidthMm = ribC * 10;

    const instructions = [
      { step: 1, title: 'Cast on (brim)', text: `Cast on ${ribbingSts} sts, join in the round being careful not to twist. Knit ${ribbingRows} rounds (${ribC} cm) of ${p.ribbingType} ribbing on reduced tension.` },
      { step: 2, title: 'Change to body', text: `Switch to ${p.ribbingType === '2x2' ? '2x2' : '1x1'}-matched needles and increase/decrease to ${bodySts} sts (${(bodySts / stsPerCm).toFixed(0)} cm around). Knit plain until the piece measures ${heightC - ribC} cm above the rib (${bodyRows} rounds).` },
      { step: 3, title: 'Crown decreases', text: `Place ${segments} markers (${stsPerSegment.toFixed(0)} sts apart). Decrease evenly every other round following the plan below until ${segments} sts remain.` },
      ...decreaseRounds.map((d, i) => ({ step: 4 + i, title: `Crown round ${i + 1}`, text: `Decrease ${d.decTotal} sts evenly (${Math.round(d.decTotal / segments)} per segment) → ${d.remaining} sts remain.` })),
      { step: 4 + decreaseRounds.length, title: 'Finish', text: `Break yarn, thread through the last ${segments} sts, cinch tightly and fasten off on the wrong side.${p.pomPom ? ' Add a pom-pom to the top.' : ''} Weave in ends.` }
    ];

    return {
      params: p, gauge: { stitchesPer10Cm: stsPer10, rowsPer10Cm: rowsPer10 },
      bodySts, ribbingSts, ribbingRows, bodyRows, totalRows,
      segments, stsPerSegment, decreaseRounds,
      circumferenceMm, heightMm, brimWidthMm,
      instructions
    };
  }

  /** Draw a labelled beanie schematic onto a canvas 2D context. */
  draw(ctx, canvas, model) {
    const w = canvas.width, h = canvas.height;
    ctx.fillStyle = '#0b0f19';
    ctx.fillRect(0, 0, w, h);
    if (!model) return;

    const padX = Math.min(60, w * 0.12), padY = 40;
    const availW = w - padX * 2, availH = h - padY * 2;
    // Beanie is roughly a rounded dome sitting on a straight band.
    const baseW = Math.min(availW, model.circumferenceMm * (availH / (model.heightMm * 1.6)) * 0 + availW * 0.6);
    const domeW = baseW;
    const cx = w / 2;
    const bandH = clamp((model.brimWidthMm / model.heightMm) * availH, 24, availH * 0.4);
    const domeH = availH * 0.62;
    const bandTop = padY + domeH;
    const bandBottom = bandTop + bandH;

    // Body dome (rounded top).
    ctx.beginPath();
    ctx.moveTo(cx - domeW / 2, bandTop);
    ctx.lineTo(cx - domeW / 2, bandTop - domeH * 0.35);
    ctx.bezierCurveTo(cx - domeW / 2, bandTop - domeH, cx + domeW / 2, bandTop - domeH, cx + domeW / 2, bandTop - domeH * 0.35);
    ctx.lineTo(cx + domeW / 2, bandTop);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, bandTop - domeH, 0, bandTop);
    grad.addColorStop(0, '#1e293b'); grad.addColorStop(1, '#334155');
    ctx.fillStyle = grad; ctx.fill();
    ctx.strokeStyle = '#38bdf8'; ctx.lineWidth = 2; ctx.stroke();

    // Ribbed brim band with vertical rib lines.
    ctx.fillStyle = '#132038';
    ctx.fillRect(cx - domeW / 2, bandTop, domeW, bandH);
    ctx.strokeStyle = '#38bdf8'; ctx.strokeRect(cx - domeW / 2, bandTop, domeW, bandH);
    ctx.strokeStyle = 'rgba(56,189,248,0.35)'; ctx.lineWidth = 1;
    const ribCount = Math.min(40, model.ribbingSts / 2);
    for (let i = 1; i < ribCount; i++) {
      const x = cx - domeW / 2 + (domeW * i / ribCount);
      ctx.beginPath(); ctx.moveTo(x, bandTop + 2); ctx.lineTo(x, bandBottom - 2); ctx.stroke();
    }

    // Pom-pom.
    if (model.params.pomPom) {
      ctx.beginPath(); ctx.arc(cx, bandTop - domeH + 4, Math.min(22, domeW * 0.1), 0, Math.PI * 2);
      ctx.fillStyle = '#fb7185'; ctx.fill();
      ctx.strokeStyle = '#fda4af'; ctx.stroke();
    }

    // Labels.
    ctx.fillStyle = '#e2e8f0'; ctx.font = '12px monospace'; ctx.textAlign = 'center';
    ctx.fillText(`BEANIE · ${model.params.headCircumferenceCm} cm head · ${model.bodySts} sts · ${model.totalRows} rows`, cx, h - 16);
    ctx.fillStyle = '#94a3b8'; ctx.font = '11px monospace'; ctx.textAlign = 'left';
    ctx.fillText(`brim: cast on ${model.ribbingSts} (${model.params.ribbingType})`, padX, padY);
    ctx.fillText(`crown: ${model.segments} segments`, padX, padY + 16);
  }

  /** 1:1 printable SVG of the beanie outline (circumference x height). */
  toSvg(model) {
    if (!model) return '';
    const margin = 15;
    const w = model.circumferenceMm + margin * 2;
    const h = model.heightMm + margin * 2;
    const x0 = margin, yBottom = h - margin, bandTopY = yBottom - model.brimWidthMm;
    const domeTopY = margin;
    const cxr = w / 2;
    const half = model.circumferenceMm / 2;
    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${(w / 10).toFixed(1)}cm" height="${(h / 10).toFixed(1)}cm" viewBox="0 0 ${w} ${h}">
  <style>
    .cut { fill:none; stroke:#e11d48; stroke-width:1.2; }
    .lbl { font-family:monospace; font-size:9px; fill:#0f172a; }
  </style>
  <path class="cut" d="M ${x0} ${bandTopY} L ${x0} ${domeTopY + half * 0.5} Q ${x0} ${domeTopY} ${cxr} ${domeTopY} Q ${x0 + model.circumferenceMm} ${domeTopY} ${x0 + model.circumferenceMm} ${domeTopY + half * 0.5} L ${x0 + model.circumferenceMm} ${bandTopY}" />
  <rect class="cut" x="${x0}" y="${bandTopY}" width="${model.circumferenceMm}" height="${model.brimWidthMm}" />
  <line class="cut" x1="${x0}" y1="${bandTopY}" x2="${x0 + model.circumferenceMm}" y2="${bandTopY}" />
  <text class="lbl" x="${cxr}" y="${h - 4}" text-anchor="middle">BEANIE ${model.params.headCircumferenceCm}cm head · cast on ${model.bodySts} sts · ${model.totalRows} rows · 1:1</text>
</svg>`;
  }
}
