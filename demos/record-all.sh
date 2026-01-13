#!/bin/bash
cd "$(dirname "$0")"
mkdir -p recordings

for tape in tapes/*.expect; do
  name=$(basename "$tape" .expect)
  echo -n "Recording $name... "
  start=$(date +%s)
  expect "$tape" > /dev/null 2>&1
  end=$(date +%s)
  echo "$((end - start))s"
done

echo "Done! Recordings in recordings/"
