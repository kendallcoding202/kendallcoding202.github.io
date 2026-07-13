import SwiftUI

struct CameraFinderView: View {
    @StateObject private var finder = CameraFinder()

    var body: some View {
        List {
            Section {
                Button {
                    finder.isScanning ? finder.cancel() : finder.scan()
                } label: {
                    Label(finder.isScanning ? "Stop scan" : "Scan for cameras", systemImage: "camera.viewfinder")
                }
                if finder.isScanning {
                    ProgressView(value: finder.progress)
                }
                Text(finder.statusText).font(.footnote).foregroundStyle(.secondary)
            }

            if !finder.candidates.isEmpty {
                Section("Camera-like devices") {
                    ForEach(finder.candidates) { candidate in
                        VStack(alignment: .leading, spacing: 4) {
                            HStack {
                                Image(systemName: "camera.fill").foregroundStyle(.orange)
                                Text(candidate.ip).font(.body.monospaced())
                                Spacer()
                                Text(candidate.confidence.rawValue)
                                    .font(.caption2.weight(.semibold))
                                    .padding(.horizontal, 8).padding(.vertical, 3)
                                    .background((candidate.confidence == .high ? Color.orange : Color.yellow).opacity(0.2), in: Capsule())
                                    .foregroundStyle(candidate.confidence == .high ? .orange : .yellow)
                            }
                            Text(candidate.openPorts.map { "\($0.port) (\($0.serviceName))" }.joined(separator: ", "))
                                .font(.caption).foregroundStyle(.secondary)
                        }
                        .padding(.vertical, 2)
                    }
                }
            }

            Section {
                Text("Detection is based on open camera/DVR ports (RTSP, ONVIF, Hikvision, Dahua). A match is a strong hint, not proof — verify the device yourself.")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
        .navigationTitle("Find Hidden Camera")
        .navigationBarTitleDisplayMode(.inline)
    }
}
