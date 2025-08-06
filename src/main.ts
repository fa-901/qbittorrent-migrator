import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import bencode from 'bencode';

// 🔧 Hardcoded path to Windows qBittorrent fastresume files
const WINDOWS_QBIT_DIR =
    '/media/farhan/SSD-OS-10/Users/metal/AppData/Local/qBittorrent/BT_backup';
// 🔧 Hardcoded base path where Linux files should be copied to
const LINUX_DOWNLOADS_DIR = path.join(
    os.homedir(),
    'Downloads/migrated-torrents',
);

// check if qbittorrent is running
const isQBitRunning = (): boolean => {
    try {
        execSync('pgrep -x qbittorrent', { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
};

// if (isQBitRunning()) {
//     console.error(
//         `❌ Qbittorrent is running. Close it before running the migration.`,
//     );
//     process.exit(1);
// }

if (!fs.existsSync(WINDOWS_QBIT_DIR)) {
    console.error(`❌ Directory not found: ${WINDOWS_QBIT_DIR}`);
    process.exit(1);
}

const files = await fs.promises.readdir(WINDOWS_QBIT_DIR);
const fastResumeFiles = files.filter((f) => f.endsWith('.fastresume'));

if (files.length < 1) {
    console.log('No torrents found.');
    process.exit(1);
}

console.log(`📄 Found ${fastResumeFiles.length} torrents to migrate.`);

// read the file content
fastResumeFiles.forEach(async (file) => {
    const filePath = path.join(WINDOWS_QBIT_DIR, file);
    const fileContent = await fs.promises.readFile(filePath);
    try {
        const decoded = bencode.decode(fileContent, 'utf-8');
        console.log(`✔ File: ${file} \n  - Save Path: ${decoded.save_path}\n`);
    } catch (error) {
        console.error('❌ Error decoding fastresume file:', error);
    }
});
