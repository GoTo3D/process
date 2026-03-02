import Foundation
import RealityKit

struct DetailConfiguration: Sendable {
    let detail: String
    let maxPolygons: Int?
    let textureDimension: String?
    let textureFormat: String?
    let textureQuality: Float?
    let textureMaps: String?

    var requestDetail: PhotogrammetrySession.Request.Detail {
        switch detail.lowercased() {
        case "preview": return .preview
        case "reduced": return .reduced
        case "medium": return .medium
        case "full": return .full
        case "raw": return .raw
        case "custom": return .custom
        default: fatalError("Invalid detail: \(detail). Validation should have caught this.")
        }
    }

    func buildCustomSpecification() -> PhotogrammetrySession.Configuration.CustomDetailSpecification? {
        guard detail.lowercased() == "custom" else { return nil }

        var spec = PhotogrammetrySession.Configuration.CustomDetailSpecification()

        if let maxPolygons {
            spec.maximumPolygonCount = UInt(maxPolygons)
        }

        if let dim = textureDimension {
            switch dim.lowercased() {
            case "1k": spec.maximumTextureDimension = .oneK
            case "2k": spec.maximumTextureDimension = .twoK
            case "4k": spec.maximumTextureDimension = .fourK
            case "8k": spec.maximumTextureDimension = .eightK
            case "16k":
                if #available(macOS 15.0, *) {
                    spec.maximumTextureDimension = .sixteenK
                } else {
                    FileHandle.standardError.write(
                        Data("[WARNING] 16K texture requires macOS 15+, falling back to 8K\n".utf8)
                    )
                    spec.maximumTextureDimension = .eightK
                }
            default: break
            }
        }

        if let format = textureFormat {
            switch format.lowercased() {
            case "png":
                spec.textureFormat = .png
            case "jpeg":
                let quality = textureQuality ?? 0.8
                spec.textureFormat = .jpeg(compressionQuality: quality)
            default:
                break
            }
        }

        if let maps = textureMaps {
            var outputs: PhotogrammetrySession.Configuration.CustomDetailSpecification.TextureMapOutputs = []
            for map in maps.split(separator: ",") {
                switch map.lowercased().trimmingCharacters(in: .whitespaces) {
                case "diffuse": outputs.insert(.diffuseColor)
                case "normal": outputs.insert(.normal)
                case "roughness": outputs.insert(.roughness)
                case "displacement": outputs.insert(.displacement)
                case "ao": outputs.insert(.ambientOcclusion)
                case "all": outputs = .all
                default: break
                }
            }
            if !outputs.isEmpty {
                spec.outputTextureMaps = outputs
            }
        }

        return spec
    }
}
