import Foundation

struct OutputManager: Sendable {
    let baseDirectory: URL

    var usdzOutputURL: URL {
        baseDirectory.appendingPathComponent("model.usdz")
    }

    var objOutputDirectory: URL {
        baseDirectory.appendingPathComponent("obj", isDirectory: true)
    }

    func prepareDirectories(skipUsdz: Bool, skipObj: Bool) throws {
        try FileManager.default.createDirectory(at: baseDirectory, withIntermediateDirectories: true)
        if !skipObj {
            try FileManager.default.createDirectory(at: objOutputDirectory, withIntermediateDirectories: true)
        }
    }

    // CR-05: Verify output files exist AND have non-zero size
    func verifyOutputs(skipUsdz: Bool, skipObj: Bool) -> Bool {
        var valid = true
        if !skipUsdz {
            let attrs = try? FileManager.default.attributesOfItem(atPath: usdzOutputURL.path)
            let size = attrs?[.size] as? UInt64 ?? 0
            valid = valid && size > 0
        }
        if !skipObj {
            // After flatten, OBJ files are in baseDirectory
            let contents = (try? FileManager.default.contentsOfDirectory(atPath: baseDirectory.path)) ?? []
            let hasObj = contents.contains { $0.hasSuffix(".obj") }
            valid = valid && hasObj
        }
        return valid
    }

    /// Move files from obj/ subdirectory to baseDirectory so the Node.js uploader finds them flat.
    func flattenObjOutput() throws {
        guard FileManager.default.fileExists(atPath: objOutputDirectory.path) else { return }

        let contents = try FileManager.default.contentsOfDirectory(
            at: objOutputDirectory,
            includingPropertiesForKeys: nil
        )
        for fileURL in contents {
            let destination = baseDirectory.appendingPathComponent(fileURL.lastPathComponent)
            // CR-11: Log skipped files instead of silent skip
            if FileManager.default.fileExists(atPath: destination.path) {
                FileHandle.standardError.write(
                    Data("[PhotoProcess] Skipping flatten: \(fileURL.lastPathComponent) already exists in output\n".utf8)
                )
            } else {
                try FileManager.default.moveItem(at: fileURL, to: destination)
            }
        }
        try FileManager.default.removeItem(at: objOutputDirectory)
    }
}
