const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const platform = process.platform;
let exeName;

if (platform === 'win32') {
    exeName = 'server-windows.exe';
} else if (platform === 'darwin') {
    exeName = 'server-macos';
} else if (platform === 'linux') {
    exeName = 'server-linux';
} else {
    console.error(`Unsupported platform: ${platform}`);
    process.exit(1);
}

const binDir = path.join(__dirname, 'bin');
const outDir = path.join(__dirname, 'out');
const destDir = path.join(outDir, 'bin');

console.log(`Copying ${exeName} to ${destDir}...`);

try {
    if (!fs.existsSync(binDir)) {
        console.log(`Building server executable...`);
        execSync('python3 build_server.py', { stdio: 'inherit' });
    }

    if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
    }

    const srcFile = path.join(binDir, exeName);
    const destFile = path.join(destDir, exeName);

    if (fs.existsSync(srcFile)) {
        fs.copyFileSync(srcFile, destFile);
        console.log(`Successfully copied ${exeName}`);
    } else {
        console.error(`Error: ${exeName} not found in ${binDir}`);
        process.exit(1);
    }
} catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
}
