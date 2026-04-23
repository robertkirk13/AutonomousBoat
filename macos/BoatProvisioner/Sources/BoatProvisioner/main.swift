import AppKit
import Foundation
import SwiftUI

struct DiskInfo: Identifiable, Hashable {
    let deviceIdentifier: String
    let deviceNode: String
    let mediaName: String
    let totalSize: Int64

    var id: String { deviceIdentifier }

    var displayName: String {
        let size = ByteCountFormatter.string(fromByteCount: totalSize, countStyle: .file)
        return "\(deviceNode) • \(mediaName) • \(size)"
    }
}

struct DiskListPlist: Decodable {
    let allDisks: [String]?

    enum CodingKeys: String, CodingKey {
        case allDisks = "AllDisks"
    }
}

struct DiskDetailPlist: Decodable {
    let deviceIdentifier: String
    let deviceNode: String
    let mediaName: String?
    let totalSize: Int64?

    enum CodingKeys: String, CodingKey {
        case deviceIdentifier = "DeviceIdentifier"
        case deviceNode = "DeviceNode"
        case mediaName = "MediaName"
        case totalSize = "TotalSize"
    }
}

enum ProvisionerError: LocalizedError {
    case missingResource(String)
    case invalidConfiguration(String)
    case processFailed(command: String, message: String)

    var errorDescription: String? {
        switch self {
        case let .missingResource(name):
            return "Missing bundled resource: \(name)"
        case let .invalidConfiguration(message):
            return message
        case let .processFailed(command, message):
            return "\(command) failed.\n\n\(message)"
        }
    }
}

@MainActor
final class ProvisionerViewModel: ObservableObject {
    @Published var disks: [DiskInfo] = []
    @Published var selectedDiskIdentifier = ""
    @Published var hostname = "castaway"
    @Published var username = "chuck"
    @Published var password = ""
    @Published var wifiSSID = ""
    @Published var wifiPassword = ""
    @Published var hotspotSSID = "castaway-setup"
    @Published var hotspotPassword = ""
    @Published var imagePath = ""
    @Published var statusLog = "Ready.\n"
    @Published var isRefreshingDisks = false
    @Published var isFlashing = false

    func appendStatus(_ line: String) {
        if statusLog.isEmpty {
            statusLog = line
        } else {
            statusLog += "\(line)\n"
        }
    }

    func refreshDisks() {
        isRefreshingDisks = true
        appendStatus("Scanning for removable disks…")

        Task {
            do {
                let plistData = try runCommand("/usr/sbin/diskutil", arguments: ["list", "-plist", "external", "physical"])
                let decoder = PropertyListDecoder()
                let diskList = try decoder.decode(DiskListPlist.self, from: plistData)

                var found: [DiskInfo] = []
                for diskIdentifier in diskList.allDisks ?? [] {
                    let infoData = try runCommand("/usr/sbin/diskutil", arguments: ["info", "-plist", "/dev/\(diskIdentifier)"])
                    let detail = try decoder.decode(DiskDetailPlist.self, from: infoData)
                    found.append(
                        DiskInfo(
                            deviceIdentifier: detail.deviceIdentifier,
                            deviceNode: detail.deviceNode,
                            mediaName: detail.mediaName ?? "External Disk",
                            totalSize: detail.totalSize ?? 0
                        )
                    )
                }

                disks = found.sorted { $0.deviceIdentifier < $1.deviceIdentifier }
                if selectedDiskIdentifier.isEmpty {
                    selectedDiskIdentifier = disks.first?.deviceIdentifier ?? ""
                } else if !disks.contains(where: { $0.deviceIdentifier == selectedDiskIdentifier }) {
                    selectedDiskIdentifier = disks.first?.deviceIdentifier ?? ""
                }

                appendStatus("Found \(disks.count) removable disk(s).")
            } catch {
                appendStatus("Disk scan failed: \(error.localizedDescription)")
            }

            isRefreshingDisks = false
        }
    }

    func browseForImage() {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [.data]
        panel.allowsMultipleSelection = false
        panel.canChooseDirectories = false
        panel.title = "Choose a Raspberry Pi OS image"

        if panel.runModal() == .OK {
            imagePath = panel.url?.path ?? ""
        }
    }

    func syncHotspotSSID(from oldHostname: String, to newHostname: String) {
        let oldDefault = "\(oldHostname)-setup"
        if hotspotSSID == oldDefault {
            hotspotSSID = "\(newHostname)-setup"
        }
    }

    func flash() {
        do {
            let config = try makeFlashConfiguration()
            isFlashing = true
            appendStatus("Starting provisioning for /dev/\(config.diskIdentifier)…")

            Task {
                defer { isFlashing = false }
                do {
                    let output = try runPrivilegedFlash(configuration: config)
                    let cleaned = stripANSI(output)
                    if !cleaned.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                        appendStatus(cleaned)
                    }
                    appendStatus("Provisioning finished successfully.")
                } catch {
                    appendStatus("Provisioning failed: \(error.localizedDescription)")
                }
            }
        } catch {
            appendStatus("Cannot start provisioning: \(error.localizedDescription)")
        }
    }

    private func makeFlashConfiguration() throws -> FlashConfiguration {
        guard !selectedDiskIdentifier.isEmpty else {
            throw ProvisionerError.invalidConfiguration("Choose an SD card before flashing.")
        }
        guard !hostname.isEmpty else {
            throw ProvisionerError.invalidConfiguration("Hostname cannot be empty.")
        }
        guard !username.isEmpty else {
            throw ProvisionerError.invalidConfiguration("Username cannot be empty.")
        }
        guard !password.isEmpty else {
            throw ProvisionerError.invalidConfiguration("Pi password cannot be empty.")
        }
        guard !hotspotSSID.isEmpty else {
            throw ProvisionerError.invalidConfiguration("Hotspot SSID cannot be empty.")
        }
        guard hotspotPassword.count >= 8 else {
            throw ProvisionerError.invalidConfiguration("Hotspot password must be at least 8 characters.")
        }
        if !wifiSSID.isEmpty && wifiPassword.isEmpty {
            throw ProvisionerError.invalidConfiguration("Wi-Fi password is required when a client Wi-Fi SSID is set.")
        }

        let bundleResources = try bundledResources()
        return FlashConfiguration(
            diskIdentifier: selectedDiskIdentifier,
            hostname: hostname,
            username: username,
            password: password,
            wifiSSID: wifiSSID,
            wifiPassword: wifiPassword,
            hotspotSSID: hotspotSSID,
            hotspotPassword: hotspotPassword,
            imagePath: imagePath,
            flashScript: bundleResources.flashScript,
            assetDirectory: bundleResources.assetDirectory
        )
    }

    private func bundledResources() throws -> (flashScript: URL, assetDirectory: URL) {
        guard let resources = Bundle.main.resourceURL else {
            throw ProvisionerError.missingResource("app resource directory")
        }

        let flashScript = resources.appendingPathComponent("flash-sd.sh")
        let assetDirectory = resources.appendingPathComponent("ProvisioningAssets")

        guard FileManager.default.isExecutableFile(atPath: flashScript.path) else {
            throw ProvisionerError.missingResource("flash-sd.sh")
        }
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: assetDirectory.path, isDirectory: &isDirectory), isDirectory.boolValue else {
            throw ProvisionerError.missingResource("ProvisioningAssets")
        }

        return (flashScript, assetDirectory)
    }

    private func runPrivilegedFlash(configuration: FlashConfiguration) throws -> String {
        var arguments = [
            configuration.flashScript.path,
            "-d", configuration.diskIdentifier,
            "-n", configuration.hostname,
            "-u", configuration.username,
            "-p", configuration.password,
            "-S", configuration.hotspotSSID,
            "-W", configuration.hotspotPassword,
            "-A", configuration.assetDirectory.path,
            "-y",
        ]

        if !configuration.wifiSSID.isEmpty {
            arguments.append(contentsOf: ["-s", configuration.wifiSSID, "-w", configuration.wifiPassword])
        }

        if !configuration.imagePath.isEmpty {
            arguments.append(contentsOf: ["-i", configuration.imagePath])
        }

        let shellCommand = arguments.map(shellQuote).joined(separator: " ")
        let appleScript = "do shell script \(appleScriptLiteral(shellCommand)) with administrator privileges"

        let outputData = try runCommand("/usr/bin/osascript", arguments: ["-e", appleScript])
        return String(decoding: outputData, as: UTF8.self)
    }
}

struct FlashConfiguration {
    let diskIdentifier: String
    let hostname: String
    let username: String
    let password: String
    let wifiSSID: String
    let wifiPassword: String
    let hotspotSSID: String
    let hotspotPassword: String
    let imagePath: String
    let flashScript: URL
    let assetDirectory: URL
}

struct ProvisionerRootView: View {
    @StateObject private var viewModel = ProvisionerViewModel()

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text("Boat Provisioner")
                .font(.largeTitle)
                .fontWeight(.semibold)

            Text("Flash and fully provision a Raspberry Pi SD card for the boat in one pass.")
                .foregroundStyle(.secondary)

            GroupBox("Target Disk") {
                HStack {
                    Picker("SD Card", selection: $viewModel.selectedDiskIdentifier) {
                        Text("Select a removable disk").tag("")
                        ForEach(viewModel.disks) { disk in
                            Text(disk.displayName).tag(disk.deviceIdentifier)
                        }
                    }
                    .labelsHidden()

                    Button(viewModel.isRefreshingDisks ? "Refreshing…" : "Refresh") {
                        viewModel.refreshDisks()
                    }
                    .disabled(viewModel.isRefreshingDisks || viewModel.isFlashing)
                }
            }

            GroupBox("Pi Settings") {
                Grid(alignment: .leading, horizontalSpacing: 12, verticalSpacing: 10) {
                    GridRow {
                        Text("Hostname")
                        TextField("castaway", text: $viewModel.hostname)
                    }
                    GridRow {
                        Text("Username")
                        TextField("chuck", text: $viewModel.username)
                    }
                    GridRow {
                        Text("Pi Password")
                        SecureField("Required", text: $viewModel.password)
                    }
                    GridRow {
                        Text("Client Wi-Fi SSID")
                        TextField("Optional", text: $viewModel.wifiSSID)
                    }
                    GridRow {
                        Text("Client Wi-Fi Password")
                        SecureField("Optional", text: $viewModel.wifiPassword)
                    }
                    GridRow {
                        Text("Hotspot SSID")
                        TextField("castaway-setup", text: $viewModel.hotspotSSID)
                    }
                    GridRow {
                        Text("Hotspot Password")
                        SecureField("Required", text: $viewModel.hotspotPassword)
                    }
                }
                .textFieldStyle(.roundedBorder)
            }

            GroupBox("Image") {
                HStack {
                    TextField("Leave blank to use the default Raspberry Pi OS image", text: $viewModel.imagePath)
                        .textFieldStyle(.roundedBorder)
                    Button("Browse…") {
                        viewModel.browseForImage()
                    }
                    .disabled(viewModel.isFlashing)
                }
            }

            HStack {
                Button(viewModel.isFlashing ? "Provisioning…" : "Flash SD Card") {
                    viewModel.flash()
                }
                .keyboardShortcut(.defaultAction)
                .disabled(viewModel.isFlashing)

                Spacer()

                Text("The app will ask for an administrator password before writing the card.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            GroupBox("Status") {
                ScrollView {
                    Text(viewModel.statusLog)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .textSelection(.enabled)
                        .font(.system(.body, design: .monospaced))
                }
                .frame(minHeight: 180)
            }
        }
        .padding(20)
        .frame(minWidth: 760, minHeight: 680)
        .onAppear {
            if viewModel.hotspotPassword.isEmpty {
                viewModel.hotspotPassword = randomPassword(length: 12)
            }
            if viewModel.disks.isEmpty {
                viewModel.refreshDisks()
            }
        }
        .onChange(of: viewModel.hostname, initial: false) { oldValue, newValue in
            viewModel.syncHotspotSSID(from: oldValue, to: newValue)
        }
    }
}

@main
struct BoatProvisionerApp: App {
    var body: some Scene {
        WindowGroup {
            ProvisionerRootView()
        }
        .windowResizability(.contentSize)
    }
}

func runCommand(_ launchPath: String, arguments: [String]) throws -> Data {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: launchPath)
    process.arguments = arguments

    let stdout = Pipe()
    let stderr = Pipe()
    process.standardOutput = stdout
    process.standardError = stderr

    try process.run()
    process.waitUntilExit()

    let output = stdout.fileHandleForReading.readDataToEndOfFile()
    let errorOutput = stderr.fileHandleForReading.readDataToEndOfFile()

    if process.terminationStatus != 0 {
        let message = String(decoding: errorOutput + output, as: UTF8.self)
        throw ProvisionerError.processFailed(command: launchPath, message: message)
    }

    return output
}

func shellQuote(_ value: String) -> String {
    if value.isEmpty {
        return "''"
    }

    let escaped = value.replacingOccurrences(of: "'", with: "'\"'\"'")
    return "'\(escaped)'"
}

func appleScriptLiteral(_ value: String) -> String {
    let escaped = value
        .replacingOccurrences(of: "\\", with: "\\\\")
        .replacingOccurrences(of: "\"", with: "\\\"")
    return "\"\(escaped)\""
}

func stripANSI(_ text: String) -> String {
    text.replacingOccurrences(
        of: #"\u{001B}\[[0-9;]*m"#,
        with: "",
        options: .regularExpression
    )
}

func randomPassword(length: Int) -> String {
    let alphabet = Array("ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789")
    return String((0..<length).compactMap { _ in alphabet.randomElement() })
}
