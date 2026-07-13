import SwiftUI
import Charts

struct PingToolView: View {
    @EnvironmentObject private var scanner: NetworkScanner
    @StateObject private var ping = PingService()
    @State private var host: String = "1.1.1.1"

    var body: some View {
        Form {
            Section("Target") {
                TextField("IP or hostname", text: $host)
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.never)
                if let gateway = scanner.localNetwork?.gatewayGuess {
                    Button("Ping my router (\(gateway))") { host = gateway }.font(.footnote)
                }
            }

            Section {
                Button {
                    ping.isRunning ? ping.stop() : ping.start(host: host.trimmingCharacters(in: .whitespaces))
                } label: {
                    Label(ping.isRunning ? "Stop" : "Start ping", systemImage: ping.isRunning ? "stop.fill" : "play.fill")
                }
                .disabled(host.trimmingCharacters(in: .whitespaces).isEmpty)
            }

            if let error = ping.errorText {
                Section { Text(error).foregroundStyle(.red).font(.footnote) }
            }

            if !ping.samples.isEmpty {
                Section("Round-trip time") {
                    Chart(ping.samples) { sample in
                        if let rtt = sample.rttMs {
                            LineMark(x: .value("Seq", sample.id), y: .value("ms", rtt))
                                .foregroundStyle(.blue)
                            PointMark(x: .value("Seq", sample.id), y: .value("ms", rtt))
                                .foregroundStyle(.blue)
                        }
                    }
                    .frame(height: 160)

                    HStack {
                        stat("Min", ping.minRtt)
                        stat("Avg", ping.avgRtt)
                        stat("Max", ping.maxRtt)
                        stat("Loss", ping.lossPercent, unit: "%")
                    }
                }

                Section("Log") {
                    ForEach(ping.samples.reversed()) { sample in
                        HStack {
                            Text("seq \(sample.id)").font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                            Spacer()
                            if let rtt = sample.rttMs {
                                Text(String(format: "%.1f ms", rtt)).font(.body.monospacedDigit())
                            } else {
                                Text("timeout").foregroundStyle(.red).font(.caption)
                            }
                        }
                    }
                }
            }
        }
        .kovyrScreen()
        .navigationTitle("Ping")
        .navigationBarTitleDisplayMode(.inline)
        .onDisappear { ping.stop() }
    }

    private func stat(_ label: String, _ value: Double?, unit: String = "ms") -> some View {
        VStack(spacing: 2) {
            Text(label).font(.caption2).foregroundStyle(.secondary)
            Text(value.map { String(format: "%.0f", $0) } ?? "—").font(.subheadline.bold().monospacedDigit())
            Text(unit).font(.caption2).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
    }
}
