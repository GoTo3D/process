import Foundation
import RealityKit

/// Reports progress events as JSON lines to stdout.
/// Human-readable debug messages go to stderr.
struct ProgressReporter: Sendable {
    enum RequestLabel: String, Sendable {
        case usdz
        case obj
        case unknown
    }

    // MARK: - Event reporting

    func reportProgress(label: RequestLabel, fraction: Double) {
        let dict: [String: Any] = [
            "type": "progress",
            "request": label.rawValue,
            "fraction": fraction,
        ]
        writeJSON(dict)
    }

    func reportProgressInfo(label: RequestLabel, fraction: Double, stage: String?, etaSeconds: Double?) {
        var dict: [String: Any] = [
            "type": "progress",
            "request": label.rawValue,
            "fraction": fraction,
        ]
        if let stage { dict["stage"] = stage }
        if let etaSeconds { dict["eta_seconds"] = etaSeconds }
        writeJSON(dict)
    }

    func reportComplete(label: RequestLabel, outputPath: String) {
        writeJSON([
            "type": "complete",
            "request": label.rawValue,
            "output_path": outputPath,
        ])
    }

    func reportError(label: RequestLabel, message: String) {
        writeJSON([
            "type": "error",
            "request": label.rawValue,
            "message": message,
        ])
    }

    func reportInvalidSample(id: Int, reason: String) {
        writeJSON([
            "type": "invalid_sample",
            "sample_id": id,
            "reason": reason,
        ])
    }

    func reportSkippedSample(id: Int) {
        writeJSON([
            "type": "skipped_sample",
            "sample_id": id,
        ])
    }

    func reportDownsampling() {
        writeJSON([
            "type": "downsampling",
            "message": "Automatic downsampling applied",
        ])
    }

    func reportStitchingIncomplete() {
        writeJSON([
            "type": "stitching_incomplete",
            "message": "Not all images could be stitched",
        ])
    }

    func reportProcessingComplete() {
        writeJSON(["type": "processing_complete"])
    }

    func reportCancelled() {
        writeJSON(["type": "cancelled"])
    }

    func reportInputComplete() {
        writeJSON(["type": "input_complete"])
    }

    func reportModelInfo(dimensions: ModelDimensions) {
        writeJSON([
            "type": "model_info",
            "dimensions": [
                "width": round(dimensions.width * 100) / 100,
                "height": round(dimensions.height * 100) / 100,
                "depth": round(dimensions.depth * 100) / 100,
            ],
            "bounding_box": [
                "min": [
                    "x": round(dimensions.minBounds.x * 100) / 100,
                    "y": round(dimensions.minBounds.y * 100) / 100,
                    "z": round(dimensions.minBounds.z * 100) / 100,
                ],
                "max": [
                    "x": round(dimensions.maxBounds.x * 100) / 100,
                    "y": round(dimensions.maxBounds.y * 100) / 100,
                    "z": round(dimensions.maxBounds.z * 100) / 100,
                ],
            ],
            "unit": "meters",
        ])
    }

    // MARK: - Stderr debug logging

    func log(_ message: String) {
        FileHandle.standardError.write(Data("[PhotoProcess] \(message)\n".utf8))
    }

    // MARK: - Private

    private func writeJSON(_ dict: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: dict, options: [.sortedKeys]),
              let str = String(data: data, encoding: .utf8) else {
            return
        }
        print(str)
        fflush(stdout)
    }
}
