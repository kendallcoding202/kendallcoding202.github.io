import SwiftUI

struct PortScanToolView: View {
    @EnvironmentObject private var scanner: NetworkScanner
    @StateObject private var portScanner = PortScanner()
    @State private var host: String = ""

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
                Button {
                    portScanner.scan(host: host.trimmingCharacters(in: .whitespaces))
                } label: {
                    Label(portScanner.isScanning ? "Scanning…" : "Scan ports", systemImage: "lock.open")
                }
                .disabled(host.trimmingCharacters(in: .whitespaces).isEmpty || portScanner.isScanning)

                if portScanner.isScanning {
                    ProgressView(value: portScanner.progress)
                }
            }

            if !portScanner.openPorts.isEmpty {
                Section("Open Ports") {
                    ForEach(portScanner.openPorts) { port in
                        HStack {
                            Text("\(port.port)").font(.body.monospacedDigit().weight(.semibold))
                            Spacer()
                            Text(port.serviceName).foregroundStyle(.secondary)
                        }
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
}
