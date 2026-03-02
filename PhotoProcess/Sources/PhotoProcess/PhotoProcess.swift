import ArgumentParser
import Foundation

@main
struct PhotoProcess: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        abstract: "Process images into 3D models (USDZ + OBJ) using Apple Object Capture",
        version: "1.0.0"
    )

    // MARK: - Required positional arguments

    @Argument(help: "Path to directory containing input images")
    var inputDirectory: String

    @Argument(help: "Path to output directory for generated models")
    var outputDirectory: String

    // MARK: - Standard options

    @Option(name: .long, help: "Detail level: preview|reduced|medium|full|raw|custom (default: medium)")
    var detail: String = "medium"

    @Option(name: .long, help: "Sample ordering: unordered|sequential (default: unordered)")
    var ordering: String = "unordered"

    @Option(name: .long, help: "Feature sensitivity: normal|high (default: normal)")
    var featureSensitivity: String = "normal"

    @Flag(name: .long, help: "Disable automatic object masking")
    var noObjectMasking: Bool = false

    // MARK: - Custom detail options (only when --detail custom)

    @Option(name: .long, help: "Maximum polygon count (custom detail only)")
    var maxPolygons: Int?

    @Option(name: .long, help: "Texture dimension: 1k|2k|4k|8k|16k (custom detail only)")
    var textureDimension: String?

    @Option(name: .long, help: "Texture format: png|jpeg (custom detail only)")
    var textureFormat: String?

    @Option(name: .long, help: "JPEG compression quality 0.0-1.0, default 0.8 (custom detail, jpeg format only)")
    var textureQuality: Float?

    @Option(name: .long, help: "Texture maps: diffuse,normal,roughness,displacement,ao,all (comma-separated, custom detail only)")
    var textureMaps: String?

    // MARK: - Bounding box

    @Option(name: .long, help: "Bounding box as minX,minY,minZ,maxX,maxY,maxZ (six comma-separated floats)")
    var bounds: String?

    // MARK: - Output control

    @Flag(name: .long, help: "Skip USDZ generation (OBJ only)")
    var skipUsdz: Bool = false

    @Flag(name: .long, help: "Skip OBJ generation (USDZ only)")
    var skipObj: Bool = false

    // MARK: - Checkpoint

    @Option(name: .long, help: "Checkpoint directory for resumable processing")
    var checkpointDirectory: String?

    // MARK: - Validation

    mutating func validate() throws {
        let validDetails = ["preview", "reduced", "medium", "full", "raw", "custom"]
        guard validDetails.contains(detail.lowercased()) else {
            throw ValidationError("Invalid detail level '\(detail)'. Must be one of: \(validDetails.joined(separator: ", "))")
        }

        let validOrderings = ["unordered", "sequential"]
        guard validOrderings.contains(ordering.lowercased()) else {
            throw ValidationError("Invalid ordering '\(ordering)'. Must be one of: \(validOrderings.joined(separator: ", "))")
        }

        let validFeatures = ["normal", "high"]
        guard validFeatures.contains(featureSensitivity.lowercased()) else {
            throw ValidationError("Invalid feature sensitivity '\(featureSensitivity)'. Must be one of: \(validFeatures.joined(separator: ", "))")
        }

        if skipUsdz && skipObj {
            throw ValidationError("Cannot skip both USDZ and OBJ output")
        }

        if detail.lowercased() == "custom" {
            guard maxPolygons != nil || textureDimension != nil || textureFormat != nil else {
                throw ValidationError("Custom detail requires at least one of: --max-polygons, --texture-dimension, --texture-format")
            }
        }

        if let quality = textureQuality {
            guard quality >= 0.0 && quality <= 1.0 else {
                throw ValidationError("Texture quality must be between 0.0 and 1.0")
            }
        }

        if bounds != nil {
            _ = try BoundsParser.parse(bounds!)
        }

        let inputURL = URL(fileURLWithPath: inputDirectory)
        var isDir: ObjCBool = false
        guard FileManager.default.fileExists(atPath: inputURL.path, isDirectory: &isDir), isDir.boolValue else {
            throw ValidationError("Input directory does not exist: \(inputDirectory)")
        }
    }

    // MARK: - Run

    func run() async throws {
        let inputURL = URL(fileURLWithPath: inputDirectory)
        let outputURL = URL(fileURLWithPath: outputDirectory)

        let detailConfig = DetailConfiguration(
            detail: detail,
            maxPolygons: maxPolygons,
            textureDimension: textureDimension,
            textureFormat: textureFormat,
            textureQuality: textureQuality,
            textureMaps: textureMaps
        )

        let geometry: BoundsParser.ParsedBounds? = if let bounds {
            try BoundsParser.parse(bounds)
        } else {
            nil
        }

        let outputManager = OutputManager(baseDirectory: outputURL)

        let runner = SessionRunner(
            inputURL: inputURL,
            outputManager: outputManager,
            detailConfig: detailConfig,
            ordering: ordering,
            featureSensitivity: featureSensitivity,
            objectMaskingEnabled: !noObjectMasking,
            bounds: geometry,
            skipUsdz: skipUsdz,
            skipObj: skipObj,
            checkpointDirectory: checkpointDirectory.map { URL(fileURLWithPath: $0) }
        )

        try await runner.run()
    }
}
