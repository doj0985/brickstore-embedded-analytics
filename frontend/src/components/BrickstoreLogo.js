import React, { useEffect, useState } from 'react';
import { Box } from '@mui/material';
import { useColorScheme } from '@mui/material/styles';
import brickstoreLogo from '../img/BrickstoreLogo.png';

// The logo is a colored brick icon + a black "brickstore" wordmark. On a dark
// background the black wordmark disappears. A CSS filter can't recolor just the
// text without also shifting the icon's color, so instead we recolor the image
// pixel-by-pixel on a canvas: only near-black / low-saturation pixels (the
// wordmark and its antialiased edges) become white; the blue/cyan brick keeps
// its exact original color. Result is cached so we process the image only once.
let whiteTextLogoPromise = null;

function buildWhiteTextLogo() {
  if (whiteTextLogoPromise) return whiteTextLogoPromise;
  whiteTextLogoPromise = new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous'; // same-origin bundled asset → canvas not tainted
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const px = imageData.data;
        for (let i = 0; i < px.length; i += 4) {
          const r = px[i], g = px[i + 1], b = px[i + 2], a = px[i + 3];
          if (a === 0) continue; // fully transparent — skip
          const max = Math.max(r, g, b);
          const min = Math.min(r, g, b);
          // Dark AND near-grayscale ⇒ part of the black wordmark (the blue/cyan
          // icon is bright and/or strongly saturated, so it fails this test and
          // is left untouched). Recolor to white, preserving alpha for smooth
          // antialiased edges.
          if (max < 140 && max - min < 55) {
            px[i] = 255;
            px[i + 1] = 255;
            px[i + 2] = 255;
          }
        }
        ctx.putImageData(imageData, 0, 0);
        resolve(canvas.toDataURL('image/png'));
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = reject;
    img.src = brickstoreLogo;
  });
  return whiteTextLogoPromise;
}

export default function BrickstoreLogo({ sx, ...props }) {
  const { mode, systemMode } = useColorScheme();
  const isDark = (systemMode || mode) === 'dark';
  const [whiteSrc, setWhiteSrc] = useState(null);

  useEffect(() => {
    let active = true;
    buildWhiteTextLogo()
      .then((url) => { if (active) setWhiteSrc(url); })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  const src = isDark && whiteSrc ? whiteSrc : brickstoreLogo;
  return <Box component="img" src={src} sx={sx} {...props} />;
}
