const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
// The game ships as a bundled HTML asset that the WebView opens from disk.
config.resolver.assetExts.push('html');

module.exports = config;
