#!/bin/bash


# remove all minified files
rm -f *.min.css *.min.js

# minify css
csso styles.css --output styles.min.css

# minify all js files
# for file in *.js; do
#     if [[ "$file" != *.min.js ]]; then
#         terser "$file" --compress --mangle > "${file%.js}.min.js"
#     fi
# done