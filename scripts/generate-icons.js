const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const sourceImage = path.join(__dirname, '../SpineLineLogo.jpg');
const outputDir = path.join(__dirname, '../assets/icons');

// Ensure output directory exists
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

async function generateIcons() {
  console.log('Generating icons from:', sourceImage);

  // Generate PNG at various sizes
  const sizes = [16, 24, 32, 48, 64, 128, 256, 512];

  for (const size of sizes) {
    await sharp(sourceImage)
      .resize(size, size, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
      .png()
      .toFile(path.join(outputDir, `icon_${size}x${size}.png`));
    console.log(`Generated ${size}x${size} PNG`);
  }

  // Generate main icon.png (256x256)
  await sharp(sourceImage)
    .resize(256, 256, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
    .png()
    .toFile(path.join(outputDir, 'icon.png'));
  console.log('Generated icon.png');

  // For ICO generation, we need to use electron-icon-builder or similar
  // electron-builder can convert PNG to ICO automatically
  console.log('\nIcons generated successfully!');
  console.log('electron-builder will convert icon.png to icon.ico during build');
}

generateIcons().catch(console.error);

