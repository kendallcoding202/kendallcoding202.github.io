import SwiftUI

struct PortScanToolView: View {
    @EnvironmentObject private var scanner: NetworkScanner
    @StateObject private var portScanner = PortScanner()
    @State private var host: String = ""
    @State private var depth: ScanDepth = .common

    var body: some View {
        Form {
            Section("Target") {
                TextField("IP address (e.g. 192.168.1.1)", text: $host)
                    .keyboardType(.decimalPad)
                    .autocorrectionDisabled()
                if let gateway = scanner.localNetwork?.gatewayGuess {
                    Button("Use my router (\(gateway))") { host = gateway }
                        .font(.footnote)
                }
            }

            Section {
                Picker("Depth", selection: $depth) {
                    ForEach(ScanDepth.allCases) { Text($0.rawValue).tag($0) }
                }
                .pickerStyle(.segmented)
                .disabled(portScanner.isScanning)
                Text(depth.subtitle)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } header: {
                Text("Scan depth")
            }

            Section {
                if portScanner.isScanning {
                    Button(role: .destructive) { portScanner.cancel() } label: {
                        Label("Stop", systemImage: "stop.fill")
                    }
                    ProgressView(value: portScanner.progress) {
                        Text(portScanner.statusText).font(.caption)
                    }
                } else {
                    Button {
                        portScanner.scan(host: host.trimmingCharacters(in: .whitespaces), depth: depth)
                    } label: {
                        Label("Scan ports", systemImage: "lock.open")
                    }
                    .disabled(host.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }

            if !portScanner.findings.isEmpty && !portScanner.isScanning {
                Section {
                    NavigationLink {
                        AssistantView(
                            context: scanContext,
                            openingPrompt: "Explain these open ports in plain English. For each, say what the service is, whether it's normal to see on a private network, and whether any of them are a security concern I should act on."
                        )
                    } label: {
                        Label("Explain these results with Kovyr AI", systemImage: "sparkles")
                            .foregroundStyle(Color.kovyrGold)
                    }
                }
            }

            if !portScanner.findings.isEmpty {
                Section("Open Ports") {
                    ForEach(portScanner.findings) { finding in
                        VStack(alignment: .leading, spacing: 3) {
                            HStack {
                                Text("\(finding.port)")
                                    .font(.body.monospacedDigit().weight(.semibold))
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
                        .padding(.vertical, 1)
                    }
                }
            } else if !portScanner.isScanning && !portScanner.statusText.isEmpty {
                Section { Text(portScanner.statusText).foregroundStyle(.secondary) }
            }
        }
        .kovyrScreen()
        .navigationTitle("Find Open Ports")
        .navigationBarTitleDisplayMode(.inline)
    }

    /// Plain-text summary of the scan results fed to the assistant as context.
    private var scanContext: String {
        let target = host.trimmingCharacters(in: .whitespaces)
        var lines = ["Port scan of host \(target.isEmpty ? "(unknown)" : target):"]
        for finding in portScanner.findings {
            var line = "- Port \(finding.port) (\(finding.serviceName))"
            if let detail = finding.detail { line += " — \(detail)" }
            lines.append(line)
        }
        return lines.joined(separator: "\n")
    }
}
