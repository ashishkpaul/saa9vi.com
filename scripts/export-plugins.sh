k#!/bin/bash

# Configuration
SRC_DIR="./src"
PLUGINS_DIR="$SRC_DIR/plugins"
DOMAIN_DIR="$SRC_DIR/domain"
ES9_CONFIG_DIR="$SRC_DIR/es9-config"
CONFIG_DIR="$SRC_DIR/config"
PLATFORM_DIR="$SRC_DIR/platform"
SCRIPTS_DIR="./scripts"
# OUTPUT_BASE_DIR="$HOME/Documents/vendure/plugins"
OUTPUT_BASE_DIR="/mnt/256G/projects/vendure/edu/saanvi.com"

# Prompt user for .md file exclusion
read -p "Exclude .md files? (y/n): " exclude_md_choice
if [[ "$exclude_md_choice" =~ ^[Yy]$ ]]; then
    exclude_md="yes"
    echo "  .md files will be excluded."
else
    exclude_md="no"
    echo "  .md files will be included."
fi

# Create output directory if it doesn't exist
mkdir -p "$OUTPUT_BASE_DIR"

# Helper function to check if a file should be excluded
is_excluded() {
    local file="$1"

    # Exclude .md files if user chose so
    if [[ "$exclude_md" == "yes" && "$file" == *.md ]]; then
        return 0
    fi

    # Exclude the two main GraphQL schema files
    [[ "$file" == "./src/gql/schema-admin.graphql" ]] && return 0
    [[ "$file" == "./src/gql/schema-shop.graphql" ]] && return 0

    # Exclude all *-extensions.ts files under any plugin's api/ folder
    [[ "$file" == ./src/plugins/*/api/*-extensions.ts ]] && return 0

    # Exclude shared-types.graphql under any plugin's api/ folder
    [[ "$file" == ./src/plugins/*/api/shared-types.graphql ]] && return 0

    # Exclude generated TypeScript files in any plugin root
    [[ "$file" == ./src/plugins/*/generated-*-types.ts ]] && return 0

    # Exclude e2e test directory under tenant-plugin
    [[ "$file" == ./src/plugins/tenant-plugin/e2e/* ]] && return 0

    return 1
}

# ---------------------------
# Export all plugins individually
# ---------------------------
echo "Exporting plugins individually..."
for plugin_path in "$PLUGINS_DIR"/*/; do
    if [ -d "$plugin_path" ]; then
        plugin_name=$(basename "$plugin_path")
        output_file="$OUTPUT_BASE_DIR/${plugin_name}_complete_code.txt"

        echo "  Exporting '$plugin_name' -> $output_file"

        > "$output_file"   # clear file

        find "$plugin_path" -type f -print0 | while IFS= read -r -d '' file; do
            if ! is_excluded "$file"; then
                echo "--- $file ---" >> "$output_file"
                cat "$file" >> "$output_file"
            fi
        done
    fi
done

# ---------------------------
# Combine all plugins into a single file
# ---------------------------
echo "Creating combined plugins file..."
combined_output="$OUTPUT_BASE_DIR/all_plugins_complete_code.txt"
> "$combined_output"

for plugin_path in "$PLUGINS_DIR"/*/; do
    if [ -d "$plugin_path" ]; then
        plugin_name=$(basename "$plugin_path")
        echo "--- BEGIN PLUGIN: $plugin_name ---" >> "$combined_output"

        find "$plugin_path" -type f -print0 | while IFS= read -r -d '' file; do
            if ! is_excluded "$file"; then
                echo "--- $file ---" >> "$combined_output"
                cat "$file" >> "$combined_output"
            fi
        done

        echo "--- END PLUGIN: $plugin_name ---" >> "$combined_output"
        echo "" >> "$combined_output"
    fi
done
echo "  Done: $combined_output"

# ---------------------------
# Export domain folder
# ---------------------------
echo "Exporting domain folder..."
domain_output="$OUTPUT_BASE_DIR/domain_complete_code.txt"
> "$domain_output"

find "$DOMAIN_DIR" -type f -print0 | while IFS= read -r -d '' file; do
    if ! is_excluded "$file"; then
        echo "--- $file ---" >> "$domain_output"
        cat "$file" >> "$domain_output"
    fi
done
echo "  Done: $domain_output"

# ---------------------------
# Export es9-config folder
# ---------------------------
echo "Exporting es9-config folder..."
es9_output="$OUTPUT_BASE_DIR/es9-config_complete_code.txt"
> "$es9_output"

find "$ES9_CONFIG_DIR" -type f -print0 | while IFS= read -r -d '' file; do
    if ! is_excluded "$file"; then
        echo "--- $file ---" >> "$es9_output"
        cat "$file" >> "$es9_output"
    fi
done
echo "  Done: $es9_output"

# ---------------------------
# Export config folder
# ---------------------------
echo "Exporting config folder..."
config_output="$OUTPUT_BASE_DIR/config_complete_code.txt"
if [ -d "$CONFIG_DIR" ]; then
    > "$config_output"
    find "$CONFIG_DIR" -type f -print0 | while IFS= read -r -d '' file; do
        if ! is_excluded "$file"; then
            echo "--- $file ---" >> "$config_output"
            cat "$file" >> "$config_output"
        fi
    done
    echo "  Done: $config_output"
else
    echo "  Warning: $CONFIG_DIR not found, skipping."
fi

# ---------------------------
# Export platform folder
# ---------------------------
echo "Exporting platform folder..."
platform_output="$OUTPUT_BASE_DIR/platform_complete_code.txt"
if [ -d "$PLATFORM_DIR" ]; then
    > "$platform_output"
    find "$PLATFORM_DIR" -type f -print0 | while IFS= read -r -d '' file; do
        if ! is_excluded "$file"; then
            echo "--- $file ---" >> "$platform_output"
            cat "$file" >> "$platform_output"
        fi
    done
    echo "  Done: $platform_output"
else
    echo "  Warning: $PLATFORM_DIR not found, skipping."
fi

# ---------------------------
# Export scripts folder
# ---------------------------
echo "Exporting scripts folder..."
scripts_output="$OUTPUT_BASE_DIR/scripts_complete_code.txt"
if [ -d "$SCRIPTS_DIR" ]; then
    > "$scripts_output"
    find "$SCRIPTS_DIR" -type f -print0 | while IFS= read -r -d '' file; do
        if ! is_excluded "$file"; then
            echo "--- $file ---" >> "$scripts_output"
            cat "$file" >> "$scripts_output"
        fi
    done
    echo "  Done: $scripts_output"
else
    echo "  Warning: $SCRIPTS_DIR not found, skipping."
fi

echo "All exports completed."

# ---------------------------
# Export customer-deletion folder specifically
# ---------------------------
echo "Exporting customer-deletion folder..."
customer_deletion_output="$OUTPUT_BASE_DIR/customer-deletion_complete_code.txt"
if [ -d "$PLATFORM_DIR/customer-deletion" ]; then
    > "$customer_deletion_output"
    find "$PLATFORM_DIR/customer-deletion" -type f -print0 | while IFS= read -r -d '' file; do
        if ! is_excluded "$file"; then
            echo "--- $file ---" >> "$customer_deletion_output"
            cat "$file" >> "$customer_deletion_output"
        fi
    done
    echo "  Done: $customer_deletion_output"
else
    echo "  Warning: $PLATFORM_DIR/customer-deletion not found, skipping."
fi
