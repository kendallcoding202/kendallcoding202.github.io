import SwiftUI

struct RouterCheckView: View {
    @StateObject private var check = RouterCheck()

    var body: some View {
        Form {
            Section {
                Button {
                    check.run()
                } label: {
                    Label(check.status == .checking ? "Checking…" : "Check my router", systemImage: "shield.lefthalf.filled")
                }
                .disabled(check.status == .checking)
                if check.status == .checking { ProgressView() }
            }

            if check.status == .finished {
                Section("Result") {
                    row("Gateway", check.gateway)
                    if let ip = check.publicIP { row("Public IP", ip) }
                    if let enabled = check.natpmpEnabled {
                        HStack {
                            Text("NAT-PMP")
                            Spacer()
                            Label(enabled ? "Enabled" : "Not detected",
                                  systemImage: enabled ? "exclamationmark.triangle.fill" : "checkmark.shield.fill")
                                .foregroundStyle(enabled ? .orange : .green)
                                .font(.subheadline.weight(.semibold))
                        }
                    }
                }

                if !check.notes.isEmpty {
                    Section("What this means") {
                        ForEach(check.notes, id: \.self) { note in
                            Text(note).font(.footnote)
                        }
                    }
                }
            }
        }
        .navigationTitle("Router Security")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func row(_ label: String, _ value: String) -> some View {
        HStack {
            Text(label).foregroundStyle(.secondary)
            Spacer()
            Text(value).font(.subheadline.monospaced())
        }
    }
}
