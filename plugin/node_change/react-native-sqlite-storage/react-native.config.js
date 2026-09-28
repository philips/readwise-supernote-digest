// Trimmed to Android only -- this Supernote plugin repo doesn't ship ios/windows platform
// dirs for the vendored copy (see node_change/react-native-sqlite-storage, removed to cut
// vendored size; Supernote plugins are Android-only regardless).
module.exports = {
	dependency: {
		platforms: {
			android: {
				sourceDir: './platforms/android'
			}
		}
	}
}
