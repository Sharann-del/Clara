#!/bin/sh
# Downloads Clara's typefaces (SIL Open Font License) into Clara/Fonts: the same faces the web
# app loads from Google Fonts. The app falls back to SF Pro / SF Mono without them.
set -e
cd "$(dirname "$0")/.."
mkdir -p Clara/Fonts
base=https://raw.githubusercontent.com/google/fonts/main/ofl
curl -fsSL "$base/bricolagegrotesque/BricolageGrotesque%5Bopsz%2Cwdth%2Cwght%5D.ttf" -o Clara/Fonts/BricolageGrotesque.ttf
curl -fsSL "$base/instrumentsans/InstrumentSans%5Bwdth%2Cwght%5D.ttf" -o Clara/Fonts/InstrumentSans.ttf
curl -fsSL "$base/jetbrainsmono/JetBrainsMono%5Bwght%5D.ttf" -o Clara/Fonts/JetBrainsMono.ttf
curl -fsSL "$base/bricolagegrotesque/OFL.txt" -o Clara/Fonts/OFL-BricolageGrotesque.txt
curl -fsSL "$base/instrumentsans/OFL.txt" -o Clara/Fonts/OFL-InstrumentSans.txt
curl -fsSL "$base/jetbrainsmono/OFL.txt" -o Clara/Fonts/OFL-JetBrainsMono.txt
ls -la Clara/Fonts
