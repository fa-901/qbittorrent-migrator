# qbittorrent-migrator

A script that migrates your complete qBittorrent setup from Windows to Linux in dual-boot systems

### What does it do?

- **Migrates everything**: Torrents, resume data, etc.
- **Converts paths automatically**: Maps Windows paths (`C:\Users\...`) to Linux equivalents (`/mnt/...`)
- **Preserves seeding**: Maintains ratios and progress for private trackers
- **Safe migration**: Shows a dry-run preview and creates backups before making changes

## Why use this tool

When switching from Windows to Linux, manually re-adding hundreds of torrents and losing seeding progress is painful. This tool preserves your entire qBittorrent setup, keeping private tracker ratios intact and avoiding re-downloads.

## How to Run

### **Prerequisites**
- Node.js installed on your Linux system (preferably using the version mentioned in [.node-version](.node-version), you can use tools like [fnm](https://github.com/Schniz/fnm))
- Access to your Windows qBittorrent directory
- qBittorrent installed and configured on Linux (run it at least once)
- qBittorrent must be closed during migration

1. Install dependencies `npm install`
2. Run the program with `npm start`
    - You will be prompted to enter the path to your Windows qBittorrent directory
    - Review the proposed changes
    - Confirm with 'y' or 'yes'