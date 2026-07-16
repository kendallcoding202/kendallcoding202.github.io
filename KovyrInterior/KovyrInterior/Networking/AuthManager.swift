import Foundation
import Supabase

/// Observable wrapper around Supabase auth for the shared Kovyr account.
///
/// Sign-in is passwordless: the user enters their email, receives a 6-digit code,
/// and verifies it. The Supabase SDK persists the session locally, so a signed-in
/// user stays signed in across launches; `authStateChanges` restores that session
/// (as an `.initialSession` event) and keeps `user` current thereafter.
@MainActor
final class AuthManager: ObservableObject {
    @Published private(set) var user: User?
    /// True until the persisted session (if any) has been restored at launch.
    @Published private(set) var isRestoring = true

    private var observation: Task<Void, Never>?

    init() {
        observation = Task { [weak self] in
            for await change in SupabaseManager.shared.client.auth.authStateChanges {
                self?.user = change.session?.user
                self?.isRestoring = false
            }
        }
    }

    deinit { observation?.cancel() }

    var isSignedIn: Bool { user != nil }
    var email: String? { user?.email }

    /// Ask Supabase to email a one-time 6-digit code to `email`.
    ///
    /// `shouldCreateUser: false` restricts sign-in to accounts that already exist
    /// (i.e. real Kovyr customers from the website) — an unknown email is rejected
    /// rather than silently creating a new, subscription-less auth user.
    func sendCode(to email: String) async throws {
        try await SupabaseManager.shared.client.auth.signInWithOTP(
            email: email,
            shouldCreateUser: false
        )
    }

    /// Verify the 6-digit code. On success `authStateChanges` updates `user`.
    func verifyCode(email: String, code: String) async throws {
        try await SupabaseManager.shared.client.auth.verifyOTP(
            email: email,
            token: code,
            type: .email
        )
    }

    func signOut() async {
        try? await SupabaseManager.shared.client.auth.signOut()
    }
}
