// Generates icon-192.png and icon-512.png for Xypher PWA
// Run: node generate-icons.js

const fs = require('fs');
const path = require('path');

function generateSVG(size) {
  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.38;

  // Hexagon points
  const points = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i - 30);
    points.push(`${cx + r * Math.cos(angle)},${cy + r * Math.sin(angle)}`);
  }
  const hexPath = points.join(' ');

  const fontSize = size * 0.28;
  const strokeWidth = size * 0.035;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${size * 0.18}" fill="#0f0f1e"/>
  <polygon points="${hexPath}" fill="#7c3aed" opacity="0.95"/>
  <polygon points="${hexPath}" fill="none" stroke="#a78bfa" stroke-width="${strokeWidth * 0.5}" opacity="0.6"/>
  <text x="${cx}" y="${cy + fontSize * 0.36}" 
        text-anchor="middle" 
        font-family="Arial, sans-serif" 
        font-size="${fontSize}" 
        font-weight="900" 
        fill="white"
        letter-spacing="-1">X</text>
</svg>`;
}

// Try to use sharp or canvas for PNG conversion
async function generatePNGs() {
  let sharp;
  try {
    sharp = require('sharp');
  } catch {}

  const sizes = [192, 512];

  if (sharp) {
    console.log('Using sharp for PNG generation...');
    for (const size of sizes) {
      const svg = generateSVG(size);
      await sharp(Buffer.from(svg))
        .png()
        .toFile(path.join(__dirname, `icon-${size}.png`));
      console.log(`✅ icon-${size}.png created`);
    }
  } else {
    // Fallback: save SVGs and a note
    console.log('sharp not available — saving SVG files instead.');
    for (const size of sizes) {
      const svg = generateSVG(size);
      fs.writeFileSync(path.join(__dirname, `icon-${size}.svg`), svg, 'utf8');
      console.log(`✅ icon-${size}.svg created (convert to PNG manually)`);
    }
    // Also save combined icon.svg
    fs.writeFileSync(path.join(__dirname, 'icon.svg'), generateSVG(512), 'utf8');
    console.log('\n⚠️  PNG icons not generated. Please convert the SVG files:');
    console.log('   npx sharp-cli icon-192.svg -o icon-192.png');
    console.log('   npx sharp-cli icon-512.svg -o icon-512.png');
    console.log('   OR use https://svgtopng.com/');
  }
}

generatePNGs().catch(console.error);
