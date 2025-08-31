# qbittorrent-migrator

A script that migrates your complete qBittorrent setup from Windows to Linux in dual-boot systems

### What does it do?

- **Migrates everything**: Torrents, resume data, etc.
- **Converts paths automatically**: Maps Windows paths (`C:\Users\...`) to Linux equivalents (`/mnt/...`)
- **Preserves seeding**: Maintains ratios and progress for private trackers
- **Safe migration**: Shows a dry-run preview and creates backups before making changes

## Why use this tool

When switching from Windows to Linux, manually re-adding hundreds of torrents and losing seeding progress is painful. This tool preserves your entire qBittorrent setup, keeping private tracker ratios intact and avoiding re-downloads.
