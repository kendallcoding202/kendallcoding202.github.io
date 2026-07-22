import SwiftUI

/// Detail screen for a single device: identity, advertised services, and an
/// on-demand detailed port scan.
struct DeviceDetailView: View {
    let device: DiscoveredDevice
    @EnvironmentObject private var scanner: NetworkScanner
    @StateObject private var portScanner = PortScanner()

    var body: some View {
        List {
            Section {
                HStack(spacing: 16) {
                    Image(systemName: device.iconName)
                        .font(.system(size: 34))
                        .foregroundStyle(Color.kovyrGold)
                        .frame(width: 60, height: 60)
                        .background(Color.white.opacity(0.1), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                    VStack(alignment: .leading, spacing: 4) {
                        Text(device.displayName).font(.title3.bold())
                        Text(device.ipAddress).font(.subheadline.monospaced()).foregroundStyle(.secondary)
                    }
                }
                .padding(.vertical, 6)
            }

            Section("Details") {
                detailRow("Type", device.deviceType.label)
                detailRow("IP Address", device.ipAddress)
                if let hostname = device.hostname { detailRow("Hostname", hostname) }
                if let bonjour = device.bonjourName { detailRow("Bonjour Name", bonjour) }
                detailRow("Role", roleText)
                if let firstSeen = scanner.store.firstSeen(for: device) {
                    detailRow("First Seen", firstSeen.formatted(.relative(presentation: .named)))
                }
            }

            if !device.services.isEmpty {
                Section("Services") {
                    ForEach(device.services) { service in
                        HStack {
                            Image(systemName: service.category.symbol ?? "circle.grid.2x2")
                                .foregroundStyle(.blue)
                                .frame(width: 24)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(service.category.label)
                                Text(service.type).font(.caption2.monospaced()).foregroundStyle(.secondary)
                            }
                        }
                    }
                }
            }

            Section {
                if portScanner.isScanning {
                    ProgressView(value: portScanner.progress) {
                        Text(portScanner.statusText).font(.footnote)
                    }
                } else {
                    Button {
                        portScanner.scan(host: device.ipAddress, depth: .common)
                    } label: {
                        Label("Scan for open ports", systemImage: "lock.open")
                    }
                }

                if !portScanner.findings.isEmpty {
                    ForEach(portScanner.findings) { finding in
                        VStack(alignment: .leading, spacing: 3) {
                            HStack {
                                Text("\(finding.port)").font(.body.monospacedDigit().weight(.semibold))
                                Spacer()
                                Text(finding.serviceName).foregroundStyle(.secondary)
                            }
                            if let detail = finding.detail {
                                Text(detail)
                                    .font(.caption.monospaced())
                                    .foregroundStyle(.tertiary)
                                    .textSelection(.enabled)
                                    .lineLimit(3)
                            }
                        }
                    }
                } else {
                    ForEach(device.openPorts) { port in
                        HStack {
                            Text("\(port.port)").font(.body.monospacedDigit().weight(.semibold))
                            Spacer()
                            Text(port.serviceName).foregroundStyle(.secondary)
                        }
                    }
                }
                if !portScanner.isScanning && !portScanner.statusText.isEmpty {
                    Text(portScanner.statusText).font(.caption).foregroundStyle(.secondary)
                }
            } header: {
                Text("Open Ports")
            }
        }
        .kovyrScreen()
        .navigationTitle(device.displayName)
        .navigationBarTitleDisplayMode(.inline)
    }

    private var roleText: String {
        if device.isRouter { return "Router / Gateway" }
        if device.isSelf { return "This Device" }
        return "Network Device"
    }

    private func detailRow(_ label: String, _ value: String) -> some View {
        HStack {
            Text(label).foregroundStyle(.secondary)
            Spacer()
            Text(value).multilineTextAlignment(.trailing)
        }
        .font(.subheadline)
    }
}
