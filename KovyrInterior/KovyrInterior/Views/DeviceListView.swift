import SwiftUI

/// The "Overview" tab: network summary header, scan control, and the live list
/// of discovered devices.
struct DeviceListView: View {
    @EnvironmentObject private var scanner: NetworkScanner
    @State private var path: [String] = []

    var body: some View {
        NavigationStack(path: $path) {
            List {
                Section {
                    NetworkHeaderView()
                        .listRowInsets(EdgeInsets())
                        .listRowBackground(Color.clear)
                }

                if scanner.isScanning {
                    Section {
                        ProgressView(value: scanner.progress) {
                            Text(scanner.statusText).font(.footnote)
                        }
                    }
                }

                Section {
                    if scanner.devices.isEmpty && !scanner.isScanning {
                        ContentUnavailableView(
                            "No devices yet",
                            systemImage: "wifi",
                            description: Text("Tap Scan to discover devices on your Wi-Fi network.")
                        )
                    } else {
                        ForEach(scanner.devices) { device in
                            NavigationLink(value: device.id) {
                                DeviceRowView(device: device)
                            }
                        }
                    }
                } header: {
                    if !scanner.devices.isEmpty {
                        Text("^[\(scanner.devices.count) device](inflect: true)")
                    }
                }
            }
            .kovyrScreen()
            .navigationTitle("Kovyr Interior")
            .navigationBarTitleDisplayMode(.inline)
            .navigationDestination(for: String.self) { id in
                if let device = scanner.devices.first(where: { $0.id == id }) {
                    DeviceDetailView(device: device)
                }
            }
            .toolbar {
                ToolbarItem(placement: .principal) {
                    KovyrWordmark()
                }
                ToolbarItem(placement: .topBarTrailing) {
                    if scanner.isScanning {
                        Button("Stop", role: .destructive) { scanner.stopScan() }
                    } else {
                        Button {
                            scanner.startScan()
                        } label: {
                            Label("Scan", systemImage: "arrow.clockwise")
                        }
                    }
                }
            }
            .refreshable { scanner.startScan() }
        }
        // Deep-link from a "new device" notification tap. The target may not be in
        // the list yet (a background scan found it), so also retry whenever the
        // device list updates and when the view first appears.
        .onAppear { openPendingDeviceIfPossible() }
        .onChange(of: scanner.pendingOpenIP) { _, _ in openPendingDeviceIfPossible() }
        .onChange(of: scanner.devices) { _, _ in openPendingDeviceIfPossible() }
    }

    /// Pushes the device the user asked to open (via a notification tap) once it
    /// is present in the list, then clears the pending request.
    private func openPendingDeviceIfPossible() {
        guard let ip = scanner.pendingOpenIP,
              scanner.devices.contains(where: { $0.ipAddress == ip }) else { return }
        if path.last != ip { path = [ip] }
        scanner.pendingOpenIP = nil
    }
}

struct DeviceRowView: View {
    let device: DiscoveredDevice

    var body: some View {
        HStack(spacing: 14) {
            ZStack {
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(Color.white.opacity(0.1))
                    .frame(width: 42, height: 42)
                Image(systemName: device.iconName)
                    .font(.system(size: 20))
                    .foregroundStyle(Color.kovyrGold)
            }

            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text(device.displayName)
                        .font(.body.weight(.medium))
                        .lineLimit(1)
                    if device.isNew { tag("New", .pink) }
                    if device.isRouter { tag("Router", .orange) }
                    if device.isSelf { tag("You", .green) }
                }
                Text(subtitle)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                if let mac = device.macAddress {
                    Text(mac)
                        .font(.caption2.monospaced())
                        .foregroundStyle(.tertiary)
                        .lineLimit(1)
                }
            }

            Spacer()
            Text(device.ipAddress)
                .font(.caption.monospacedDigit())
                .foregroundStyle(.secondary)
        }
        .padding(.vertical, 4)
    }

    private var subtitle: String {
        if !device.services.isEmpty {
            return device.services.prefix(3).map { $0.category.label }.joined(separator: " · ")
        }
        if !device.openPorts.isEmpty {
            return device.openPorts.prefix(4).map { "\($0.port)" }.joined(separator: ", ") + " open"
        }
        return "Responds on network"
    }

    private func tag(_ text: String, _ color: Color) -> some View {
        Text(text)
            .font(.caption2.weight(.semibold))
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(color.opacity(0.18), in: Capsule())
            .foregroundStyle(color)
    }
}
