import SwiftUI

/// Passwordless email-OTP sign-in against the shared Kovyr Supabase project.
///
/// Two steps: enter email → Supabase emails a 6-digit code → enter code → signed
/// in. Using the code (rather than a magic link) avoids any mobile deep-linking.
struct LoginView: View {
    @EnvironmentObject private var auth: AuthManager
    @Environment(\.dismiss) private var dismiss

    private enum Step { case email, code }
    @State private var step: Step = .email
    @State private var email = ""
    @State private var code = ""
    @State private var isWorking = false
    @State private var errorMessage: String?
    @State private var infoMessage: String?

    var body: some View {
        NavigationStack {
            Form {
                switch step {
                case .email: emailStep
                case .code: codeStep
                }

                if let infoMessage {
                    Section { Text(infoMessage).font(.callout).foregroundStyle(.secondary) }
                }
                if let errorMessage {
                    Section { Text(errorMessage).font(.callout).foregroundStyle(.red) }
                }
            }
            .kovyrScreen()
            .navigationTitle("Sign in to Kovyr")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }.disabled(isWorking)
                }
            }
            // Dismiss automatically once the session is established.
            .onChange(of: auth.isSignedIn) { _, signedIn in
                if signedIn { dismiss() }
            }
            .interactiveDismissDisabled(isWorking)
        }
    }

    private var emailStep: some View {
        Section {
            TextField("you@company.com", text: $email)
                .textContentType(.emailAddress)
                .keyboardType(.emailAddress)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()

            Button {
                Task { await sendCode() }
            } label: {
                HStack {
                    Text("Send code")
                    Spacer()
                    if isWorking { ProgressView() }
                }
            }
            .disabled(!isValidEmail || isWorking)
        } header: {
            Text("Your Kovyr email")
        } footer: {
            Text("We'll email you a 6-digit code. This signs you into the same account you use on the Kovyr website.")
        }
    }

    private var codeStep: some View {
        Section {
            TextField("123456", text: $code)
                .keyboardType(.numberPad)
                .textContentType(.oneTimeCode)
                .font(.title2.monospacedDigit())

            Button {
                Task { await verify() }
            } label: {
                HStack {
                    Text("Verify & sign in")
                    Spacer()
                    if isWorking { ProgressView() }
                }
            }
            .disabled(code.count < 6 || isWorking)

            Button("Resend code") { Task { await sendCode() } }
                .disabled(isWorking)
            Button("Use a different email") {
                step = .email
                code = ""
                errorMessage = nil
                infoMessage = nil
            }
            .disabled(isWorking)
        } header: {
            Text("Enter the code sent to \(email)")
        }
    }

    private var isValidEmail: Bool {
        let trimmed = email.trimmingCharacters(in: .whitespaces)
        return trimmed.contains("@") && trimmed.contains(".") && trimmed.count >= 5
    }

    private var trimmedEmail: String { email.trimmingCharacters(in: .whitespaces) }

    private func sendCode() async {
        isWorking = true
        errorMessage = nil
        do {
            try await auth.sendCode(to: trimmedEmail)
            infoMessage = "Code sent. Check your email (and spam)."
            step = .code
        } catch {
            errorMessage = error.localizedDescription
        }
        isWorking = false
    }

    private func verify() async {
        isWorking = true
        errorMessage = nil
        do {
            try await auth.verifyCode(email: trimmedEmail, code: code.trimmingCharacters(in: .whitespaces))
            // On success, auth.isSignedIn flips true and .onChange dismisses us.
        } catch {
            errorMessage = error.localizedDescription
        }
        isWorking = false
    }
}
