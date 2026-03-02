import Foundation
import ModelIO

struct ModelDimensions: Sendable {
    let width: Float
    let height: Float
    let depth: Float
    let minBounds: SIMD3<Float>
    let maxBounds: SIMD3<Float>
}

enum ModelInfoExtractor {
    /// Extract bounding box dimensions from a USDZ or OBJ file using ModelIO.
    /// Returns nil if the file doesn't exist or dimensions are all zero.
    static func extractDimensions(from url: URL) -> ModelDimensions? {
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }

        let asset = MDLAsset(url: url)
        asset.loadTextures()

        let bb = asset.boundingBox
        let minB = bb.minBounds
        let maxB = bb.maxBounds

        let w = maxB.x - minB.x
        let h = maxB.y - minB.y
        let d = maxB.z - minB.z

        guard w > 0 || h > 0 || d > 0 else { return nil }

        return ModelDimensions(
            width: w,
            height: h,
            depth: d,
            minBounds: minB,
            maxBounds: maxB
        )
    }
}
