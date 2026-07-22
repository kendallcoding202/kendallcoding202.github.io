import SwiftUI

/// The "Tools" tab, mirroring Fing's layout: a Network Security section and an
/// Internet Connectivity section, each linking to a dedicated tool screen.
struct ToolsView: View {
    var body: some View {
        NavigationStack {
            List {
                Section("Assistant") {
                    ToolRow(
                        title: "Ask Kovyr AI",
                        subtitle: "Explain devices, ports and findings in plain English.",
                        icon: "sparkles", color: Color.kovyrGold
                    ) { AssistantView() }
                }

                Section("Network Security") {
                    ToolRow(
                        title: "Find open ports",
                        subtitle: "Probe a host for open ports to verify security policies.",
                        icon: "lock.fill", color: .green
                    ) { PortScanToolView() }

                    ToolRow(
                        title: "Router security check",
                        subtitle: "Detect NAT-PMP auto port-forwarding that can expose you.",
                        icon: "shield.lefthalf.filled", color: .gray
                    ) { RouterCheckView() }

                    ToolRow(
                        title: "Find hidden camera",
                        subtitle: "Detect camera-like devices (RTSP/DVR) on the network.",
                        icon: "camera.fill", color: .gray
                    ) { CameraFinderView() }
                }

                Section("Internet Connectivity") {
                    ToolRow(
                        title: "Run speed test",
                        subtitle: "Measure how fast you can download and upload data.",
                        icon: "speedometer", color: .blue
                    ) { SpeedTestView() }

                    ToolRow(
                        title: "Ping",
                        subtitle: "Visualize round-trip time to devices, servers and domains.",
                        icon: "chart.line.uptrend.xyaxis", color: .blue
                    ) { PingToolView() }

                    ToolRow(
                        title: "Trace route",
                        subtitle: "Discover the path packets take across the network.",
                        icon: "point.topleft.down.to.point.bottomright.curvepath", color: .blue
                    ) { TraceRouteToolView() }
                }
            }
            .kovyrScreen()
            .navigationTitle("Tools")
        }
    }
}

/// A reusable Fing-style list row that pushes a tool screen.
private struct ToolRow<Destination: View>: View {
    let title: String
    let subtitle: String
    let icon: String
    let color: Color
    @ViewBuilder let destination: () -> Destination

    var body: some View {
        NavigationLink {
            destination()
        } label: {
            HStack(spacing: 14) {
                Image(systemName: icon)
                    .font(.system(size: 20))
                    .foregroundStyle(.white)
                    .frame(width: 42, height: 42)
                    .background(color.gradient, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                VStack(alignment: .leading, spacing: 3) {
                    Text(title).font(.body.weight(.semibold))
                    Text(subtitle).font(.caption).foregroundStyle(.secondary)
                }
            }
            .padding(.vertical, 4)
        }
    }
}
