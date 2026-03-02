// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "PhotoProcess",
    platforms: [.macOS(.v14)],
    dependencies: [
        .package(url: "https://github.com/apple/swift-argument-parser.git", from: "1.5.0"),
    ],
    targets: [
        .executableTarget(
            name: "PhotoProcess",
            dependencies: [
                .product(name: "ArgumentParser", package: "swift-argument-parser"),
            ],
            path: "Sources/PhotoProcess"
        ),
        .testTarget(
            name: "PhotoProcessTests",
            dependencies: ["PhotoProcess"],
            path: "Tests/PhotoProcessTests"
        ),
    ]
)
