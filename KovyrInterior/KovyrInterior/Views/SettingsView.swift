import SwiftUI
import UIKit

/// The "Settings" tab: background auto-scan toggle and app information.
struct SettingsView: View {
    @AppStorage(BackgroundScan.enabledKey) private var backgroundEnabled = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Toggle("Automatic background scans", isOn: $backgroundEnabled)
                        .onChange(of: backgroundEnabled) { _, enabled in
                            BackgroundScan.setEnabled(enabled)
                        }
                } header: {
                    Text("Monitoring")
                } footer: {
                    Text("When enabled, Kovyr Interior periodically re-scans your network in the background and notifies you when a new device appears. iOS controls how often this runs and requires system Background App Refresh to be on. It does not run on the Simulator.")
                }

                Section("Notifications") {
                    Label("New-device alerts are sent after each scan.", systemImage: "bell.badge")
                        .font(.subheadline)
                    Link(destination: URL(string: UIApplication.openSettingsURLString)!) {
                        Label("Open system notification settings", systemImage: "gear")
                    }
                }

                Section {
                    LabeledContent("Version", value: appVersion)
                    LabeledContent("Discovery", value: "TCP + Bonjour")
                } header: {
                    Text("About")
                } footer: {
                    Text("Kovyr Interior is the on-site internal-network companion to Kovyr. It discovers devices within the limits of iOS: no MAC/manufacturer data, TCP + Bonjour discovery, and best-effort traceroute. Device types are inferred from open ports and services.")
                }
            }
            .navigationTitle("Settings")
        }
    }

    private var appVersion: String {
        let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0"
        let build = Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "1"
        return "\(version) (\(build))"
    }
}
