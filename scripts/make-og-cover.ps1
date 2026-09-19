#Requires -Version 7.0
<#
  KNITCAT — social share cover generator.

  Renders ./og-cover.png (1200x630, the 1.91:1 ratio Open Graph and Twitter
  cards want) using GDI+, so the artwork is a *reproducible* text file instead
  of an opaque binary someone once pasted in. Colours and font stacks are taken
  straight from the :root design tokens in css/styles.css, which is why the card
  looks like the app.

  Usage:  pwsh -NoProfile -File scripts/make-og-cover.ps1
#>
param(
  [string]$Out = (Join-Path $PSScriptRoot '..\og-cover.png'),
  [int]$Width = 1200,
  [int]$Height = 630
)

Add-Type -AssemblyName System.Drawing

# ── palette (mirrors css/styles.css :root) ───────────────────────────────────
$bgTop = [System.Drawing.Color]::FromArgb(255, 7, 10, 18)      # --bg-main
$bgBottom = [System.Drawing.Color]::FromArgb(255, 19, 29, 51)  # --bg-panel
$cyan = [System.Drawing.Color]::FromArgb(255, 56, 189, 248)    # --accent-cyan
$rose = [System.Drawing.Color]::FromArgb(255, 244, 63, 94)     # --accent-rose
$textHi = [System.Drawing.Color]::FromArgb(255, 248, 250, 252) # --text-primary
$textMid = [System.Drawing.Color]::FromArgb(255, 148, 163, 184) # --text-secondary
$textLow = [System.Drawing.Color]::FromArgb(255, 100, 116, 139) # --text-muted
$card = [System.Drawing.Color]::FromArgb(255, 247, 242, 228)   # profile cardColor
$cardDim = [System.Drawing.Color]::FromArgb(255, 224, 214, 186)
$ink = [System.Drawing.Color]::FromArgb(255, 29, 42, 68)       # profile inkColor

$Out = [IO.Path]::GetFullPath($Out)
$bmp = New-Object System.Drawing.Bitmap $Width, $Height
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

function Round-Rect([Single]$x, [Single]$y, [Single]$w, [Single]$h, [Single]$r) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $r * 2
  $p.AddArc($x, $y, $d, $d, 180, 90)
  $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
  $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $p.CloseFigure()
  return $p
}

# ── background: gradient + faint CAD needle grid ─────────────────────────────
$rect = [System.Drawing.Rectangle]::new(0, 0, $Width, $Height)
$grad = [System.Drawing.Drawing2D.LinearGradientBrush]::new($rect, $bgTop, $bgBottom, 65)
$g.FillRectangle($grad, 0, 0, $Width, $Height)
$grad.Dispose()

$gridPen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(12, 56, 189, 248)), 1
for ($x = 0; $x -le $Width; $x += 40) { $g.DrawLine($gridPen, $x, 0, $x, $Height) }
for ($y = 0; $y -le $Height; $y += 40) { $g.DrawLine($gridPen, 0, $y, $Width, $y) }
$gridPen.Dispose()

# ── the punchcard: a real diamond-lace repeat on a 24-stitch card ────────────
$cx = 832; $cy = 74; $cw = 320; $ch = 482
$cardPath = Round-Rect $cx $cy $cw $ch 18
$cardBrush = New-Object System.Drawing.SolidBrush $card
$g.FillPath($cardBrush, $cardPath)
$g.DrawPath((New-Object System.Drawing.Pen $ink, 2), $cardPath)
$cardPath.Dispose(); $cardBrush.Dispose()

$cols = 10; $rows = 15
$cellW = 28.0; $cellH = 27.0
$originX = $cx + ($cw - ($cols - 1) * $cellW) / 2
$originY = $cy + 42
$ringPen = New-Object System.Drawing.Pen $cardDim, 2
$holeBrush = New-Object System.Drawing.SolidBrush $ink

for ($r = 0; $r -lt $rows; $r++) {
  for ($c = 0; $c -lt $cols; $c++) {
    $hx = $originX + $c * $cellW
    $hy = $originY + $r * $cellH
    # Diamond lattice = the classic eyelet + two-direction-transfer motif.
    $lace = ((($c + $r) % 6) -eq 0) -or ((($c - $r + 60) % 6) -eq 0)
    if ($lace) {
      $g.FillEllipse($holeBrush, $hx - 7, $hy - 7, 14, 14)
    }
    else {
      $g.DrawEllipse($ringPen, $hx - 6, $hy - 6, 12, 12)
    }
  }
}
$ringPen.Dispose(); $holeBrush.Dispose()

# Sprocket holes down both margins, like a genuine strip of card stock.
$sprocket = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(200, 29, 42, 68))
for ($r = -1; $r -le $rows; $r++) {
  $sy = $originY + $r * $cellH
  $g.FillEllipse($sprocket, $cx + 12, $sy - 4, 8, 8)
  $g.FillEllipse($sprocket, $cx + $cw - 20, $sy - 4, 8, 8)
}
$sprocket.Dispose()

# ── typography ───────────────────────────────────────────────────────────────
$ui = New-Object System.Drawing.FontFamily 'Segoe UI'
$mono = New-Object System.Drawing.FontFamily 'Consolas'
$left = 72
$flagY = 74
$accentPen = New-Object System.Drawing.Pen $cyan, 6
$g.DrawLine($accentPen, $left, $flagY, $left + 136, $flagY)
$accentPen.Dispose()

$eyebrowFont = New-Object System.Drawing.Font $mono, 17, ([System.Drawing.FontStyle]::Regular)
$eyebrowBrush = New-Object System.Drawing.SolidBrush $cyan
$g.DrawString('FREE BROWSER KNITWEAR STUDIO', $eyebrowFont, $eyebrowBrush, $left, ($flagY + 18))
$eyebrowBrush.Dispose(); $eyebrowFont.Dispose()

$brandFont = New-Object System.Drawing.Font $ui, 88, ([System.Drawing.FontStyle]::Bold)
$brandBrush = New-Object System.Drawing.SolidBrush $textHi
$brandY = 104
$g.DrawString('KNITCAT', $brandFont, $brandBrush, ($left - 6), $brandY)
$brandW = $g.MeasureString('KNITCAT', $brandFont).Width
$brandBrush.Dispose(); $brandFont.Dispose()

# The romance heart: this tool was built for one specific knitter.
$heartBrush = New-Object System.Drawing.SolidBrush $rose
$s = 19.0
$hxp = $left - 6 + $brandW + 12
$hyp = $brandY + 38
$path = New-Object System.Drawing.Drawing2D.GraphicsPath
$path.AddBezier($hxp, $hyp, $hxp - $s, $hyp - $s * 1.15, $hxp - $s * 2.1, $hyp + $s * 0.35, $hxp, $hyp + $s * 1.9)
$path.AddBezier($hxp, $hyp, $hxp + $s, $hyp - $s * 1.15, $hxp + $s * 2.1, $hyp + $s * 0.35, $hxp, $hyp + $s * 1.9)
$g.FillPath($heartBrush, $path)
$path.Dispose(); $heartBrush.Dispose()

$subFont = New-Object System.Drawing.Font $ui, 36, ([System.Drawing.FontStyle]::Bold)
$subBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 226, 232, 240))
$g.DrawString('Knitting Machine CAD/CAM', $subFont, $subBrush, $left, 234)
$subBrush.Dispose(); $subFont.Dispose()

$lineFont = New-Object System.Drawing.Font $ui, 30, ([System.Drawing.FontStyle]::Regular)
$lineBrush = New-Object System.Drawing.SolidBrush $cyan
$g.DrawString('& Lace Decompiler', $lineFont, $lineBrush, $left, 282)
$lineBrush.Dispose(); $lineFont.Dispose()

$bulletFont = New-Object System.Drawing.Font $mono, 19, ([System.Drawing.FontStyle]::Regular)
$bulletBrush = New-Object System.Drawing.SolidBrush $textMid
$g.DrawString('punchcard compiler  ·  Brother KH-830 passes', $bulletFont, $bulletBrush, $left, 356)
$g.DrawString('eyelets + yarn transfers  ·  DXF / G-code', $bulletFont, $bulletBrush, $left, 386)
$bulletBrush.Dispose(); $bulletFont.Dispose()

$urlFont = New-Object System.Drawing.Font $mono, 18, ([System.Drawing.FontStyle]::Regular)
$urlBrush = New-Object System.Drawing.SolidBrush $textLow
$g.DrawString('lloyd-a-alex.github.io/benji-machine', $urlFont, $urlBrush, $left, ($Height - 52))
$urlBrush.Dispose(); $urlFont.Dispose()
$ui.Dispose(); $mono.Dispose()

# ── write + report ───────────────────────────────────────────────────────────
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
$info = Get-Item $Out
"og-cover.png -> $($info.Length) bytes, ${Width}x${Height}, at $Out"
