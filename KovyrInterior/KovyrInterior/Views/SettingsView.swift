import SwiftUI
import UIKit

/// The "Settings" tab: background auto-scan toggle and app information.
struct SettingsView: View {
    @EnvironmentObject private var auth: AuthManager
    @AppStorage(BackgroundScan.enabledKey) private var backgroundEnabled = false
    @State private var isTestingConnection = false
    @State private var connectionStatus: String?
    @State private var showLogin = false

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
                    Link(destination: URL(string: "https://kovyr.com")!) {
                        HStack(spacing: 12) {
                            Image(systemName: "shield.lefthalf.filled")
                                .font(.title3)
                                .foregroundStyle(Color.kovyrDeep)
                                .frame(width: 40, height: 40)
                                .background(Color.kovyrGold.gradient, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
                            VStack(alignment: .leading, spacing: 2) {
                                Text("Learn about Kovyr")
                                    .font(.body.weight(.semibold))
                                    .foregroundStyle(.white)
                                Text("See what's hiding in plain sight.")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            Spacer()
                            Image(systemName: "arrow.up.right")
                                .font(.caption.weight(.bold))
                                .foregroundStyle(.secondary)
                        }
                        .padding(.vertical, 2)
                    }
                } header: {
                    Text("Kovyr").foregroundStyle(Color.kovyrGold)
                } footer: {
                    Text("Kovyr is a security-posture service for small businesses. Kovyr Interior is its on-site, internal-network companion.")
                }

                Section {
                    if auth.isSignedIn {
                        LabeledContent {
                            Text(auth.email ?? "—").foregroundStyle(.secondary)
                        } label: {
                            Label("Signed in", systemImage: "person.crop.circle.fill.badge.checkmark")
                        }
                        Button(role: .destructive) {
                            Task { await auth.signOut() }
                        } label: {
                            Label("Sign out", systemImage: "rectangle.portrait.and.arrow.right")
                        }
                    } else {
                        Button {
                            showLogin = true
                        } label: {
                            Label("Sign in to Kovyr", systemImage: "person.crop.circle.badge.plus")
                        }
                    }

                    Button {
                        Task { await runConnectionTest() }
                    } label: {
                        HStack {
                            Label("Test Kovyr connection", systemImage: "antenna.radiowaves.left.and.right")
                            Spacer()
                            if isTestingConnection { ProgressView() }
                        }
                    }
                    .disabled(isTestingConnection)

                    if let connectionStatus {
                        Text(connectionStatus)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .textSelection(.enabled)
                    }
                } header: {
                    Text("Kovyr Account")
                } footer: {
                    Text("Sign in with your Kovyr email to link this device to your account — the same login you use on the Kovyr website.")
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
            .kovyrScreen()
            .navigationTitle("Settings")
            .sheet(isPresented: $showLogin) {
                LoginView()
            }
        }
    }

    private func runConnectionTest() async {
        isTestingConnection = true
        connectionStatus = "Testing…"
        connectionStatus = await SupabaseManager.shared.testConnection()
        isTestingConnection = false
    }

    private var appVersion: String {
        let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0"
        let build = Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "1"
        return "\(version) (\(build))"
    }
}
