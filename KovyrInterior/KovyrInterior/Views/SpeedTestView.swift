import SwiftUI

struct SpeedTestView: View {
    @StateObject private var speedTest = SpeedTest()

    var body: some View {
        VStack(spacing: 28) {
            gauge

            HStack(spacing: 16) {
                resultCard("Download", speedTest.downloadMbps, "Mbps", "arrow.down.circle.fill", .blue)
                resultCard("Upload", speedTest.uploadMbps, "Mbps", "arrow.up.circle.fill", .indigo)
            }
            resultCard("Latency", speedTest.latencyMs, "ms", "timer", .teal)
                .frame(maxWidth: .infinity)

            if let error = speedTest.errorText {
                Text(error).font(.footnote).foregroundStyle(.red).multilineTextAlignment(.center)
            }

            Button {
                speedTest.isRunning ? speedTest.stop() : speedTest.start()
            } label: {
                Text(speedTest.isRunning ? "Stop" : "Start Speed Test")
                    .font(.headline)
                    .frame(maxWidth: .infinity)
                    .padding()
                    .background(speedTest.isRunning ? Color.red : Color.kovyrGold, in: RoundedRectangle(cornerRadius: 14))
                    .foregroundStyle(speedTest.isRunning ? .white : Color.kovyrDeep)
            }
            Spacer()
        }
        .padding()
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(KovyrBackground())
        .navigationTitle("Speed Test")
        .navigationBarTitleDisplayMode(.inline)
    }

    private var gauge: some View {
        VStack(spacing: 6) {
            Text(speedTest.isRunning ? String(format: "%.1f", speedTest.liveMbps) : "—")
                .font(.system(size: 56, weight: .bold, design: .rounded))
                .contentTransition(.numericText())
                .monospacedDigit()
            Text(speedTest.isRunning ? "Mbps · \(speedTest.phase.rawValue)" : speedTest.phase.rawValue)
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .frame(height: 120)
    }

    private func resultCard(_ title: String, _ value: Double?, _ unit: String, _ icon: String, _ color: Color) -> some View {
        VStack(spacing: 6) {
            Label(title, systemImage: icon).font(.caption).foregroundStyle(color)
            Text(value.map { String(format: "%.1f", $0) } ?? "—")
                .font(.title2.bold().monospacedDigit())
            Text(unit).font(.caption2).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
        .padding()
        .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 14))
    }
}
