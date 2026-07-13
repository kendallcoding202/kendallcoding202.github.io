import SwiftUI

struct TraceRouteToolView: View {
    @StateObject private var trace = TraceRoute()
    @State private var host: String = "1.1.1.1"

    var body: some View {
        Form {
            Section("Target") {
                TextField("IP or hostname", text: $host)
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.never)
            }

            Section {
                Button {
                    trace.isRunning ? trace.stop() : trace.start(host: host.trimmingCharacters(in: .whitespaces))
                } label: {
                    Label(trace.isRunning ? "Stop" : "Start trace", systemImage: "point.topleft.down.to.point.bottomright.curvepath")
                }
                .disabled(host.trimmingCharacters(in: .whitespaces).isEmpty)
                if trace.isRunning { ProgressView() }
            }

            Section {
                Text("iOS restricts the ICMP replies sandboxed apps can see, so intermediate hops may show as “no reply”. The destination usually resolves.")
                    .font(.caption).foregroundStyle(.secondary)
            }

            if let error = trace.errorText {
                Section { Text(error).font(.footnote).foregroundStyle(.orange) }
            }

            if !trace.hops.isEmpty {
                Section("Hops") {
                    ForEach(trace.hops) { hop in
                        HStack(spacing: 12) {
                            Text("\(hop.ttl)")
                                .font(.caption.monospacedDigit().weight(.bold))
                                .frame(width: 26)
                                .foregroundStyle(.secondary)
                            if let address = hop.address {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(address).font(.body.monospaced())
                                    if hop.reachedDestination {
                                        Text("Destination").font(.caption2).foregroundStyle(.green)
                                    }
                                }
                            } else {
                                Text("* no reply").foregroundStyle(.secondary)
                            }
                            Spacer()
                            if let rtt = hop.rttMs {
                                Text(String(format: "%.0f ms", rtt)).font(.caption.monospacedDigit())
                            }
                        }
                    }
                }
            }
        }
        .navigationTitle("Trace Route")
        .navigationBarTitleDisplayMode(.inline)
        .onDisappear { trace.stop() }
    }
}
