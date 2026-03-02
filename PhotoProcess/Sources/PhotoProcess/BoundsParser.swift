import Foundation
import simd
import ArgumentParser

enum BoundsParser {
    struct ParsedBounds: Sendable {
        let min: SIMD3<Float>
        let max: SIMD3<Float>
    }

    static func parse(_ boundsString: String) throws -> ParsedBounds {
        let parts = boundsString.split(separator: ",").compactMap { Float($0.trimmingCharacters(in: .whitespaces)) }
        guard parts.count == 6 else {
            throw ValidationError(
                "Bounds must have exactly 6 comma-separated float values: minX,minY,minZ,maxX,maxY,maxZ (got \(parts.count) values)"
            )
        }
        let minPoint = SIMD3<Float>(parts[0], parts[1], parts[2])
        let maxPoint = SIMD3<Float>(parts[3], parts[4], parts[5])

        guard maxPoint.x > minPoint.x && maxPoint.y > minPoint.y && maxPoint.z > minPoint.z else {
            throw ValidationError("Bounds max values must be greater than min values")
        }

        return ParsedBounds(min: minPoint, max: maxPoint)
    }
}
