const fs = require('fs');
const path = require('path');

const filesToPatch = [
  path.join(__dirname, '../node_modules/html2canvas/dist/html2canvas.esm.js'),
  path.join(__dirname, '../node_modules/html2canvas/dist/html2canvas.js'),
  path.join(__dirname, '../node_modules/.vite/deps/html2canvas.js'),
];

for (const file of filesToPatch) {
  if (fs.existsSync(file)) {
    let content = fs.readFileSync(file, 'utf8');
    if (content.includes('throw new Error("Attempting to parse an unsupported color function')) {
      content = content.replace(
        /if\s*\(\s*typeof\s+colorFunction\s*===\s*['"]undefined['"]\s*\)\s*\{\s*throw new Error\([^)]+\);\s*\}/g,
        'if (typeof colorFunction === "undefined") { return (typeof COLORS !== "undefined" && COLORS.TRANSPARENT) ? COLORS.TRANSPARENT : 0; }'
      );
      fs.writeFileSync(file, content, 'utf8');
      console.log('Successfully patched unsupported color handler in:', file);
    }
  }
}
