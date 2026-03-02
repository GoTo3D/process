import XCTest
import RealityKit
@testable import PhotoProcess

final class BoundsParserTests: XCTestCase {

    func testParseValidBounds() throws {
        let bounds = try BoundsParser.parse("1.0,2.0,3.0,4.0,5.0,6.0")
        XCTAssertEqual(bounds.min.x, 1.0, accuracy: 0.001)
        XCTAssertEqual(bounds.min.y, 2.0, accuracy: 0.001)
        XCTAssertEqual(bounds.min.z, 3.0, accuracy: 0.001)
        XCTAssertEqual(bounds.max.x, 4.0, accuracy: 0.001)
        XCTAssertEqual(bounds.max.y, 5.0, accuracy: 0.001)
        XCTAssertEqual(bounds.max.z, 6.0, accuracy: 0.001)
    }

    func testParseValidBoundsWithSpaces() throws {
        let bounds = try BoundsParser.parse("1, 2, 3, 4, 5, 6")
        XCTAssertEqual(bounds.min.x, 1.0, accuracy: 0.001)
        XCTAssertEqual(bounds.max.z, 6.0, accuracy: 0.001)
    }

    func testParseInvalidCountThrows() {
        XCTAssertThrowsError(try BoundsParser.parse("1,2,3")) { error in
            XCTAssertTrue(String(describing: error).contains("6 comma-separated"))
        }
    }

    func testParseMaxLessThanMinThrows() {
        XCTAssertThrowsError(try BoundsParser.parse("4,5,6,1,2,3")) { error in
            XCTAssertTrue(String(describing: error).contains("greater than min"))
        }
    }

    func testParseNonNumericThrows() {
        XCTAssertThrowsError(try BoundsParser.parse("a,b,c,d,e,f")) { error in
            XCTAssertTrue(String(describing: error).contains("6 comma-separated"))
        }
    }

    func testParseNegativeValues() throws {
        let bounds = try BoundsParser.parse("-3,-2,-1,1,2,3")
        XCTAssertEqual(bounds.min.x, -3.0, accuracy: 0.001)
        XCTAssertEqual(bounds.max.x, 1.0, accuracy: 0.001)
    }
}

final class DetailConfigurationTests: XCTestCase {

    func testRequestDetailPreview() {
        let config = DetailConfiguration(
            detail: "preview", maxPolygons: nil, textureDimension: nil,
            textureFormat: nil, textureQuality: nil, textureMaps: nil
        )
        XCTAssertEqual(config.requestDetail, .preview)
    }

    func testRequestDetailReduced() {
        let config = DetailConfiguration(
            detail: "reduced", maxPolygons: nil, textureDimension: nil,
            textureFormat: nil, textureQuality: nil, textureMaps: nil
        )
        XCTAssertEqual(config.requestDetail, .reduced)
    }

    func testRequestDetailCustom() {
        let config = DetailConfiguration(
            detail: "custom", maxPolygons: 100000, textureDimension: nil,
            textureFormat: nil, textureQuality: nil, textureMaps: nil
        )
        XCTAssertEqual(config.requestDetail, .custom)
    }

    func testBuildCustomSpecificationReturnsNilForNonCustom() {
        let config = DetailConfiguration(
            detail: "medium", maxPolygons: 100000, textureDimension: nil,
            textureFormat: nil, textureQuality: nil, textureMaps: nil
        )
        XCTAssertNil(config.buildCustomSpecification())
    }

    func testBuildCustomSpecificationWithPolygons() {
        let config = DetailConfiguration(
            detail: "custom", maxPolygons: 50000, textureDimension: nil,
            textureFormat: nil, textureQuality: nil, textureMaps: nil
        )
        let spec = config.buildCustomSpecification()
        XCTAssertNotNil(spec)
        XCTAssertEqual(spec?.maximumPolygonCount, 50000)
    }

    func testBuildCustomSpecificationWithTextureMaps() {
        let config = DetailConfiguration(
            detail: "custom", maxPolygons: nil, textureDimension: nil,
            textureFormat: "png", textureQuality: nil, textureMaps: "diffuse,normal"
        )
        let spec = config.buildCustomSpecification()
        XCTAssertNotNil(spec)
        XCTAssertTrue(spec!.outputTextureMaps.contains(.diffuseColor))
        XCTAssertTrue(spec!.outputTextureMaps.contains(.normal))
        XCTAssertFalse(spec!.outputTextureMaps.contains(.roughness))
    }

    func testBuildCustomSpecificationWithJpegQuality() {
        let config = DetailConfiguration(
            detail: "custom", maxPolygons: nil, textureDimension: nil,
            textureFormat: "jpeg", textureQuality: 0.9, textureMaps: nil
        )
        let spec = config.buildCustomSpecification()
        XCTAssertNotNil(spec)
    }

    func testBuildCustomSpecificationDefaultJpegQuality() {
        let config = DetailConfiguration(
            detail: "custom", maxPolygons: nil, textureDimension: nil,
            textureFormat: "jpeg", textureQuality: nil, textureMaps: nil
        )
        let spec = config.buildCustomSpecification()
        XCTAssertNotNil(spec)
    }
}

final class OutputManagerTests: XCTestCase {

    func testUsdzOutputURL() {
        let base = URL(fileURLWithPath: "/tmp/test-output")
        let manager = OutputManager(baseDirectory: base)
        XCTAssertEqual(manager.usdzOutputURL.lastPathComponent, "model.usdz")
    }

    func testObjOutputDirectory() {
        let base = URL(fileURLWithPath: "/tmp/test-output")
        let manager = OutputManager(baseDirectory: base)
        XCTAssertEqual(manager.objOutputDirectory.lastPathComponent, "obj")
    }

    func testVerifyOutputsFailsWithEmptyDirectory() throws {
        let tmpDir = FileManager.default.temporaryDirectory
            .appendingPathComponent("photoprocess-test-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: tmpDir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: tmpDir) }

        let manager = OutputManager(baseDirectory: tmpDir)
        XCTAssertFalse(manager.verifyOutputs(skipUsdz: false, skipObj: true))
    }

    func testVerifyOutputsPassesWithUsdzFile() throws {
        let tmpDir = FileManager.default.temporaryDirectory
            .appendingPathComponent("photoprocess-test-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: tmpDir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: tmpDir) }

        let manager = OutputManager(baseDirectory: tmpDir)
        let usdzPath = manager.usdzOutputURL
        try Data("fake usdz content".utf8).write(to: usdzPath)

        XCTAssertTrue(manager.verifyOutputs(skipUsdz: false, skipObj: true))
    }

    func testVerifyOutputsFailsWithZeroByteUsdz() throws {
        let tmpDir = FileManager.default.temporaryDirectory
            .appendingPathComponent("photoprocess-test-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: tmpDir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: tmpDir) }

        let manager = OutputManager(baseDirectory: tmpDir)
        let usdzPath = manager.usdzOutputURL
        try Data().write(to: usdzPath)

        XCTAssertFalse(manager.verifyOutputs(skipUsdz: false, skipObj: true))
    }

    func testVerifyOutputsChecksObjInBaseDirectory() throws {
        let tmpDir = FileManager.default.temporaryDirectory
            .appendingPathComponent("photoprocess-test-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: tmpDir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: tmpDir) }

        let manager = OutputManager(baseDirectory: tmpDir)

        // No .obj file → should fail
        XCTAssertFalse(manager.verifyOutputs(skipUsdz: true, skipObj: false))

        // Add a .obj file → should pass
        try Data("fake obj".utf8).write(to: tmpDir.appendingPathComponent("model.obj"))
        XCTAssertTrue(manager.verifyOutputs(skipUsdz: true, skipObj: false))
    }

    func testFlattenObjOutput() throws {
        let tmpDir = FileManager.default.temporaryDirectory
            .appendingPathComponent("photoprocess-test-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: tmpDir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: tmpDir) }

        let manager = OutputManager(baseDirectory: tmpDir)
        let objDir = manager.objOutputDirectory
        try FileManager.default.createDirectory(at: objDir, withIntermediateDirectories: true)

        // Create test files in obj/
        try Data("obj data".utf8).write(to: objDir.appendingPathComponent("model.obj"))
        try Data("mtl data".utf8).write(to: objDir.appendingPathComponent("model.mtl"))

        try manager.flattenObjOutput()

        // Files should be in base directory
        XCTAssertTrue(FileManager.default.fileExists(atPath: tmpDir.appendingPathComponent("model.obj").path))
        XCTAssertTrue(FileManager.default.fileExists(atPath: tmpDir.appendingPathComponent("model.mtl").path))
        // obj/ directory should be removed
        XCTAssertFalse(FileManager.default.fileExists(atPath: objDir.path))
    }

    func testFlattenObjOutputSkipsExistingFiles() throws {
        let tmpDir = FileManager.default.temporaryDirectory
            .appendingPathComponent("photoprocess-test-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: tmpDir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: tmpDir) }

        let manager = OutputManager(baseDirectory: tmpDir)
        let objDir = manager.objOutputDirectory
        try FileManager.default.createDirectory(at: objDir, withIntermediateDirectories: true)

        // Pre-existing file in base directory
        try Data("existing".utf8).write(to: tmpDir.appendingPathComponent("model.obj"))
        // New file in obj/ with same name
        try Data("new from obj".utf8).write(to: objDir.appendingPathComponent("model.obj"))

        try manager.flattenObjOutput()

        // Original file should be preserved (not overwritten)
        let content = try String(contentsOf: tmpDir.appendingPathComponent("model.obj"), encoding: .utf8)
        XCTAssertEqual(content, "existing")
    }
}
