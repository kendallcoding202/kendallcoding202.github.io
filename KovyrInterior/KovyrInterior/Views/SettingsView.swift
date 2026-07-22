import SwiftUI
import UIKit

/// The "Settings" tab: background auto-scan toggle and app information.
struct SettingsView: View {
    @AppStorage(BackgroundScan.enabledKey) private var backgroundEnabled = false
    @State private var apiKeyDraft = ""
    @State private var hasKey = KeychainStore.hasAPIKey

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
                    if hasKey {
                        LabeledContent {
                            Text("Key saved").foregroundStyle(.secondary)
                        } label: {
                            Label("Anthropic API key", systemImage: "key.fill")
                        }
                        Button(role: .destructive) {
                            KeychainStore.deleteAPIKey()
                            hasKey = false
                            apiKeyDraft = ""
                        } label: {
                            Label("Remove key", systemImage: "trash")
                        }
                    } else {
                        SecureField("sk-ant-…", text: $apiKeyDraft)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                        Button {
                            KeychainStore.saveAPIKey(apiKeyDraft)
                            hasKey = KeychainStore.hasAPIKey
                            apiKeyDraft = ""
                        } label: {
                            Label("Save key", systemImage: "checkmark.circle")
                        }
                        .disabled(apiKeyDraft.trimmingCharacters(in: .whitespaces).isEmpty)
                    }
                } header: {
                    Text("AI Assistant")
                } footer: {
                    Text("Paste your own Anthropic API key to enable “Ask Kovyr.” It is stored only in this device's Keychain — never uploaded, shared, or included in exports — and is sent solely to Anthropic when you ask a question. Answers use Claude Opus 4.8. Get a key at console.anthropic.com.")
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
        }
    }

    private var appVersion: String {
        let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0"
        let build = Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "1"
        return "\(version) (\(build))"
    }
}
