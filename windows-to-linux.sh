#!/bin/bash

# qBittorrent Windows to Linux Migration Script
# This script migrates qBittorrent configuration and torrents from Windows to Linux (Pop OS)

set -e  # Exit on any error

# Configuration variables - MODIFY THESE AS NEEDED
WINDOWS_QB_PATH="/mnt/c/Users/$USER/AppData/Roaming/qBittorrent"  # Adjust this path
LINUX_QB_PATH="$HOME/.config/qBittorrent"
LINUX_DATA_PREFIX="$HOME/Downloads"  # Default Linux download location

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Function to check if qBittorrent is running
check_qbittorrent_running() {
    if pgrep -x "qbittorrent" > /dev/null; then
        print_error "qBittorrent is currently running. Please close it before running this script."
        exit 1
    fi
}

# Function to backup existing Linux qBittorrent config
backup_existing_config() {
    if [ -d "$LINUX_QB_PATH" ]; then
        local backup_path="${LINUX_QB_PATH}_backup_$(date +%Y%m%d_%H%M%S)"
        print_warning "Existing qBittorrent config found. Creating backup at: $backup_path"
        cp -r "$LINUX_QB_PATH" "$backup_path"
        print_success "Backup created successfully"
    fi
}

# Function to convert Windows path to Linux path
convert_path() {
    local windows_path="$1"
    # Convert backslashes to forward slashes
    local converted_path=$(echo "$windows_path" | sed 's|\\|/|g')
    
    # Handle different drive letters (C:, D:, etc.)
    if [[ $converted_path =~ ^[A-Za-z]: ]]; then
        local drive_letter=$(echo "$converted_path" | cut -c1 | tr '[:upper:]' '[:lower:]')
        converted_path=$(echo "$converted_path" | sed "s|^[A-Za-z]:|/mnt/$drive_letter|")
    fi
    
    echo "$converted_path"
}

# Function to suggest Linux equivalent path
suggest_linux_path() {
    local windows_path="$1"
    local converted_path=$(convert_path "$windows_path")
    
    # If it's in typical download locations, suggest Linux equivalent
    if [[ $converted_path == *"/Downloads"* ]]; then
        echo "$HOME/Downloads"
    elif [[ $converted_path == *"/Documents"* ]]; then
        echo "$HOME/Documents"
    elif [[ $converted_path == *"/Desktop"* ]]; then
        echo "$HOME/Desktop"
    else
        # Default to Downloads if we can't determine a good alternative
        echo "$LINUX_DATA_PREFIX"
    fi
}

# Function to parse .fastresume files and extract torrent info
parse_fastresume() {
    local fastresume_file="$1"
    
    # This is a simplified parser - .fastresume files are bencode format
    # We'll extract what we can using strings and grep
    local save_path=""
    local name=""
    
    if [ -f "$fastresume_file" ]; then
        # Try to extract save path (this is a basic approach)
        save_path=$(strings "$fastresume_file" | grep -E '^[A-Z]:\\' | head -1 2>/dev/null || echo "")
        name=$(basename "$fastresume_file" .fastresume)
    fi
    
    echo "$save_path|$name"
}

# Function to list all torrents
list_torrents() {
    print_status "Scanning for torrents in Windows qBittorrent directory..."
    
    if [ ! -d "$WINDOWS_QB_PATH" ]; then
        print_error "Windows qBittorrent directory not found: $WINDOWS_QB_PATH"
        print_error "Please check if Windows partition is mounted and update WINDOWS_QB_PATH variable"
        exit 1
    fi
    
    local bt_backup_dir="$WINDOWS_QB_PATH/BT_backup"
    if [ ! -d "$bt_backup_dir" ]; then
        print_error "BT_backup directory not found: $bt_backup_dir"
        exit 1
    fi
    
    # Find all .torrent files
    local torrent_files=($(find "$bt_backup_dir" -name "*.torrent" 2>/dev/null))
    local fastresume_files=($(find "$bt_backup_dir" -name "*.fastresume" 2>/dev/null))
    
    if [ ${#torrent_files[@]} -eq 0 ]; then
        print_warning "No torrent files found in $bt_backup_dir"
        return 1
    fi
    
    print_success "Found ${#torrent_files[@]} torrent files"
    echo
    
    # Create arrays to store torrent information
    declare -a torrent_names
    declare -a torrent_paths
    declare -a torrent_hashes
    
    local count=0
    for torrent_file in "${torrent_files[@]}"; do
        local hash=$(basename "$torrent_file" .torrent)
        local fastresume_file="$bt_backup_dir/$hash.fastresume"
        
        # Get torrent name from filename or try to extract from file
        local torrent_name=$(basename "$torrent_file" .torrent)
        
        # Try to get save path from fastresume file
        local save_path=""
        if [ -f "$fastresume_file" ]; then
            local info=$(parse_fastresume "$fastresume_file")
            save_path=$(echo "$info" | cut -d'|' -f1)
        fi
        
        torrent_names[$count]="$torrent_name"
        torrent_paths[$count]="$save_path"
        torrent_hashes[$count]="$hash"
        
        printf "%3d. %s\n" $((count + 1)) "$torrent_name"
        if [ -n "$save_path" ]; then
            printf "     Save path: %s\n" "$save_path"
            printf "     Linux equivalent: %s\n" "$(suggest_linux_path "$save_path")"
        else
            printf "     Save path: %s\n" "Unknown"
        fi
        echo
        
        ((count++))
    done
    
    # Store in global arrays for later use
    TORRENT_NAMES=("${torrent_names[@]}")
    TORRENT_PATHS=("${torrent_paths[@]}")
    TORRENT_HASHES=("${torrent_hashes[@]}")
    
    return 0
}

# Function to show dry run
show_dry_run() {
    print_status "=== DRY RUN - MIGRATION PREVIEW ==="
    echo
    
    print_status "The following changes will be made:"
    echo
    
    print_status "1. qBittorrent configuration files will be copied from:"
    echo "   Source: $WINDOWS_QB_PATH"
    echo "   Target: $LINUX_QB_PATH"
    echo
    
    print_status "2. Torrent files and resume data:"
    local bt_backup_source="$WINDOWS_QB_PATH/BT_backup"
    local bt_backup_target="$LINUX_QB_PATH/BT_backup"
    echo "   Source: $bt_backup_source"
    echo "   Target: $bt_backup_target"
    echo
    
    print_status "3. Path modifications in configuration:"
    
    # Check qBittorrent.conf for paths that need updating
    local qb_conf="$WINDOWS_QB_PATH/qBittorrent.conf"
    if [ -f "$qb_conf" ]; then
        echo "   The following paths in qBittorrent.conf will be updated:"
        
        # Look for common path settings
        grep -E "(DefaultSavePath|TempPath|DownloadPath)" "$qb_conf" 2>/dev/null | while read -r line; do
            local key=$(echo "$line" | cut -d'=' -f1)
            local value=$(echo "$line" | cut -d'=' -f2-)
            local new_value=$(suggest_linux_path "$value")
            echo "     $key: $value -> $new_value"
        done
    fi
    
    echo
    print_status "4. Individual torrent data locations:"
    for i in "${!TORRENT_NAMES[@]}"; do
        local name="${TORRENT_NAMES[$i]}"
        local path="${TORRENT_PATHS[$i]}"
        
        if [ -n "$path" ]; then
            local new_path=$(suggest_linux_path "$path")
            printf "   %s\n" "$name"
            printf "     Windows: %s\n" "$path"
            printf "     Linux:   %s\n" "$new_path"
            echo
        fi
    done
    
    print_warning "NOTE: This script will update configuration files to point to Linux paths."
    print_warning "Make sure your torrent data is accessible at the suggested Linux paths!"
    print_warning "You may need to copy/move your actual torrent data separately."
    echo
}

# Function to update configuration file paths
update_config_paths() {
    local config_file="$1"
    
    if [ ! -f "$config_file" ]; then
        print_warning "Configuration file not found: $config_file"
        return
    fi
    
    print_status "Updating paths in configuration file..."
    
    # Create a temporary file for modifications
    local temp_file=$(mktemp)
    
    # Read the file line by line and update paths
    while IFS= read -r line; do
        if [[ $line =~ ^[^#]*=.*[A-Z]:\\ ]]; then
            # This line contains a Windows path
            local key=$(echo "$line" | cut -d'=' -f1)
            local value=$(echo "$line" | cut -d'=' -f2-)
            local new_value=$(suggest_linux_path "$value")
            echo "$key=$new_value" >> "$temp_file"
            print_status "Updated $key: $value -> $new_value"
        else
            echo "$line" >> "$temp_file"
        fi
    done < "$config_file"
    
    # Replace the original file
    mv "$temp_file" "$config_file"
}

# Function to perform the actual migration
perform_migration() {
    print_status "Starting qBittorrent migration..."
    
    # Create Linux qBittorrent directory if it doesn't exist
    mkdir -p "$LINUX_QB_PATH"
    
    # Copy configuration files
    print_status "Copying configuration files..."
    
    # Copy main configuration file
    if [ -f "$WINDOWS_QB_PATH/qBittorrent.conf" ]; then
        cp "$WINDOWS_QB_PATH/qBittorrent.conf" "$LINUX_QB_PATH/"
        update_config_paths "$LINUX_QB_PATH/qBittorrent.conf"
        print_success "Copied and updated qBittorrent.conf"
    fi
    
    # Copy other configuration files
    for file in categories.json watched_folders.json; do
        if [ -f "$WINDOWS_QB_PATH/$file" ]; then
            cp "$WINDOWS_QB_PATH/$file" "$LINUX_QB_PATH/"
            print_success "Copied $file"
        fi
    done
    
    # Copy BT_backup directory (torrents and resume data)
    print_status "Copying torrent files and resume data..."
    if [ -d "$WINDOWS_QB_PATH/BT_backup" ]; then
        cp -r "$WINDOWS_QB_PATH/BT_backup" "$LINUX_QB_PATH/"
        print_success "Copied BT_backup directory with ${#TORRENT_NAMES[@]} torrents"
    fi
    
    # Copy RSS configuration if it exists
    if [ -d "$WINDOWS_QB_PATH/rss" ]; then
        cp -r "$WINDOWS_QB_PATH/rss" "$LINUX_QB_PATH/"
        print_success "Copied RSS configuration"
    fi
    
    # Set appropriate permissions
    chmod -R 755 "$LINUX_QB_PATH"
    
    print_success "Migration completed successfully!"
    echo
    print_warning "IMPORTANT POST-MIGRATION STEPS:"
    echo "1. Start qBittorrent and verify that torrents are loaded correctly"
    echo "2. Check that download paths are correct for each torrent"
    echo "3. For private trackers, you may need to re-announce or restart torrents"
    echo "4. Verify that your actual torrent data files are accessible at the new Linux paths"
    echo "5. Consider updating any download paths in qBittorrent settings if needed"
}

# Main script execution
main() {
    echo "========================================"
    echo "qBittorrent Windows to Linux Migration"
    echo "========================================"
    echo
    
    # Check if running as root (not recommended)
    if [ "$EUID" -eq 0 ]; then
        print_warning "Running as root is not recommended. Consider running as your regular user."
        read -p "Continue anyway? (y/N): " continue_root
        if [[ ! $continue_root =~ ^[Yy]$ ]]; then
            exit 1
        fi
    fi
    
    # Check if qBittorrent is running
    check_qbittorrent_running
    
    # Verify Windows qBittorrent path exists
    if [ ! -d "$WINDOWS_QB_PATH" ]; then
        print_error "Windows qBittorrent directory not found: $WINDOWS_QB_PATH"
        print_error "Please check if Windows partition is mounted and update the WINDOWS_QB_PATH variable in this script"
        echo
        print_status "To mount Windows partition, you might need to run:"
        echo "sudo mkdir -p /mnt/c"
        echo "sudo mount /dev/sdXY /mnt/c  # Replace sdXY with your Windows partition"
        exit 1
    fi
    
    # List all torrents
    if ! list_torrents; then
        exit 1
    fi
    
    # Show dry run
    show_dry_run
    
    # Ask for confirmation
    echo
    read -p "Do you want to proceed with the migration? (y/N): " confirm
    if [[ ! $confirm =~ ^[Yy]$ ]]; then
        print_status "Migration cancelled by user"
        exit 0
    fi
    
    # Backup existing config if it exists
    backup_existing_config
    
    # Perform the migration
    perform_migration
    
    print_success "qBittorrent migration from Windows to Linux completed!"
}

# Global arrays to store torrent information
declare -a TORRENT_NAMES
declare -a TORRENT_PATHS
declare -a TORRENT_HASHES

# Run the main function
main "$@"