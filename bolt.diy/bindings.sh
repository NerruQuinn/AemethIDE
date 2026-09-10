#!/bin/bash

bindings=""

# Function to extract variable names from the TypeScript interface
# Only string-like env bindings (string | Settings) are returned. D1 database
# bindings such as `DB: D1Database` must NOT be passed as `--binding` strings.
extract_env_vars() {
  awk -F': ' '/^  [A-Z_]+: / { gsub(/;/, "", $2); if ($2 == "string" || $2 == "Settings") print $1 }' worker-configuration.d.ts
}

# First try to read from .env.local if it exists
if [ -f ".env.local" ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    if [[ ! "$line" =~ ^# ]] && [[ -n "$line" ]]; then
      name=$(echo "$line" | cut -d '=' -f 1)
      # D1 is a database binding configured in wrangler.toml, never a string binding
      if [[ "$name" == "DB" ]]; then
        continue
      fi
      value=$(echo "$line" | cut -d '=' -f 2-)
      value=$(echo $value | sed 's/^"\(.*\)"$/\1/')
      bindings+="--binding ${name}=${value} "
    fi
  done < .env.local
else
  # If .env.local doesn't exist, use environment variables defined in .d.ts
  env_vars=($(extract_env_vars))
  # Generate bindings for each environment variable if it exists
  for var in "${env_vars[@]}"; do
    if [ -n "${!var}" ]; then
      bindings+="--binding ${var}=${!var} "
    fi
  done
fi

bindings=$(echo $bindings | sed 's/[[:space:]]*$//')

echo $bindings