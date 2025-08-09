import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync, exec } from 'child_process';
import { promisify } from 'util';
import bencode from 'bencode';
import { glob } from 'glob';

const execAsync = promisify(exec);

const GLOB_TIMEOUT_MS = 120000;

// 🔧 Hardcoded path to Windows qBittorrent fastresume files
const WINDOWS_QBIT_DIR =
    '/media/farhan/SSD-OS-10/Users/metal/AppData/Local/qBittorrent/BT_backup';
// 🔧 Hardcoded base path where Linux files should be copied to
const LINUX_DOWNLOADS_DIR = path.join(
    os.homedir(),
    'Downloads/migrated-torrents',
);

const QBIT_FLATPAK_DIR = path.join(
    os.homedir(),
    '.var/app/org.qbittorrent.qBittorrent/data/qBittorrent/BT_backup',
);

// find the BT_Backup directory in current Linux distro
const findBTBackup = async (): Promise<string | null> => {
    const homeDir = os.homedir();

    try {
        const { stdout } = await execAsync(
            `find "${homeDir}" -name "BT_backup" -type d 2>/dev/null`,
        );
        const results = stdout.trim();

        if (!results) {
            return null;
        }

        const btBackupPaths = results.split('\n').filter(Boolean);

        for (const btBackupPath of btBackupPaths) {
            try {
                const stat = await fs.promises.stat(btBackupPath);
                if (!stat.isDirectory()) continue;

                // Check if parent directory contains qBittorrent.conf
                const parentDir = path.dirname(btBackupPath);
                const configFile = path.join(parentDir, 'qBittorrent.conf');

                try {
                    await fs.promises.access(configFile);
                    return btBackupPath;
                } catch {
                    // As a fallback, check if BT_backup contains .torrent or .fastresume files
                    try {
                        const files = await fs.promises.readdir(btBackupPath);
                        const hasQBTFiles = files.some(
                            (file) =>
                                file.endsWith('.torrent') ||
                                file.endsWith('.fastresume') ||
                                file.endsWith('.resume'),
                        );

                        if (hasQBTFiles) {
                            return btBackupPath;
                        }
                    } catch {
                        continue;
                    }
                }
            } catch {
                continue;
            }
        }

        return null;
    } catch {
        return null;
    }
};

// Function to search for a single path
const findPaths = async (path: string): Promise<string[]> => {
    const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
            reject(
                new Error(
                    `Glob search timed out after ${GLOB_TIMEOUT_MS / 1000}s`,
                ),
            );
        }, GLOB_TIMEOUT_MS);
    });

    // TODO: in case of duplicate paths, get the correct one by matching file contents
    const globPromise = glob(`/**/${path}`, {
        ignore: [
            '**/proc/**',
            '**/sys/**',
            '**/dev/**',
            '**/run/**',
            '**/var/lib/**',
            '**/snap/**',

            // Temporary and cache
            '**/tmp/**',
            '**/var/tmp/**',
            '**/var/cache/**',
            '**/var/log/**',
            '**/.cache/**',

            // Development
            '**/node_modules/**',
            '**/.git/**',
            '**/build/**',
            '**/dist/**',
            '**/__pycache__/**',
            '**/venv/**',
            '**/vendor/**',

            // Recovery/system
            '**/lost+found/**',
            '**/var/crash/**',
        ],
        follow: false,
        includeChildMatches: false,
        nocase: false,
        platform: 'linux',
    });
    try {
        return await Promise.race([globPromise, timeoutPromise]);
    } catch (error) {
        console.error(error);
        return [];
    }
};

const LINUX_QBIT_DIR = await findBTBackup();
if (!LINUX_QBIT_DIR) {
    console.error(
        '❌ No BT_backup directory found. Please ensure qBittorrent is installed and has been run at least once.',
    );
    process.exit(1);
}
console.log('Linux BT_backup path:', LINUX_QBIT_DIR);

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

if (!fs.existsSync(WINDOWS_QBIT_DIR)) {
    console.error(`❌ Directory not found: ${WINDOWS_QBIT_DIR}`);
    process.exit(1);
}

const files = await fs.promises.readdir(WINDOWS_QBIT_DIR);
const fastResumeFiles = files.filter((f) => f.endsWith('.fastresume'));

if (files.length < 1) {
    console.log('🤷 No torrents found.');
    process.exit(1);
}

console.log(`📄 Found ${fastResumeFiles.length} torrents to migrate.`);

const savePaths = new Set<string>();

const pathMap: { [key: string]: string } = {};

// get all unique paths
await Promise.all(
    fastResumeFiles.map(async (file, i) => {
        const filePath = path.join(WINDOWS_QBIT_DIR, file);
        const fileContent = await fs.promises.readFile(filePath);
        try {
            const decoded = bencode.decode(fileContent, 'utf-8');
            // strip Windows drive letter and trailing slashes
            const savePath = decoded.save_path
                .replace(/^[A-Z]:\\/i, '')
                .replace(/\\+$/, '');
            pathMap[savePath] = '';
            savePaths.add(savePath);
        } catch (error) {
            console.error('❌ Error decoding fastresume file:', error);
        }
    }),
);

// Map Windows paths to Linux paths
await Promise.all(
    Object.keys(pathMap).map(async (savePath) => {
        const linuxPaths = await findPaths(savePath);
        if (!linuxPaths.length) {
            process.exit(1);
        }
        pathMap[savePath] = linuxPaths[0] || '';
    }),
);
console.log(`📂 Save paths extracted`, pathMap);
