import fs from 'fs';
import path from 'path';
import os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import readline from 'readline';
import bencode from 'bencode';
import { glob } from 'glob';
const execAsync = promisify(exec);

const GLOB_TIMEOUT_MS = 150000;

let WINDOWS_QBIT_DIR: string;

interface TorrentFile {
    length: number;
    path: string[];
}

interface TorrentData {
    info: {
        name: string;
        files?: TorrentFile[];
        length?: number;
        'piece length': number;
        pieces: Buffer;
    };
}

interface FileMatch {
    expectedPath: string;
    actualPath: string;
    exists: boolean;
    expectedSize: number;
    actualSize: number;
    sizeMatch: boolean;
}

interface PathMatchResult {
    basePath: string;
    confidence: number;
    matches: FileMatch[];
    totalFiles: number;
    existingFiles: number;
    debug: string[];
}

/**
 * Finds the correct file path for a torrent by validating file structure
 */
function findCorrectTorrentPath(
    torrentData: TorrentData,
    filePaths: string[],
): Promise<PathMatchResult | null> {
    const debug: string[] = [];
    debug.push(`Starting analysis with ${filePaths.length} possible paths`);

    const torrentName = torrentData.info.name;
    const isSingleFile = !torrentData.info.files;

    debug.push(`Torrent name: "${torrentName}"`);
    debug.push(`Is single file: ${isSingleFile}`);

    // Get expected files structure from torrent
    const expectedFiles = getExpectedFiles(torrentData);
    debug.push(`Expected files count: ${expectedFiles.length}`);
    expectedFiles.slice(0, 3).forEach((file, i) => {
        debug.push(`Expected file ${i}: ${file.path} (${file.size} bytes)`);
    });

    const candidates: PathMatchResult[] = [];

    // Test each possible base path
    for (let i = 0; i < filePaths.length; i++) {
        const basePath = filePaths[i];
        debug.push(`\n--- Testing path ${i + 1}: "${basePath}" ---`);

        if (!fs.existsSync(basePath)) {
            debug.push(`Path does not exist, skipping`);
            continue;
        }

        const stat = fs.statSync(basePath);
        debug.push(
            `Path exists, is directory: ${stat.isDirectory()}, is file: ${stat.isFile()}`,
        );

        // For single-file torrents
        if (isSingleFile) {
            debug.push(`Checking as single-file torrent`);

            // Check if basePath is the file directly
            if (stat.isFile()) {
                const result = validateSingleFile(
                    basePath,
                    expectedFiles[0],
                    debug,
                );
                if (result) {
                    candidates.push({
                        basePath: basePath,
                        confidence: result.confidence,
                        matches: [result.match],
                        totalFiles: 1,
                        existingFiles: result.match.exists ? 1 : 0,
                        debug: [...debug],
                    });
                }
            }

            // Check if basePath contains the file
            if (stat.isDirectory()) {
                const filePath = path.join(basePath, torrentName);
                debug.push(`Checking for file at: "${filePath}"`);
                if (fs.existsSync(filePath)) {
                    const result = validateSingleFile(
                        filePath,
                        expectedFiles[0],
                        debug,
                    );
                    if (result) {
                        candidates.push({
                            basePath: basePath,
                            confidence: result.confidence,
                            matches: [result.match],
                            totalFiles: 1,
                            existingFiles: result.match.exists ? 1 : 0,
                            debug: [...debug],
                        });
                    }
                } else {
                    debug.push(`File not found at expected location`);
                }
            }
            continue;
        }

        // For multi-file torrents, basePath should be a directory
        if (!stat.isDirectory()) {
            debug.push(`Not a directory, skipping for multi-file torrent`);
            continue;
        }

        // Test different possible structures:
        // 1. basePath/torrentName/ (torrent name as root folder)
        // 2. basePath/ (files directly in basePath)
        const pathsToTest = [
            {
                testPath: path.join(basePath, torrentName),
                description: 'with torrent name folder',
            },
            { testPath: basePath, description: 'direct in base path' },
        ];

        for (const { testPath, description } of pathsToTest) {
            debug.push(
                `Testing multi-file structure: ${description} at "${testPath}"`,
            );
            const result = validateMultiFileStructure(
                testPath,
                expectedFiles,
                debug,
            );
            if (result && result.confidence > 0) {
                debug.push(
                    `Found candidate with confidence: ${result.confidence}`,
                );
                candidates.push({
                    ...result,
                    basePath: basePath,
                    debug: [...debug],
                });
            }
        }
    }

    debug.push(`\nFound ${candidates.length} candidates`);
    candidates.forEach((candidate, i) => {
        debug.push(
            `Candidate ${i + 1}: ${candidate.basePath} (confidence: ${candidate.confidence})`,
        );
    });

    const best = candidates.reduce((best, current) =>
        current.confidence > best.confidence ? current : best,
    );

    debug.push(
        `\nSelected best match: ${best.basePath} with confidence ${best.confidence}`,
    );

    return Promise.resolve(best);
}

function getExpectedFiles(
    torrentData: TorrentData,
): Array<{ path: string; size: number }> {
    const files: Array<{ path: string; size: number }> = [];

    if (torrentData.info.files) {
        // Multi-file torrent
        for (const file of torrentData.info.files) {
            files.push({
                path: file.path.join('/'),
                size: file.length,
            });
        }
    } else {
        // Single-file torrent
        files.push({
            path: torrentData.info.name,
            size: torrentData.info.length || 0,
        });
    }

    return files;
}

function validateSingleFile(
    filePath: string,
    expectedFile: { path: string; size: number },
    debug: string[],
): { confidence: number; match: FileMatch } | null {
    try {
        debug.push(`Validating single file: "${filePath}"`);
        const stat = fs.statSync(filePath);
        const actualSize = stat.size;
        const expectedSize = expectedFile.size;

        debug.push(
            `File exists - Expected size: ${expectedSize}, Actual size: ${actualSize}`,
        );

        const match: FileMatch = {
            expectedPath: expectedFile.path,
            actualPath: filePath,
            exists: true,
            expectedSize,
            actualSize,
            sizeMatch: actualSize === expectedSize,
        };

        // Calculate confidence
        let confidence = 0.7; // Base confidence for existing file

        if (match.sizeMatch) {
            confidence = 1.0; // Perfect match
            debug.push(`Perfect size match - confidence: ${confidence}`);
        } else if (actualSize < expectedSize && actualSize > 0) {
            // Incomplete file - still likely correct
            const completionRatio = actualSize / expectedSize;
            confidence = 0.5 + completionRatio * 0.3; // 0.5-0.8 range
            debug.push(
                `Incomplete file (${(completionRatio * 100).toFixed(1)}% complete) - confidence: ${confidence}`,
            );
        } else {
            confidence = 0.2; // File exists but size is wrong
            debug.push(`Size mismatch - confidence: ${confidence}`);
        }

        return { confidence, match };
    } catch (error) {
        debug.push(`Error validating single file: ${error}`);
        return null;
    }
}

function validateMultiFileStructure(
    basePath: string,
    expectedFiles: Array<{ path: string; size: number }>,
    debug: string[],
): PathMatchResult | null {
    debug.push(`Validating multi-file structure at: "${basePath}"`);

    if (!fs.existsSync(basePath)) {
        debug.push(`Base path does not exist`);
        return null;
    }

    if (!fs.statSync(basePath).isDirectory()) {
        debug.push(`Base path is not a directory`);
        return null;
    }

    const matches: FileMatch[] = [];
    let existingFiles = 0;
    let perfectMatches = 0;

    // Check first few files to avoid too much logging
    const filesToCheck = Math.min(expectedFiles.length, 10);
    debug.push(
        `Checking first ${filesToCheck} files out of ${expectedFiles.length} total`,
    );

    for (let i = 0; i < expectedFiles.length; i++) {
        const expectedFile = expectedFiles[i];
        const fullPath = path.join(basePath, expectedFile.path);

        if (i < 5) {
            // Only log first 5 files to avoid spam
            debug.push(
                `Checking file: "${expectedFile.path}" at "${fullPath}"`,
            );
        }

        try {
            const stat = fs.statSync(fullPath);
            const actualSize = stat.size;
            const sizeMatch = actualSize === expectedFile.size;

            matches.push({
                expectedPath: expectedFile.path,
                actualPath: fullPath,
                exists: true,
                expectedSize: expectedFile.size,
                actualSize,
                sizeMatch,
            });

            existingFiles++;
            if (sizeMatch) perfectMatches++;

            if (i < 5) {
                debug.push(
                    `File exists - Expected: ${expectedFile.size}, Actual: ${actualSize}, Match: ${sizeMatch}`,
                );
            }
        } catch {
            matches.push({
                expectedPath: expectedFile.path,
                actualPath: fullPath,
                exists: false,
                expectedSize: expectedFile.size,
                actualSize: 0,
                sizeMatch: false,
            });

            if (i < 5) {
                debug.push(`File does not exist`);
            }
        }
    }

    debug.push(
        `Results: ${existingFiles}/${expectedFiles.length} files exist, ${perfectMatches} perfect matches`,
    );

    // Calculate confidence score
    const totalFiles = expectedFiles.length;
    const existenceRatio = existingFiles / totalFiles;
    const perfectMatchRatio =
        existingFiles > 0 ? perfectMatches / existingFiles : 0;

    // More lenient confidence calculation
    let confidence = 0;

    if (existingFiles > 0) {
        confidence = existenceRatio * 0.7 + perfectMatchRatio * 0.3;

        // Bonus for having most files
        if (existenceRatio > 0.8) {
            confidence += 0.1;
        }

        // Even if files don't match perfectly, if most exist, give reasonable confidence
        if (existenceRatio > 0.5) {
            confidence = Math.max(confidence, 0.6);
        }
    }

    debug.push(
        `Calculated confidence: ${confidence} (existence: ${existenceRatio}, perfect: ${perfectMatchRatio})`,
    );

    return {
        basePath,
        confidence,
        matches,
        totalFiles,
        existingFiles,
        debug: [],
    };
}

const sanitizePath = (str: string): string => {
    return str.replace(/:/g, '').replace(/\\/g, '-');
};

// Prompt user for input with a default value
const promptUserInput = async (
    question: string,
    defaultValue?: string,
): Promise<string> => {
    return new Promise((resolve) => {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
        });

        const promptText = defaultValue
            ? `${question} (${defaultValue}): `
            : `${question}: `;

        rl.question(promptText, (answer) => {
            rl.close();
            resolve(answer || defaultValue || '');
        });
    });
};

// check if qbittorrent is running
const isQBitRunning = async (): Promise<boolean> => {
    try {
        const { stdout } = await execAsync('pidof qbittorrent-nox qbittorrent');
        return stdout.trim().length > 0;
    } catch {
        return false;
    }
};

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

while (!WINDOWS_QBIT_DIR) {
    WINDOWS_QBIT_DIR = await promptUserInput(
        'Enter the path to your qBittorrent Windows directory',
    );
}

const LINUX_QBIT_DIR = await findBTBackup();
if (!LINUX_QBIT_DIR) {
    console.error(
        '❌ No BT_backup directory found. Please ensure qBittorrent is installed and has been run at least once.',
    );
    process.exit(1);
}
console.log(`\nFound Linux BT_backup: ${LINUX_QBIT_DIR}\n\n`);

if (await isQBitRunning()) {
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
const torrentFiles = files.filter((f) => f.endsWith('.torrent'));

if (files.length < 1) {
    console.log('🤷 No torrents found.');
    process.exit(1);
}

type Path = {
    normalizedPath: string;
    linuxPath?: string;
    torrent?: any;
    windowsPath?: string;
};
const pathMap: { [key: string]: Path } = {};

// get all unique paths
await Promise.all(
    fastResumeFiles.map(async (file) => {
        const filePath = path.join(WINDOWS_QBIT_DIR, file);
        const fileContent = await fs.promises.readFile(filePath);
        const torrentContent = await fs.promises.readFile(
            filePath.replace(/\.fastresume$/, '.torrent'),
        );
        try {
            const decodedFastResume = bencode.decode(fileContent, 'utf-8');
            const decodedTorrent = bencode.decode(torrentContent, 'utf-8');
            // normalize Windows path
            const savePath = decodedFastResume.save_path
                .replace(/^[A-Z]:\\/i, '')
                .replace(/\\+$/, '')
                .replace(/\\/g, '/');
            const key = sanitizePath(decodedFastResume.save_path);
            pathMap[key] = {
                normalizedPath: savePath,
                torrent: decodedTorrent,
                windowsPath: decodedFastResume.save_path,
            };
        } catch (error) {
            console.error('❌ Error decoding fastresume file:', error);
        }
    }),
);

// Map Windows paths to Linux paths
await Promise.all(
    Object.keys(pathMap).map(async (savePath) => {
        const linuxPaths = await findPaths(pathMap[savePath].normalizedPath);
        if (!linuxPaths.length) {
            process.exit(1);
        } else if (linuxPaths.length > 1) {
            const exactPath = await findCorrectTorrentPath(
                pathMap[savePath].torrent,
                linuxPaths,
            );
            pathMap[savePath].linuxPath = exactPath.basePath;
        } else {
            pathMap[savePath].linuxPath = linuxPaths[0];
        }
    }),
);
for(const key in pathMap) {
    console.log(`Windows path: ${pathMap[key].windowsPath}`);
    console.log(`Updated Linux path: ${pathMap[key].linuxPath}\n--------------\n`);
}

console.log(`📄 ${fastResumeFiles.length} torrents torrents will be migrated.`);

const confirm = await promptUserInput('Begin migration? (y/n)');
if (!['y', 'yes'].includes(confirm.trim().toLowerCase())) {
    console.error('❗ Migration cancelled.');
    process.exit(0);
}

//copy .torrent and .fastresume files
await Promise.all(
    torrentFiles.map(async (file) => {
        const sourcePath = path.join(WINDOWS_QBIT_DIR, file);
        const destinationPath = path.join(LINUX_QBIT_DIR, file);
        const fastResumeFile = file.replace(/\.torrent$/, '.fastresume');
        const fastResumeSource = path.join(WINDOWS_QBIT_DIR, fastResumeFile);
        const fastResumeDestination = path.join(LINUX_QBIT_DIR, fastResumeFile);
        try {
            await fs.promises.copyFile(sourcePath, destinationPath);
            await fs.promises.copyFile(fastResumeSource, fastResumeDestination);
        } catch (error) {
            console.error('❌ Error copying torrent file:', error);
        }
    }),
);

//modify fastresume file and move
await Promise.all(
    fastResumeFiles.map(async (file) => {
        const filePath = path.join(WINDOWS_QBIT_DIR, file);
        const fileContent = await fs.promises.readFile(filePath);

        const decoded = bencode.decode(fileContent, 'utf-8');
        const key = sanitizePath(decoded.save_path);

        const content = await fs.promises.readFile(filePath, 'binary');
        const updatedContent = content.replaceAll(
            `${pathMap[key].windowsPath.length}:${pathMap[key].windowsPath}`,
            `${pathMap[key].linuxPath.length}:${pathMap[key].linuxPath}`,
        );
        try {
            const destinationPath = path.join(LINUX_QBIT_DIR, file);
            console.log(`📄 Writing fastresume file to: ${destinationPath}`);
            // Due to issues encountered with bencode encoding, the fastresume file is modified directly
            await fs.promises.writeFile(
                destinationPath,
                updatedContent,
                'binary',
            );
        } catch (error) {
            console.error('❌ Error writing fastresume file:', error);
        }
    }),
);
