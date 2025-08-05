import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';

// 🔧 Hardcoded path to Windows qBittorrent fastresume files
const WINDOWS_QBIT_FASTRESUME_DIR =
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

if (isQBitRunning()) {
    console.error(
        `❌ Qbittorrent is running. Close it before running the migration.`,
    );
    process.exit(1);
}

if (!fs.existsSync(WINDOWS_QBIT_FASTRESUME_DIR)) {
    console.error(`❌ Directory not found: ${WINDOWS_QBIT_FASTRESUME_DIR}`);
    process.exit(1);
}
