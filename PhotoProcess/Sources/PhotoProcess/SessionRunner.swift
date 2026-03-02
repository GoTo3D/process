import RealityKit
import Foundation
import ArgumentParser
import ModelIO

struct SessionRunner: Sendable {
    let inputURL: URL
    let outputManager: OutputManager
    let detailConfig: DetailConfiguration
    let ordering: String
    let featureSensitivity: String
    let objectMaskingEnabled: Bool
    let bounds: BoundsParser.ParsedBounds?
    let skipUsdz: Bool
    let skipObj: Bool
    let checkpointDirectory: URL?

    func run() async throws {
        let reporter = ProgressReporter()

        // Prepare output directories
        reporter.log("Preparing output directories...")
        try outputManager.prepareDirectories(skipUsdz: skipUsdz, skipObj: skipObj)

        // Build session configuration
        var config = PhotogrammetrySession.Configuration()

        switch ordering.lowercased() {
        case "sequential": config.sampleOrdering = .sequential
        default: config.sampleOrdering = .unordered
        }

        switch featureSensitivity.lowercased() {
        case "high": config.featureSensitivity = .high
        default: config.featureSensitivity = .normal
        }

        config.isObjectMaskingEnabled = objectMaskingEnabled

        if let checkpointDirectory {
            config.checkpointDirectory = checkpointDirectory
        }

        if let customSpec = detailConfig.buildCustomSpecification() {
            config.customDetailSpecification = customSpec
        }

        reporter.log("Creating PhotogrammetrySession...")
        reporter.log("  Input: \(inputURL.path)")
        reporter.log("  Detail: \(detailConfig.detail)")
        reporter.log("  Ordering: \(ordering)")
        reporter.log("  Feature sensitivity: \(featureSensitivity)")
        reporter.log("  Object masking: \(objectMaskingEnabled)")
        if bounds != nil {
            reporter.log("  Bounds: provided")
        }

        // CR-01 + CR-04: Single session for all requests
        let session = try PhotogrammetrySession(
            input: inputURL,
            configuration: config
        )

        // CR-03: Signal handlers reference this single session.
        // Variables survive until defer block calls .cancel().
        let signalSource = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .global())
        signal(SIGTERM, SIG_IGN)
        signalSource.setEventHandler {
            reporter.log("Received SIGTERM, cancelling session...")
            session.cancel()
        }
        signalSource.resume()

        let intSource = DispatchSource.makeSignalSource(signal: SIGINT, queue: .global())
        signal(SIGINT, SIG_IGN)
        intSource.setEventHandler {
            reporter.log("Received SIGINT, cancelling session...")
            session.cancel()
        }
        intSource.resume()

        defer {
            signalSource.cancel()
            intSource.cancel()
        }

        // Build request detail
        let requestDetail = detailConfig.requestDetail

        // CR-02: Build geometry from bounds
        let geometry = buildGeometry()

        // CR-04: Build all requests for a single session
        var requests: [PhotogrammetrySession.Request] = []
        var requestLabels: [ProgressReporter.RequestLabel] = []

        if !skipUsdz {
            let usdzURL = outputManager.usdzOutputURL
            if let geometry {
                requests.append(.modelFile(url: usdzURL, detail: requestDetail, geometry: geometry))
            } else {
                requests.append(.modelFile(url: usdzURL, detail: requestDetail))
            }
            requestLabels.append(.usdz)
        }

        if !skipObj {
            let objDir = outputManager.objOutputDirectory
            if let geometry {
                requests.append(.modelFile(url: objDir, detail: requestDetail, geometry: geometry))
            } else {
                requests.append(.modelFile(url: objDir, detail: requestDetail))
            }
            requestLabels.append(.obj)
        }

        reporter.log("Submitting \(requests.count) request(s) to session...")
        try session.process(requests: requests)

        // Process all outputs from the single async sequence
        let hadError = try await processOutputs(
            session: session,
            reporter: reporter,
            requestLabels: requestLabels
        )

        if hadError {
            throw ExitCode(1)
        }

        // Flatten OBJ output to base directory
        if !skipObj {
            reporter.log("Flattening OBJ output to base directory...")
            try outputManager.flattenObjOutput()
        }

        // Verify outputs
        guard outputManager.verifyOutputs(skipUsdz: skipUsdz, skipObj: skipObj) else {
            reporter.reportError(label: .unknown, message: "Output verification failed: expected files not found")
            throw ExitCode(1)
        }

        // Extract model dimensions from output
        let modelURL: URL? = if !skipUsdz {
            outputManager.usdzOutputURL
        } else {
            firstObjFile(in: outputManager.baseDirectory)
        }
        if let modelURL, let dims = ModelInfoExtractor.extractDimensions(from: modelURL) {
            reporter.reportModelInfo(dimensions: dims)
            reporter.log("Model dimensions: \(dims.width)x\(dims.height)x\(dims.depth) meters")
        } else {
            reporter.log("Could not extract model dimensions.")
        }

        reporter.reportProcessingComplete()
        reporter.log("Processing complete.")
    }

    // MARK: - Geometry (CR-02)

    private func buildGeometry() -> PhotogrammetrySession.Request.Geometry? {
        guard let bounds = self.bounds else { return nil }
        let box = BoundingBox(min: bounds.min, max: bounds.max)
        return .init(bounds: box)
    }

    /// Find the first .obj file in the given directory (after flatten).
    private func firstObjFile(in directory: URL) -> URL? {
        let contents = (try? FileManager.default.contentsOfDirectory(atPath: directory.path)) ?? []
        guard let name = contents.first(where: { $0.hasSuffix(".obj") }) else { return nil }
        return directory.appendingPathComponent(name)
    }

    // MARK: - Output processing

    private func processOutputs(
        session: PhotogrammetrySession,
        reporter: ProgressReporter,
        requestLabels: [ProgressReporter.RequestLabel]
    ) async throws -> Bool {
        var hadError = false
        var lastFraction: Double = 0  // CR-06: track last known fraction
        var requestIndex = 0

        for try await output in session.outputs {
            let currentLabel = requestIndex < requestLabels.count
                ? requestLabels[requestIndex]
                : .unknown

            switch output {
            case .requestProgress(_, fractionComplete: let fraction):
                lastFraction = fraction
                reporter.reportProgress(label: currentLabel, fraction: fraction)

            case .requestProgressInfo(_, let info):
                let stage = stageString(info.processingStage)
                reporter.reportProgressInfo(
                    label: currentLabel,
                    fraction: lastFraction,  // CR-06: use tracked fraction instead of 0
                    stage: stage,
                    etaSeconds: info.estimatedRemainingTime
                )

            case .requestComplete(_, _):
                let outputPath = currentLabel == .usdz
                    ? outputManager.usdzOutputURL.path
                    : outputManager.objOutputDirectory.path
                reporter.reportComplete(label: currentLabel, outputPath: outputPath)
                requestIndex += 1
                lastFraction = 0  // reset for next request

            case .requestError(_, let error):
                reporter.reportError(label: currentLabel, message: error.localizedDescription)
                hadError = true
                requestIndex += 1
                lastFraction = 0

            case .inputComplete:
                reporter.reportInputComplete()
                reporter.log("All input images processed.")

            case .invalidSample(let id, let reason):
                reporter.reportInvalidSample(id: id, reason: reason)
                reporter.log("Invalid sample #\(id): \(reason)")

            case .skippedSample(let id):
                reporter.reportSkippedSample(id: id)
                reporter.log("Skipped sample #\(id)")

            case .automaticDownsampling:
                reporter.reportDownsampling()
                reporter.log("Automatic downsampling applied.")

            case .processingComplete:
                reporter.log("Session processing complete.")

            case .processingCancelled:
                reporter.reportCancelled()
                reporter.log("Processing cancelled.")
                hadError = true

            case .stitchingIncomplete:
                reporter.reportStitchingIncomplete()
                reporter.log("Stitching incomplete - not all images could be stitched.")

            @unknown default:
                reporter.log("Unknown output event received.")
            }
        }

        return hadError
    }

    private func stageString(_ stage: PhotogrammetrySession.Output.ProcessingStage?) -> String? {
        guard let stage else { return nil }
        switch stage {
        case .preProcessing: return "preProcessing"
        case .imageAlignment: return "imageAlignment"
        case .pointCloudGeneration: return "pointCloudGeneration"
        case .meshGeneration: return "meshGeneration"
        case .textureMapping: return "textureMapping"
        case .optimization: return "optimization"
        @unknown default: return "unknown"
        }
    }
}
