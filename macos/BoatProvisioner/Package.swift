// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "BoatProvisioner",
    platforms: [
        .macOS(.v14),
    ],
    products: [
        .executable(name: "BoatProvisioner", targets: ["BoatProvisioner"]),
    ],
    targets: [
        .executableTarget(
            name: "BoatProvisioner"
        ),
    ]
)
