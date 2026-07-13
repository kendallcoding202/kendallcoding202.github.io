import SwiftUI

/// The "Overview" tab: network summary header, scan control, and the live list
/// of discovered devices.
struct DeviceListView: View {
    @EnvironmentObject private var scanner: NetworkScanner

    var body: some View {
        NavigationStack {
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
            .navigationTitle("Kovyr Interior")
            .navigationDestination(for: String.self) { id in
                if let device = scanner.devices.first(where: { $0.id == id }) {
                    DeviceDetailView(device: device)
                }
            }
            .toolbar {
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
    }
}

struct DeviceRowView: View {
    let device: DiscoveredDevice

    var body: some View {
        HStack(spacing: 14) {
            ZStack {
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(Color.blue.opacity(0.15))
                    .frame(width: 42, height: 42)
                Image(systemName: device.iconName)
                    .font(.system(size: 20))
                    .foregroundStyle(.blue)
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
